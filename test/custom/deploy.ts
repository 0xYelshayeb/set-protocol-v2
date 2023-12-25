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

  console.log("Fund manager with WETH...");
  const tx = await setup.weth.connect(manager).deposit({ value: ether("5.5") });
  await tx.wait();

  console.log("Funded manager with WETH...");

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

  console.log("Deploying SetToken...");
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
  const preNavIssuanceHookContract =  await hre.ethers.getContractFactory("IssuanceHook");
  const preNavIssuanceHook = await preNavIssuanceHookContract.deploy(indexModule.address);

  const navIssuanceSettings = {
    managerIssuanceHook: preNavIssuanceHook.address,
    managerRedemptionHook: preNavIssuanceHook.address,
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

  console.log("Issuing 10 SetTokens...");

  // Issue 1 SetTokens
  setup.issuanceModule = setup.issuanceModule.connect(manager);
  await setup.issuanceModule.issue(setToken.address, ether(0.001), manager.address);

  console.log("SetToken Balance after normal issuance:");

  let setTokenBalance = await setToken.balanceOf(manager.address);
  console.log(`Managers's SetToken Balance: ${ethers.utils.formatEther(setTokenBalance)} SET`);

  setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
  await setup.navIssuanceModule.issue(setToken.address, setup.weth.address, ether(0.001), ether(0), manager.address);

  console.log("Balances after NAV issuance:\n");

  setTokenBalance = await setToken.balanceOf(manager.address);
  console.log(`Manager's SetToken Balance: ${ethers.utils.formatEther(setTokenBalance)} SET`);

  let wethBalance = await setup.weth.balanceOf(setToken.address);
  console.log(`SetToken Balance: ${ethers.utils.formatEther(wethBalance)} WETH`);

  const newConstituents: string[] = [];
  const newUnits: BigNumber[] = [];

  // rewrite all the weights array setting the first to max and the rest to 0
  for (let i = 0; i < weights.length; i++) {
    if (i < 9) {
      weights[i] = BigNumber.from("1100000000000000000");
    } else {
      weights[i] = BigNumber.from("0");
    }
  }

  weights.push(BigNumber.from("0"));

  for (let i = 0; i < weights.length; i++) {
    weights[i] = weights[i].mul(95).div(100);
  }

  console.log("Executing rebalance...");

  let multiSigInstance = MultiSigInstance.connect(manager);
  await multiSigInstance.submitRebalance(newConstituents, newUnits, weights, BigNumber.from("1000000000000000000"));
  multiSigInstance = MultiSigInstance.connect(manager);
  await multiSigInstance.confirmRebalance();
  multiSigInstance = MultiSigInstance.connect(manager);
  await multiSigInstance.executeRebalance();

  console.log("rebalance executed!");

  const IndexModuleInstance = indexModule.connect(manager);

  console.log("Before trade");
  for (let i = 0; i < setup.components.length; i++) {
    const component = setup.components[i];
    const componentBalance = await component.balanceOf(setToken.address);
    console.log(`SetToken Balance: ${ethers.utils.formatEther(componentBalance)}`);
  }

  // iterate over all components and call trade
  for (let i = setup.components.length - 1; i >= 0; i--) {
    const component = setup.components[i];
    try {
      if (i < 9) {
        await IndexModuleInstance.trade(setToken.address, component.address, ether(20));
      } else {
        await IndexModuleInstance.trade(setToken.address, component.address, ether(0));
      }
    } catch (e) {
      console.log("Error in token with index: " + i);
      console.log(e);
    }
  }

  console.log(setup.components.map(component => component.address));

  console.log("After trade");
  for (let i = 0; i < setup.components.length; i++) {
    const component = setup.components[i];
    const componentBalance = await component.balanceOf(setToken.address);
    console.log(`SetToken Balance: ${ethers.utils.formatEther(componentBalance)}`);
  }

  wethBalance = await setup.weth.balanceOf(setToken.address);
  console.log(`SetToken Balance: ${ethers.utils.formatEther(wethBalance)} WETH`);

  setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
  await setup.navIssuanceModule.redeem(setToken.address, setup.weth.address, ether(0.001), ether(0), manager.address);

  setTokenBalance = await setToken.balanceOf(manager.address);
  console.log(`Manager's SetToken Balance: ${ethers.utils.formatEther(setTokenBalance)} SET`);

  wethBalance = await setup.weth.balanceOf(setToken.address);
  console.log(`SetToken Balance: ${ethers.utils.formatEther(wethBalance)} WETH`);

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });