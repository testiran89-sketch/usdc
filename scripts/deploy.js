const hre = require('hardhat');
const { ethers } = hre;
require('dotenv').config();

async function main() {
  const providerAddress = process.env.AAVE_POOL_ADDRESSES_PROVIDER;
  if (!providerAddress) {
    throw new Error('AAVE_POOL_ADDRESSES_PROVIDER is required in .env');
  }

  const [deployer] = await ethers.getSigners();
  const executor = process.env.BOT_EXECUTOR || deployer.address;

  console.log(`Deploying with ${deployer.address}`);
  console.log(`Aave Provider: ${providerAddress}`);
  console.log(`Executor: ${executor}`);

  const factory = await ethers.getContractFactory('FlashLoanArbitrage');
  const contract = await factory.deploy(providerAddress, deployer.address, executor);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`FlashLoanArbitrage deployed at ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
