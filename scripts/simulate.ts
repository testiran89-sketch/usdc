import { ethers } from "hardhat";
import { resolveExecutorAddress } from "../bot/runtimeConfig";

async function main() {
  const executorAddress = process.env.EXECUTOR_ADDRESS || resolveExecutorAddress();
  const executor = await ethers.getContractAt("ArbitrageExecutor", executorAddress);

  const calldata = executor.interface.encodeFunctionData("minimumProfitThreshold", []);
  const result = await ethers.provider.call({
    to: executorAddress,
    data: calldata
  });

  const minProfit = executor.interface.decodeFunctionResult("minimumProfitThreshold", result);
  console.log("Current minimum profit threshold:", minProfit[0].toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
