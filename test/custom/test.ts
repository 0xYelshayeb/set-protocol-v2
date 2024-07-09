import "module-alias/register";

import hre from "hardhat";

async function main() {

  // deploy Test.sol
  // const [deployer] = await hre.ethers.getSigners();

  const test = await hre.ethers.getContractFactory("Test");
  const testContract = await test.deploy();
  await testContract.deployed();

  // const tx = await testContract.test();

}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
