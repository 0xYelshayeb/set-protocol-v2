import "module-alias/register";

import { ethers } from "hardhat";

async function main() {

  const [manager] = await ethers.getSigners();

  console.log(manager.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });