import "module-alias/register";

import {
  getSystemFixtureDeployReduced,
  getKyberV3DMMFixtureDeploy
} from "@utils/test/index";

import { ether } from "@utils/common";
import { ethers } from "hardhat";
import { Account } from "@utils/test/types";

async function main() {

  const [manager] = await ethers.getSigners();

  const managerAccount: Account = {
    wallet: manager,
    address: await manager.getAddress(),
  };

  const setup = getSystemFixtureDeployReduced(manager.address);
  await setup.initialize();

  console.log("Fund manager with WETH...");
  const tx = await setup.weth.connect(manager).deposit({ value: ether("0.1") });
  await tx.wait();
  console.log("Fund manager with WETH... Done");

  const kyberSetup = getKyberV3DMMFixtureDeploy(manager.address);
  await kyberSetup.initialize(managerAccount, setup.weth, setup.components, setup.oracles);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });