const hre = require('hardhat');
const { ethers } = hre;
require('dotenv').config();

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`Deploying with ${deployer.address}`);
  console.log('Aave Provider: baked into contract for Arbitrum Aave v3');
  console.log(`Executor: ${deployer.address} (default; owner can update later)`);

  const factory = await ethers.getContractFactory('FlashLoanArbitrage');
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`FlashLoanArbitrage deployed at ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
