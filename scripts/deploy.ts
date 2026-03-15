import { ethers } from "hardhat";
import { getAddress } from "ethers";
import * as fs from "fs";

function normalizeAddress(value: string, field: string): string {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`Invalid address in config for ${field}: ${value}`);
  }
}

async function main() {
  const network = process.env.HARDHAT_NETWORK || process.env.CHAIN || "mainnet";
  const configRaw = fs.readFileSync("config/networks.json.example", "utf8");
  const config = JSON.parse(configRaw)[network];

  if (!config) {
    throw new Error(`Network ${network} missing in config/networks.json.example`);
  }

  const usdc = normalizeAddress(config.usdc, "usdc");
  const aavePool = normalizeAddress(config.aavePool, "aavePool");
  const balancerVault = normalizeAddress(config.balancerVault, "balancerVault");

  const ArbitrageExecutor = await ethers.getContractFactory("ArbitrageExecutor");
  const executor = await ArbitrageExecutor.deploy(usdc, aavePool, balancerVault);
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
