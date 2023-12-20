const { ethers } = require("hardhat");
const deployedAddresses = require("./deployedAddresses.json");
import { Contract } from "ethers";
import { StreamingFeeModule, GeneralIndexModule } from "@utils/contracts/index";
import { BigNumber } from "ethers";

async function interactWithContracts() {

  // Get the signer
  const [signer] = await ethers.getSigners();

  // Create contract instances
  const controller: Contract = await ethers.getContractAt("Controller", deployedAddresses.Controller, signer);
  const streamingFeeModule: StreamingFeeModule= await ethers.getContractAt("StreamingFeeModule", deployedAddresses.StreamingFeeModule, signer);
  const indexModule: GeneralIndexModule = await ethers.getContractAt("GeneralIndexModule", deployedAddresses.GeneralIndexModule, signer);
  const setToken: Contract = await ethers.getContractAt("SetToken", deployedAddresses.SetToken, signer);
  const icManager: Contract = await ethers.getContractAt("ICManager", deployedAddresses.ICManager, signer);
  const multiSigOperator: Contract = await ethers.getContractAt("MultiSigOperator", deployedAddresses.MultiSigOperator, signer);

  console.log("address of controller: ", controller.address);
  console.log("address of streamingFeeModule: ", streamingFeeModule.address);
  console.log("address of indexModule: ", indexModule.address);
  console.log("address of setToken: ", setToken.address);
  console.log("address of icManager: ", icManager.address);
  console.log("address of multiSigOperator: ", multiSigOperator.address);

  const weights = [];
  for (let i = 0; i < 10; i++) {
    weights.push(BigNumber.from(100000000));
  }

  const mockR = [[], [], weights, 1];

  let multiSigInstance = multiSigOperator.connect(signer);
  await multiSigInstance.submitRebalance(...mockR);
  multiSigInstance = multiSigOperator.connect(signer);
  await multiSigInstance.confirmRebalance();
  multiSigInstance = multiSigOperator.connect(signer);
  await multiSigInstance.executeRebalance();

  const IndexModuleInstance = indexModule.connect(signer);
  IndexModuleInstance.trade(deployedAddresses.SetToken, deployedAddresses.ComponentAddresses[0], 1);
}

interactWithContracts()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
