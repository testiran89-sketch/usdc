const hre = require('hardhat');
const { ethers } = hre;
require('dotenv').config();

const DEFAULT_AAVE_POOL_ADDRESSES_PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';

async function main() {
  const providerAddress = process.env.AAVE_POOL_ADDRESSES_PROVIDER || DEFAULT_AAVE_POOL_ADDRESSES_PROVIDER;

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
