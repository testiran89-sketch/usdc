const hre = require('hardhat');
const { ethers } = require('ethers');
require('dotenv').config();

const DEFAULT_AAVE_POOL_ADDRESSES_PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb';

async function main() {
  const providerAddress = process.env.AAVE_POOL_ADDRESSES_PROVIDER || DEFAULT_AAVE_POOL_ADDRESSES_PROVIDER;
  const rpcUrl = hre.network.config.url || (process.env.RPC_URLS || '').split(',')[0]?.trim();
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for network "${hre.network.name}".`);
  }
  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required to deploy the contract.');
  }

  const artifact = await hre.artifacts.readArtifact('FlashLoanArbitrage');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(privateKey, provider);

  const executor = process.env.BOT_EXECUTOR || deployer.address;

  console.log(`Deploying with ${deployer.address}`);
  console.log(`Network: ${hre.network.name}`);
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Aave Provider: ${providerAddress}`);
  console.log(`Executor: ${executor}`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(providerAddress, deployer.address, executor);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`FlashLoanArbitrage deployed at ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
