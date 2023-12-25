import "module-alias/register";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { Account } from "@utils/test/types";
import DeployHelper from "@utils/deploys";
import {
  ether,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getWaffleExpect
} from "@utils/test/index";

import "module-alias/register";

import {
  getSystemFixtureDeploy,
  getKyberV3DMMFixtureDeploy
} from "@utils/test/index";

import { StreamingFeeState } from "@utils/types";
import { ZERO } from "@utils/constants";
import hre from "hardhat";
import { NAVIssuanceSettingsStruct } from "@typechain/CustomOracleNavIssuanceModule";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { SetToken } from "@typechain/SetToken";
import { SystemFixtureDeploy } from "@utils/fixtures";
import { GeneralIndexModule } from "@typechain/GeneralIndexModule";

const expect = getWaffleExpect();

describe("DCgen Tests", function () {
  let manager: SignerWithAddress;
  let setToken: SetToken;
  let user: SignerWithAddress;
  let deployer: DeployHelper;
  let setup: SystemFixtureDeploy;
  let indexModule: GeneralIndexModule;
  addSnapshotBeforeRestoreAfterEach();

  before(async () => {
    [manager, user] = await ethers.getSigners();

    const managerAccount: Account = {
      wallet: manager,
      address: await manager.getAddress(),
    };

    deployer = new DeployHelper(manager);

    setup = getSystemFixtureDeploy(manager.address);

    await setup.initialize();

    let tx = await setup.weth.connect(manager).deposit({ value: ether("990000") });
    await tx.wait();

    tx = await setup.weth.connect(user).deposit({ value: ether("9000") });
    await tx.wait();

    // fund user with all components
    for (let i = 0; i < setup.components.length; i++) {
      const component = setup.components[i];
      tx = await component.connect(manager).transfer(user.address, ether("10"));
      await tx.wait();
    }

    const weights = [];
    for (let i = 0; i < 10; i++) {
      weights.push(BigNumber.from("1000000000000000000"));
    }

    let streamingFeeModule = await deployer.modules.deployStreamingFeeModule(setup.controller.address);
    await setup.controller.addModule(streamingFeeModule.address);

    // IndexModule Deployment
    indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(indexModule.address);

    const kyberSetup = getKyberV3DMMFixtureDeploy(manager.address);
    await kyberSetup.initialize(managerAccount, setup.weth, setup.components, setup.oracles);

    const kyberExchangeAdapter = await deployer.adapters.deployKyberV3IndexExchangeAdapter(
      kyberSetup.dmmRouter.address,
      kyberSetup.dmmFactory.address
    );

    const kyberAdapterName = "KYBER";

    await setup.integrationRegistry.batchAddIntegration(
      [indexModule.address],
      [kyberAdapterName],
      [kyberExchangeAdapter.address],
    );

    // Deploy SetToken with navIissuanceModule, indexmodule, and StreamingFeeModule
    setToken = await setup.createSetToken(
      setup.components.map(component => component.address),
      weights,
      [
        setup.issuanceModule.address,
        setup.navIssuanceModule.address,
        streamingFeeModule.address,
        indexModule.address,
      ],
      manager.address,
      "SetToken",
      "SET"
    );

    // Deploy mock issuance hook and initialize issuance module
    setup.issuanceModule = setup.issuanceModule.connect(manager);
    const mockPreIssuanceHook = await deployer.mocks.deployManagerIssuanceHookMock();
    await setup.issuanceModule.initialize(setToken.address, mockPreIssuanceHook.address);

    // Deploy mock nav issuance hook and initialize nav issuance module
    setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
    const mockPreNavIssuanceHook = await deployer.mocks.deployNavIssuanceHookMock();

    const navIssuanceSettings = {
      managerIssuanceHook: mockPreNavIssuanceHook.address,
      managerRedemptionHook: mockPreNavIssuanceHook.address,
      setValuer: "0x0000000000000000000000000000000000000000",
      reserveAssets: [setup.weth.address],
      feeRecipient: manager.address,
      managerFees: [BigNumber.from("0"), BigNumber.from("0")], // 0.01% issue and redeem fees
      maxManagerFee: BigNumber.from("0"), // 5%
      premiumPercentage: BigNumber.from("0"), // 0.01%
      maxPremiumPercentage: BigNumber.from("0"), // 5%
      minSetTokenSupply: BigNumber.from("1") // 1 SetToken (in wei)
    } as NAVIssuanceSettingsStruct;
    await setup.navIssuanceModule.initialize(setToken.address, navIssuanceSettings);

    // Approve WETH on navIssuanceModule
    setup.weth = setup.weth.connect(manager);
    await setup.weth.approve(setup.navIssuanceModule.address, ethers.constants.MaxUint256);

    const ICManager = await hre.ethers.getContractFactory("ICManager");
    let icManagerInstance = await ICManager.deploy(
      setToken.address, indexModule.address, streamingFeeModule.address, manager.address, manager.address, 0
    );
    await icManagerInstance.deployed();

    const streamingFeePercentage = ether(.02);
    const subjectSettings = {
      feeRecipient: manager.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: streamingFeePercentage,
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;
    streamingFeeModule = streamingFeeModule.connect(manager);
    await streamingFeeModule.initialize(setToken.address, subjectSettings);
    await setToken.isInitializedModule(streamingFeeModule.address);

    // Initialize IndexModule
    indexModule = indexModule.connect(manager);
    await indexModule.initialize(setToken.address);
    await setToken.isInitializedModule(indexModule.address);

    indexModule = indexModule.connect(manager);
    await indexModule.setExchanges(
      setToken.address,
      setup.components.map(component => component.address),
      setup.components.map(() => kyberAdapterName)
    );

    indexModule = indexModule.connect(manager);
    await indexModule.setExchangeData(
      setToken.address,
      setup.components.map(component => component.address),
      setup.components.map(component => {
        const poolInfo = kyberSetup.componentPoolsMap.get(component.address);
        if (!poolInfo) {
          throw new Error(`Pool address not found for component: ${component.address}`);
        }
        return poolInfo.address;
      })
    );

    // Change fee recipient
    const newFeeRecipient = manager.address;
    await streamingFeeModule.updateFeeRecipient(setToken.address, newFeeRecipient);

    // set trade maximums to max for all components
    indexModule = indexModule.connect(manager);
    await indexModule.setTradeMaximums(
      setToken.address,
      setup.components.map(component => component.address),
      setup.components.map(() => ether(1000000))
    );

    setToken = setToken.connect(manager);
    await setToken.setManager(icManagerInstance.address);

    icManagerInstance = icManagerInstance.connect(manager);
    await icManagerInstance.updateAnyoneTrade(true);

    // Deploy MultiSigOperator
    const MultiSigOperator = await hre.ethers.getContractFactory("MultiSigOperator");
    const MultiSigInstance = await MultiSigOperator.deploy(
      [manager.address], 1, 1, manager.address, icManagerInstance.address
    );
    await MultiSigInstance.deployed();

    // Update Operator
    icManagerInstance = icManagerInstance.connect(manager);
    await icManagerInstance.updateOperator(MultiSigInstance.address);

  });

  describe("Normal Issuance", function () {

    it("Successful Issuance", async function () {
      const amount = 10;
      setup.issuanceModule = setup.issuanceModule.connect(manager);
      await setup.issuanceModule.issue(setToken.address, ether(amount), manager.address);
      expect(await setToken.balanceOf(manager.address)).to.eq(ether(amount));
    });

    it("Insufficient Balance", async function () {
      const amount = 100000;
      setup.issuanceModule = setup.issuanceModule.connect(manager);
      await expect(setup.issuanceModule.issue(setToken.address, ether(amount), manager.address)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });

    // Additional token issuance tests...
  });

  describe("NAV Issuance and Redemption", function () {
    beforeEach(async () => {
      // Ensure setToken has enough for NAVIssuance
      const amount = 1000;
      setup.issuanceModule = setup.issuanceModule.connect(manager);
      await setup.issuanceModule.issue(setToken.address, ether(amount), manager.address);
    });

    it("Successful NAV Issuance", async function () {
      const amount = 10;
      setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
      await setup.navIssuanceModule.issue(setToken.address, setup.weth.address, ether(amount), ether(0), manager.address);
      expect(await setToken.balanceOf(manager.address)).to.be.gt(ether(0));
    });

    it("Should redeem SetToken for WETH", async function () {
      const amount = 1000;
      setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
      await setup.navIssuanceModule.issue(setToken.address, setup.weth.address, ether(amount), ether(0), manager.address);
      const balance = await setToken.balanceOf(manager.address);
      await setup.weth.connect(manager).approve(setup.navIssuanceModule.address, ether(amount + 10));
      await setup.navIssuanceModule.redeem(setToken.address, setup.weth.address, balance.mul(90).div(100), 0, manager.address);
      expect(await setToken.balanceOf(manager.address)).to.be.lt(balance);
    });

    it("Should revert when settoken has no weth", async function () {
      const amount = 100;
      await setup.weth.connect(manager).approve(setup.navIssuanceModule.address, ether(amount + 10));
      await expect(setup.navIssuanceModule.redeem(setToken.address, setup.weth.address, ether(1), 0, manager.address)).to.be.revertedWith(
        "Must be greater than total available collateral"
      );
    });

  });

});
