import "module-alias/register";


import hre from "hardhat";
import { ethers } from "hardhat";

async function main() {

  const [manager] = await ethers.getSigners();

  const MultiSigOperator = await hre.ethers.getContractFactory("MultiSigOperator");
  const MultiSigInstance = await MultiSigOperator.deploy(
    [
      manager.address,
      "0xC46d6ef4136c26B1852065a4059Bde62071E8B1a",
      "0xA2bd8A9C88c4dD4014144C6536058942fdb95b50",
      "0x8D7300F28923F74A65a94B1cC3482ddc5A534f05",
      "0x939399ed6433e58d6e9a31d260c29f2bba3273de",
      "0x8Fa3C3157e3963ce4b67d326171b687F04EdB824"
    ], 3, 5, manager.address, "0x8Fa3C3157e3963ce4b67d326171b687F04EdB824"
  );

  await MultiSigInstance.deployed();

  // Estimate gas
  const gasEstimate = await ethers.provider.estimateGas({
    from: MultiSigInstance.deployTransaction.from,
    to: MultiSigInstance.deployTransaction.to,
    data: MultiSigInstance.deployTransaction.data,
    value: MultiSigInstance.deployTransaction.value,
  });

  // Gas Price (in Gwei)
  const gasPriceGwei = 0.01297917;

  // Convert Gas Price to BigNumber for accurate arithmetic
  const gasPrice = ethers.utils.parseUnits(gasPriceGwei.toString(), "gwei");

  // Calculate total gas cost in Wei (gasEstimate * gasPrice)
  const totalGasCostWei = gasEstimate.mul(gasPrice);

  // Convert total gas cost to Ether
  const totalGasCostEth = ethers.utils.formatEther(totalGasCostWei);

  // Ethereum Price in USD
  const ethPrice = 2200;

  // Calculate total cost in USD
  const totalCostUSD = parseFloat(totalGasCostEth) * ethPrice;

  console.log(totalGasCostWei.toString());

  console.log(`Cost to deploy: ${totalCostUSD} USD`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });