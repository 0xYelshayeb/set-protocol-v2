import "module-alias/register";

import { ethers } from "hardhat";
import deployedAddresses from "./addresses.json";
import { Contract } from "ethers";
import { GeneralIndexModule, BasicIssuanceModule, CustomOracleNavIssuanceModule } from "@utils/contracts/index";
import { MultiSigOperator } from "@typechain/MultiSigOperator";
import { ether } from "@utils/index";
import { MAX_UINT_256 } from "@utils/constants";


async function interactWithContracts() {

  const [signer] = await ethers.getSigners();
  console.log(signer.address);

  // Create contract instances
  let indexModule: GeneralIndexModule = await ethers.getContractAt("GeneralIndexModule", deployedAddresses.indexModule, signer);
  const setToken: Contract = await ethers.getContractAt("SetToken", deployedAddresses.setToken, signer);
  let multiSigOperator: MultiSigOperator = await ethers.getContractAt("MultiSigOperator", deployedAddresses.multiSigOperator, signer);
  let issuanceModule: BasicIssuanceModule = await ethers.getContractAt("BasicIssuanceModule", deployedAddresses.basicIssuanceModule, signer);
  let navIissuanceModule: CustomOracleNavIssuanceModule = await ethers.getContractAt("CustomOracleNavIssuanceModule",
    deployedAddresses.navIssuanceModule, signer);
  const components = deployedAddresses.components;

  issuanceModule = issuanceModule.connect(signer);
  const tx0 = await issuanceModule.issue(setToken.address, ether(200), signer.address);
  await tx0.wait();

  console.log("Issued setToken with issuanceModule");

  navIissuanceModule = navIissuanceModule.connect(signer);
  const tx1 = await navIissuanceModule.issue(setToken.address, deployedAddresses.weth, ether(10), ether(0), signer.address);
  await tx1.wait();

  console.log("Issued setToken with navIssuanceModule");

  multiSigOperator = multiSigOperator.connect(signer);

  const tx2 = await multiSigOperator.submitRebalance([], [], [ether(0.5), ether(0.5), ether(0)], ether(1));
  await tx2.wait();

  multiSigOperator = multiSigOperator.connect(signer);

  const tx3 = await multiSigOperator.confirmRebalance();
  await tx3.wait();

  multiSigOperator = multiSigOperator.connect(signer);

  const tx4 = await multiSigOperator.executeRebalance();
  await tx4.wait();

  console.log("Rebalanced setToken");

  // trade all components
  indexModule = indexModule.connect(signer);
  const tx = await indexModule.trade(setToken.address, components[0], MAX_UINT_256);
  await tx.wait();

  console.log("Traded component 1");

  indexModule = indexModule.connect(signer);
  const tx5 = await indexModule.trade(setToken.address, components[1], 0);
  await tx5.wait();

  console.log("Traded all components");

  issuanceModule = issuanceModule.connect(signer);
  const tx6 = await issuanceModule.redeem(setToken.address, ether(10), signer.address);
  await tx6.wait();

  console.log("Redeemed setToken and issuanceModule");

  navIissuanceModule = navIissuanceModule.connect(signer);
  const tx7 = await navIissuanceModule.redeem(setToken.address, deployedAddresses.weth, ether(5), ether(1), signer.address);
  await tx7.wait();

  console.log("Redeemed setToken and navIssuanceModule");

}

interactWithContracts()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
