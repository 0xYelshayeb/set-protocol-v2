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
import fs from "fs";

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

  console.log("Deploying StreamingFeeModule...");

  let streamingFeeModule = await deployer.modules.deployStreamingFeeModule(setup.controller.address);
  await setup.controller.addModule(streamingFeeModule.address);

  console.log("Deploying GeneralIndexModule...");

  // IndexModule Deployment
  let indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
  await setup.controller.addModule(indexModule.address);

  const managerWethBalance = await setup.weth.balanceOf(manager.address);

  const kyberSetup = getKyberV3DMMFixtureDeploy(manager.address);
  await kyberSetup.initialize(managerAccount, setup.weth, setup.components, setup.oracles, managerWethBalance.mul(50).div(100));

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

  console.log("Deploying BasicIssuanceModule...");

  // Deploy mock issuance hook and initialize issuance module
  setup.issuanceModule = setup.issuanceModule.connect(manager);
  const mockPreIssuanceHook = await deployer.mocks.deployManagerIssuanceHookMock();
  await setup.issuanceModule.initialize(setToken.address, mockPreIssuanceHook.address);

  console.log("Deploying NAVIssuanceModule...");

  // Deploy mock nav issuance hook and initialize nav issuance module
  setup.navIssuanceModule = setup.navIssuanceModule.connect(manager);
  const preNavIssuanceHookContract = await hre.ethers.getContractFactory("IssuanceHook");
  const preNavIssuanceHook = await preNavIssuanceHookContract.deploy(indexModule.address);

  const navIssuanceSettings = {
    managerIssuanceHook: preNavIssuanceHook.address,
    managerRedemptionHook: preNavIssuanceHook.address,
    setValuer: "0x0000000000000000000000000000000000000000",
    reserveAssets: [setup.weth.address],
    feeRecipient: manager.address,
    managerFees: [BigNumber.from("0"), BigNumber.from("0")],
    maxManagerFee: BigNumber.from("0"),
    premiumPercentage: BigNumber.from("0"),
    maxPremiumPercentage: BigNumber.from("0"),
    minSetTokenSupply: BigNumber.from("1") // 1 SetToken (in wei)
  } as NAVIssuanceSettingsStruct;
  await setup.navIssuanceModule.initialize(setToken.address, navIssuanceSettings);

  // Approve WETH on navIssuanceModule
  setup.weth = setup.weth.connect(manager);
  await setup.weth.approve(setup.navIssuanceModule.address, ethers.constants.MaxUint256);

  console.log("Deploying ICManager...");

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
    [
      manager.address,
      "0xC46d6ef4136c26B1852065a4059Bde62071E8B1a",
      "0xA2bd8A9C88c4dD4014144C6536058942fdb95b50",
      "0x8D7300F28923F74A65a94B1cC3482ddc5A534f05",
      "0x939399ed6433e58d6e9a31d260c29f2bba3273de",
      "0x8Fa3C3157e3963ce4b67d326171b687F04EdB824"
    ], 3, 5, manager.address, icManagerInstance.address
  );

  await MultiSigInstance.deployed();

  // Update Operator
  icManagerInstance = icManagerInstance.connect(manager);
  await icManagerInstance.updateOperator(MultiSigInstance.address);

  // write addresses to file
  const addresses = {
    setToken: setToken.address,
    icManager: icManagerInstance.address,
    streamingFeeModule: streamingFeeModule.address,
    indexModule: indexModule.address,
    kyberExchangeAdapter: kyberExchangeAdapter.address,
    multiSigOperator: MultiSigInstance.address,
    navIssuanceModule: setup.navIssuanceModule.address,
    basicIssuanceModule: setup.issuanceModule.address,
    oracleAddresses: setup.oracles.map(oracle => oracle.address),
    components: setup.components.map(component => component.address),
    weth: setup.weth.address,
  };

  fs.writeFileSync("test/custom/addresses.json", JSON.stringify(addresses, undefined, 2));

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });