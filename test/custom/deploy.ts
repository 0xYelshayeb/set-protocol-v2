import "module-alias/register";

import {
  getSystemFixtureDeploy,
} from "@utils/test/index";

import DeployHelper from "@utils/deploys";
import { ether } from "@utils/common";
import { BigNumber } from "ethers";
import { StreamingFeeState } from "@utils/types";
import { ZERO } from "@utils/constants";
import hre from "hardhat";
import { ethers } from "hardhat";
import fs from "fs";

async function main() {

  const [manager] = await ethers.getSigners();

  console.log(`Deploying contracts with the account: ${manager.address}`);

  const deployer = new DeployHelper(manager);

  const setup = getSystemFixtureDeploy(manager.address);

  await setup.initialize();

  const weights = [];
  for (let i = 0; i < 10; i++) {
    weights.push(BigNumber.from(100000000));
  }

  let streamingFeeModule = await deployer.modules.deployStreamingFeeModule(setup.controller.address);
  await setup.controller.addModule(streamingFeeModule.address);

  // IndexModule Deployment
  let indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
  await setup.controller.addModule(indexModule.address);

  // Deploy SetToken with issuanceModule, TradeModule, and StreamingFeeModule
  let setToken = await setup.createSetToken(
    setup.components.map(component => component.address),
    weights,
    [
      setup.navIssuanceModule.address,
      streamingFeeModule.address,
      indexModule.address,
    ],
    manager.address,
    "SetToken",
    "SET"
  );

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

  // TradeModule Deployment
  const tradeModule = await deployer.modules.deployTradeModule(setup.controller.address);
  await setup.controller.addModule(tradeModule.address);

  // Deploy Mock Kyber reserve. Only allows trading from/to WETH
  const kyberNetworkProxy = await deployer.mocks.deployKyberNetworkProxyMock(setup.weth.address);
  for (let i = 0; i < setup.components.length; i++) {
    await kyberNetworkProxy.addToken(setup.components[i].address, weights[i], 8);
  }
  const kyberExchangeAdapter = await deployer.adapters.deployKyberExchangeAdapter(
    kyberNetworkProxy.address,
  );
  const kyberAdapterName = "KYBER";

  await setup.integrationRegistry.batchAddIntegration(
    [tradeModule.address],
    [kyberAdapterName],
    [kyberExchangeAdapter.address],
  );

  const addresses = {
    Controller: setup.controller.address,
    NAVIssuanceModule: setup.navIssuanceModule.address,
    ComponentAddresses: setup.components.map(component => component.address),
    OracleAddress: setup.priceOracle.address,
    IntegrationRegistry: setup.integrationRegistry.address,
    SetValuer: setup.setValuer.address,
    SetTokenCreator: setup.factory.address,
    StreamingFeeModule: streamingFeeModule.address,
    GeneralIndexModule: indexModule.address,
    SetToken: setToken.address,
    ICManager: icManagerInstance.address,
    MultiSigOperator: MultiSigInstance.address,
  };

  fs.writeFileSync("test/custom/deployedAddresses.json", JSON.stringify(addresses, undefined, 2));

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });