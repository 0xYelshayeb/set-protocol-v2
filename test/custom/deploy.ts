import "module-alias/register";

import {
  getSystemFixtureDeploy,
  getKyberV3DMMFixtureDeploy
} from "@utils/test/index";

import DeployHelper from "@utils/deploys";
import { ether } from "@utils/common";
import { BigNumber } from "ethers";
import { StreamingFeeState } from "@utils/types";
import { ZERO } from "@utils/constants";
import hre from "hardhat";
import { ethers } from "hardhat";
import { Account } from "@utils/test/types";
import { NAVIssuanceSettingsStruct } from "@typechain/CustomOracleNavIssuanceModule";

async function main() {

  const [manager] = await ethers.getSigners();

  const managerAccount: Account = {
    wallet: manager,
    address: await manager.getAddress(),
  };


  console.log(`Deploying contracts with the account: ${manager.address}`);

  const deployer = new DeployHelper(manager);

  const setup = getSystemFixtureDeploy(manager.address);

  await setup.initialize();

  const weights = [];
  for (let i = 0; i < 10; i++) {
    weights.push(BigNumber.from("1000000000000000000"));
  }

  let streamingFeeModule = await deployer.modules.deployStreamingFeeModule(setup.controller.address);
  await setup.controller.addModule(streamingFeeModule.address);

  // IndexModule Deployment
  let indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
  await setup.controller.addModule(indexModule.address);

  const kyberSetup = getKyberV3DMMFixtureDeploy(manager.address);
  await kyberSetup.initialize(managerAccount, setup.weth.address, setup.components.map(component => component.address));

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
  let setToken = await setup.createSetToken(
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

  // for (let i = 0; i < setup.components.length; i++) {
  //   const component = setup.components[i];
  //   const componentBalance = await setup.components[i].balanceOf(manager.address);
  //   console.log(`Manager's ${await component.symbol()} Balance: ${ethers.utils.formatEther(componentBalance)} ${await component.symbol()}`);
  // }

  // Issue 100 SetTokens
  setup.issuanceModule = setup.issuanceModule.connect(manager);
  const issueQuantity = ether(1);
  await setup.issuanceModule.issue(setToken.address, issueQuantity, manager.address);

  console.log("SetToken Balance after normal issuance:");

  for (let i = 0; i < setup.components.length; i++) {
    const componentBalance = await setup.components[i].balanceOf(setToken.address);
    console.log(`Settoken's Balance: ${ethers.utils.formatEther(componentBalance)}`);
  }

  let setTokenBalance = await setToken.balanceOf(manager.address);
  console.log(`Manager's SetToken Balance: ${ethers.utils.formatEther(setTokenBalance)} SET`);


  const tx = await setup.weth.connect(manager).deposit({ value: ether("50000") });
  await tx.wait();

  setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
  await setup.navIssuanceModule.issue(setToken.address, setup.weth.address, ether(1), ether(0), manager.address);

  console.log("Balances after NAV issuance:\n");

  setTokenBalance = await setToken.balanceOf(manager.address);
  console.log(`Manager's SetToken Balance: ${ethers.utils.formatEther(setTokenBalance)} SET`);

  let wethBalance = await setup.weth.balanceOf(manager.address);
  console.log(`Manager Balance: ${ethers.utils.formatEther(wethBalance)} WETH`);

  wethBalance = await setup.weth.balanceOf(setToken.address);
  console.log(`SetToken Balance: ${ethers.utils.formatEther(wethBalance)} WETH`);

  const newConstituents: string[] = [];
  const newUnits: number[] = [];

  let multiSigInstance = MultiSigInstance.connect(manager);
  await multiSigInstance.submitRebalance(newConstituents, newUnits, weights, 1);
  multiSigInstance = MultiSigInstance.connect(manager);
  await multiSigInstance.confirmRebalance();
  multiSigInstance = MultiSigInstance.connect(manager);
  await multiSigInstance.executeRebalance();

  console.log("rebalance executed!");

  const IndexModuleInstance = indexModule.connect(manager);
  await IndexModuleInstance.trade(setToken.address, setup.components[1].address, 1);

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });