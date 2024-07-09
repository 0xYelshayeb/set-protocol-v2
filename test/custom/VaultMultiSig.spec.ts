import "module-alias/register";

import {
  getAccounts,
  getSystemFixture,
  getWaffleExpect,
  increaseTimeAsync
} from "@utils/test/index";

import DeployHelper from "@utils/deploys";
import { ether } from "@utils/common";
import { BigNumber } from "ethers";
import { StreamingFeeState } from "@utils/types";
import { ONE_YEAR_IN_SECONDS, ZERO } from "@utils/constants";
import hre, { ethers } from "hardhat";
import { Account } from "@utils/test/types";
import { Contract } from "ethers";
import { StreamingFeeModule, GeneralIndexModule, SetToken } from "@utils/contracts/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("MultiSigOperator", () => {
  let manager: Account;
  let methodologist: Account;
  let methodologistContract: Contract;
  let operator: Account;
  let ownerAccounts: Account[];
  let owners: string[];
  let numConfirmationsRequired: number;
  let streamingFeeModule: StreamingFeeModule;
  let indexModule: GeneralIndexModule;
  let setup: SystemFixture;
  let deployer: DeployHelper;
  let setToken: SetToken;

  before(async () => {

    [manager, methodologist, operator, ...ownerAccounts] = await getAccounts();

    // Assuming that the addresses are needed for deployment and interactions
    owners = ownerAccounts.map(account => account.address);
    numConfirmationsRequired = 2;

    deployer = new DeployHelper(manager.wallet);

    // Deploy system
    setup = getSystemFixture(manager.address);
    await setup.initialize();

    setup.streamingFeeModule = setup.streamingFeeModule.connect(manager.wallet);

    // StreamingFeeModule Deployment
    streamingFeeModule = await deployer.modules.deployStreamingFeeModule(setup.controller.address);
    await setup.controller.addModule(streamingFeeModule.address);

    // IndexModule Deployment
    indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(indexModule.address);

  });

  beforeEach(async () => {

    const wbtcUnits = BigNumber.from(100000000); // 1 WBTC in base units 1 * 10 ** 8

    // Deploy SetToken with issuanceModule, TradeModule, and StreamingFeeModule
    setToken = await setup.createSetToken(
      [setup.wbtc.address],
      [wbtcUnits],
      [
        setup.navIssuanceModule.address,
        setup.issuanceModule.address,
        streamingFeeModule.address,
        indexModule.address,
      ],
      manager.address,
      "SetToken",
      "SET"
    );

    // Deploy mock issuance hook and initialize issuance module
    setup.issuanceModule = setup.issuanceModule.connect(manager.wallet);
    const mockPreIssuanceHook = await deployer.mocks.deployManagerIssuanceHookMock();
    await setup.issuanceModule.initialize(setToken.address, mockPreIssuanceHook.address);

    // Approve WBTC to IssuanceModule
    setup.wbtc = setup.wbtc.connect(manager.wallet);
    await setup.wbtc.approve(setup.issuanceModule.address, ethers.constants.MaxUint256);

    // Deploy ICManager
    const ICManager = await hre.ethers.getContractFactory("ICManager");
    let icManagerInstance = await ICManager.deploy(
      setToken.address, indexModule.address, streamingFeeModule.address, operator.address, methodologist.address, 0
    );
    await icManagerInstance.deployed();

    setup.issuanceModule = setup.issuanceModule.connect(manager.wallet);
    const issueQuantity = ether(10);
    await setup.issuanceModule.issue(setToken.address, issueQuantity, manager.address);

    // Initialize StreamingFeeModule
    const streamingFeePercentage = ether(.02);
    const subjectSettings = {
      feeRecipient: manager.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: streamingFeePercentage,
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;
    streamingFeeModule = streamingFeeModule.connect(manager.wallet);
    await streamingFeeModule.initialize(setToken.address, subjectSettings);
    await setToken.isInitializedModule(streamingFeeModule.address);

    // Initialize IndexModule
    indexModule = indexModule.connect(manager.wallet);
    await indexModule.initialize(setToken.address);
    await setToken.isInitializedModule(indexModule.address);

    const VaultMultiSig = await hre.ethers.getContractFactory("VaultMultiSig");
    methodologistContract = await VaultMultiSig.deploy(
      owners,
      numConfirmationsRequired,
      icManagerInstance.address,
      setToken.address
    );

    // Change fee recipient
    await streamingFeeModule.updateFeeRecipient(setToken.address, methodologistContract.address);

    // Update Manager
    setToken = setToken.connect(manager.wallet);
    await setToken.setManager(icManagerInstance.address);

    // Update methodologist
    icManagerInstance = icManagerInstance.connect(methodologist.wallet);
    await icManagerInstance.updateMethodologist(methodologistContract.address);
  });

  describe("submitMetodologist", () => {
    it("should allow an owner to submit a new methodologist", async () => {
      const newMethodologist = owners[4];
      await expect(methodologistContract.connect(ownerAccounts[0].wallet).submitMetodologist(newMethodologist))
        .to.emit(methodologistContract, "SubmitNewMethodologist")
        .withArgs(newMethodologist);
    });

    it("should not allow a non-owner to submit a new methodologist", async () => {
      const newMethodologist = owners[4];
      await expect(methodologistContract.connect(operator.wallet).submitMetodologist(newMethodologist))
        .to.be.revertedWith("not owner");
    });
  });

  describe("confirmMethodologist", () => {
    beforeEach(async () => {
      const newMethodologist = owners[4];
      await methodologistContract.connect(ownerAccounts[0].wallet).submitMetodologist(newMethodologist);
    });

    it("should allow an owner to confirm a new methodologist", async () => {
      await expect(methodologistContract.connect(ownerAccounts[0].wallet).confirmMethodologist())
        .to.emit(methodologistContract, "ConfirmNewMethodologist");
    });

    it("should not allow a non-owner to confirm a new methodologist", async () => {
      await expect(methodologistContract.connect(operator.wallet).confirmMethodologist())
        .to.be.revertedWith("not owner");
    });
  });

  describe("executeNewMethodologist", () => {
    beforeEach(async () => {
      const newMethodologist = owners[4];
      await methodologistContract.connect(ownerAccounts[0].wallet).submitMetodologist(newMethodologist);
      await methodologistContract.connect(ownerAccounts[0].wallet).confirmMethodologist();
    });

    it("should execute new methodologist change when required confirmations are met", async () => {
      await methodologistContract.connect(ownerAccounts[1].wallet).confirmMethodologist();
      await expect(methodologistContract.connect(ownerAccounts[0].wallet).executeNewMethodologist())
        .to.emit(methodologistContract, "ExecuteNewMethodologist");
    });

    it("should not execute new methodologist change when required confirmations are not met", async () => {
      await expect(methodologistContract.connect(ownerAccounts[0].wallet).executeNewMethodologist())
        .to.be.revertedWith("cannot execute rebalance");
    });

    // test accrue fee and check whether balance is actually changing after changeMethodologist
    it("should change balance of new methodologist after executeNewMethodologist", async () => {
      // Accrue streaming fee (fast-forward one year)
      const newMethodologist = owners[4];
      const subjectTimeFastForward = ONE_YEAR_IN_SECONDS;
      await increaseTimeAsync(subjectTimeFastForward);
      await streamingFeeModule.accrueFee(setToken.address);
      await methodologistContract.connect(ownerAccounts[1].wallet).confirmMethodologist();
      const methodologistBalanceBefore = await setToken.balanceOf(methodologistContract.address);
      await methodologistContract.connect(ownerAccounts[0].wallet).executeNewMethodologist();
      const methodologistBalanceAfter = await setToken.balanceOf(methodologistContract.address);
      expect(methodologistBalanceAfter).to.be.eq(0);
      expect(methodologistBalanceBefore).to.be.eq(await setToken.balanceOf(newMethodologist));
    });
  });

  describe("revokeConfirmation", () => {
    beforeEach(async () => {
      const newMethodologist = owners[4];
      await methodologistContract.connect(ownerAccounts[0].wallet).submitMetodologist(newMethodologist);
      await methodologistContract.connect(ownerAccounts[0].wallet).confirmMethodologist();
    });

    it("should allow an owner to revoke their confirmation", async () => {
      await expect(methodologistContract.connect(ownerAccounts[0].wallet).revokeConfirmation())
        .to.emit(methodologistContract, "RevokeConfirmationMethodologist")
        .withArgs(ownerAccounts[0].address, owners[4]);
    });

    it("should not allow a non-owner to revoke a confirmation", async () => {
      await expect(methodologistContract.connect(operator.wallet).revokeConfirmation())
        .to.be.revertedWith("not owner");
    });

    it("should not allow revoking a confirmation if not confirmed by the owner", async () => {
      await expect(methodologistContract.connect(ownerAccounts[1].wallet).revokeConfirmation())
        .to.be.revertedWith("rebalance not confirmed");
    });
  });

});
