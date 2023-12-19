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

async function main() {

  const wbtcUnits = BigNumber.from(100000000); // 1 WBTC in base units 1 * 10 ** 8

  const [manager] = await ethers.getSigners();

  console.log(`Deploying contracts with the account: ${manager.address}`);

  const deployer = new DeployHelper(manager);

  const setup = getSystemFixtureDeploy(manager.address);

  await setup.initialize();

  console.log("setup.initialize() done");

  let streamingFeeModule = await deployer.modules.deployStreamingFeeModule(setup.controller.address);
  await setup.controller.addModule(streamingFeeModule.address);

  // IndexModule Deployment
  let indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
  await setup.controller.addModule(indexModule.address);

  // Deploy SetToken with issuanceModule, TradeModule, and StreamingFeeModule
  let setToken = await setup.createSetToken(
    [setup.wbtc.address],
    [wbtcUnits],
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

  // Deploy MultiSigOperator
  const MultiSigOperator = await hre.ethers.getContractFactory("MultiSigOperator");
  const MultiSigInstance = await MultiSigOperator.deploy(
    [manager.address], 1, 1, manager.address, icManagerInstance.address
  );
  await MultiSigInstance.deployed();

  // Update Operator
  icManagerInstance = icManagerInstance.connect(manager);
  await icManagerInstance.updateOperator(MultiSigInstance.address);

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });