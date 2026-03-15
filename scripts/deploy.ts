import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const network = process.env.HARDHAT_NETWORK || "mainnet";
  const configRaw = fs.readFileSync("config/networks.json.example", "utf8");
  const config = JSON.parse(configRaw)[network];

  if (!config) {
    throw new Error(`Network ${network} missing in config/networks.json.example`);
  }

  const ArbitrageExecutor = await ethers.getContractFactory("ArbitrageExecutor");
  const executor = await ArbitrageExecutor.deploy(config.usdc, config.aavePool, config.balancerVault);
  await executor.waitForDeployment();

  console.log("ArbitrageExecutor deployed:", await executor.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
