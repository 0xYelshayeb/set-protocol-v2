import "module-alias/register";

import {
  getSystemFixtureDeploy,
} from "@utils/test/index";

import DeployHelper from "@utils/deploys";
import { ether } from "@utils/common";
import { BigNumber } from "ethers";
import hre from "hardhat";
import { ethers } from "hardhat";
import { NAVIssuanceSettingsStruct } from "@typechain/CustomOracleNavIssuanceModule";
import { MAX_UINT_256 } from "@utils/constants";
import { NULL_ADDRESS } from "@0x/utils";

async function main() {

  const [manager] = await ethers.getSigners();

  const deployer = new DeployHelper(manager);

  const setup = getSystemFixtureDeploy(manager.address);

  await setup.initialize();

  console.log("Deploying GeneralIndexModule...");

  // IndexModule Deployment
  let indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
  await setup.controller.addModule(indexModule.address);

  const uniAdapter = await deployer.adapters.deployUniswapV3IndexExchangeAdapter(
    setup.uniswapRouterAddress,
  );
  const uniAdapterName = "Uni";

  await setup.integrationRegistry.batchAddIntegration(
    [indexModule.address],
    [uniAdapterName],
    [uniAdapter.address],
  );

  console.log("Deploying SetToken...");
  // Deploy SetToken with navIissuanceModule, indexmodule
  let setToken = await setup.createSetToken(
    setup.components.map(com => com.address),
    setup.components.map(() => ether(1).div(setup.components.length)),
    [
      setup.issuanceModule.address,
      setup.navIssuanceModule.address,
      indexModule.address,
    ],
    manager.address,
    "SetToken",
    "SET"
  );

  console.log("Deploying BasicIssuanceModule...");

  // Deploy mock issuance hook and initialize issuance module
  setup.issuanceModule = setup.issuanceModule.connect(manager);
  const mockPreIssuanceHook = await deployer.mocks.deployManagerIssuanceHookMock();
  await setup.issuanceModule.initialize(setToken.address, mockPreIssuanceHook.address);

  console.log("Deploying NAVIssuanceModule...");

  // Deploy mock nav issuance hook and initialize nav issuance module
  setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
  const preNavIssuanceHookContract = await hre.ethers.getContractFactory("IssuanceHook");
  const preNavIssuanceHook = await preNavIssuanceHookContract.deploy(indexModule.address,
    setup.weth.address, setToken.address, setup.setValuer.address, setup.uniswapPriceAdapter.address);

  const navIssuanceSettings = {
    managerIssuanceHook: preNavIssuanceHook.address,
    managerRedemptionHook: preNavIssuanceHook.address,
    setValuer: setup.setValuer.address,
    reserveAssets: [setup.weth.address],
    feeRecipient: manager.address,
    managerFees: [BigNumber.from("0"), BigNumber.from("0")],
    maxManagerFee: BigNumber.from("0"),
    premiumPercentage: BigNumber.from("0"),
    maxPremiumPercentage: BigNumber.from("0"),
    minSetTokenSupply: BigNumber.from("1")
  } as NAVIssuanceSettingsStruct;
  await setup.navIssuanceModule.initialize(setToken.address, navIssuanceSettings);

  // Approve weth on navIssuanceModule
  setup.weth = setup.weth.connect(manager);
  await setup.weth.approve(setup.navIssuanceModule.address, ethers.constants.MaxUint256);

  console.log("Deploying ICManager...");

  const ICManager = await hre.ethers.getContractFactory("ICManager");
  let icManagerInstance = await ICManager.deploy(
    setToken.address, indexModule.address, NULL_ADDRESS, manager.address, manager.address, 0
  );
  await icManagerInstance.deployed();

  console.log("Initialized SetToken modules...");

  // Initialize IndexModule
  indexModule = indexModule.connect(manager);
  await indexModule.initialize(setToken.address);
  await setToken.isInitializedModule(indexModule.address);

  console.log("Initialized IndexModule...");

  indexModule = indexModule.connect(manager);
  await indexModule.setExchanges(
    setToken.address,
    setup.components.map(com => com.address),
    setup.components.map(() => uniAdapterName)
  );

  const exchangeData = await uniAdapter.getEncodedFeeData(500);

  indexModule = indexModule.connect(manager);
  await indexModule.setExchangeData(
    setToken.address,
    setup.components.map(component => component.address),
    setup.components.map(() => exchangeData)
  );

  // set trade maximums to max for all components
  indexModule = indexModule.connect(manager);
  await indexModule.setTradeMaximums(
    setToken.address,
    setup.components.map(component => component.address),
    setup.components.map(() => MAX_UINT_256)
  );

  setToken = setToken.connect(manager);
  let tx = await setToken.setManager(icManagerInstance.address);
  await tx.wait();

  icManagerInstance = icManagerInstance.connect(manager);
  tx = await icManagerInstance.updateTraderStatus(
    [manager.address, preNavIssuanceHook.address],
    [true, true]
  );


  console.log("Deploying MultiSigOperator...");

  // Deploy MultiSigOperator
  const MultiSigOperator = await hre.ethers.getContractFactory("MultiSigOperator");
  const MultiSigInstance = await MultiSigOperator.deploy(
    [
      manager.address,
      "0xC46d6ef4136c26B1852065a4059Bde62071E8B1a",
      "0xCc0D56c6cDC2677343ddC7aE63Ba801334869051",
      "0x8D7300F28923F74A65a94B1cC3482ddc5A534f05",
      "0x939399ed6433e58d6e9a31d260c29f2bba3273de",
      "0x8Fa3C3157e3963ce4b67d326171b687F04EdB824"
    ], 1, 1, manager.address, icManagerInstance.address, preNavIssuanceHook.address
  );

  await MultiSigInstance.deployed();

  console.log("Updating Operator...");

  // Update Operator
  icManagerInstance = icManagerInstance.connect(manager);
  await icManagerInstance.updateOperator(MultiSigInstance.address);

  await preNavIssuanceHook.setNavIssuanceModule(setup.navIssuanceModule.address);
  await preNavIssuanceHook.setMultiSigOperator(MultiSigInstance.address);

  setup.issuanceModule = setup.issuanceModule.connect(manager);
  const tx1 = await setup.issuanceModule.issue(setToken.address, ether(100), manager.address);
  await tx1.wait();

  console.log("Issued setToken with issuanceModule");

  setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
  const tx2 = await setup.navIssuanceModule.issue(setToken.address, setup.weth.address, ether(10), ether(0), manager.address);
  await tx2.wait();

  console.log("Issued setToken with navIssuanceModule");

  // MultiSigInstance = MultiSigInstance.connect(manager);
  // await MultiSigInstance.submitRebalance([], [], [ether(0.8), ether(0.2), ether(0)], ether(1))
  // await MultiSigInstance.confirmRebalance();
  // await MultiSigInstance.executeRebalance();

  // trade all components
  // indexModule = indexModule.connect(manager);
  // const tx3 = await indexModule.trade(setToken.address, setup.uni.address, 0);
  // await tx3.wait();

  // indexModule = indexModule.connect(manager);
  // const tx4 = await indexModule.trade(setToken.address, setup.aave.address, MAX_UINT_256);
  // await tx4.wait();

  setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
  const tx3 = await setup.navIssuanceModule.redeem(setToken.address, setup.weth.address, ether(50), ether(1), manager.address);
  await tx3.wait();
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });