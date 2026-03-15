import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const network = process.env.HARDHAT_NETWORK || process.env.CHAIN || "mainnet";
  const configRaw = fs.readFileSync("config/networks.json.example", "utf8");
  const config = JSON.parse(configRaw)[network];

  if (!config) {
    throw new Error(`Network ${network} missing in config/networks.json.example`);
  }

  const ArbitrageExecutor = await ethers.getContractFactory("ArbitrageExecutor");
  const executor = await ArbitrageExecutor.deploy(config.usdc, config.aavePool, config.balancerVault);
  await executor.waitForDeployment();

  const executorAddress = await executor.getAddress();
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    "deployments/latest.json",
    JSON.stringify({ chain: network, executor: executorAddress, deployedAt: new Date().toISOString() }, null, 2)
  );

  console.log("ArbitrageExecutor deployed:", executorAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
