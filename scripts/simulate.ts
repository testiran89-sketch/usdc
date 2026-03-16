import "dotenv/config";
import { Contract, JsonRpcProvider } from "ethers";
import { getChain, resolveExecutorAddress, resolveRpcUrl } from "../bot/runtimeConfig";

const EXECUTOR_ABI = ["function minimumProfitThreshold() view returns (uint256)"];

async function main() {
  const chain = getChain();
  const rpcUrl = resolveRpcUrl(chain);
  const executorAddress = process.env.EXECUTOR_ADDRESS || resolveExecutorAddress();

  const provider = new JsonRpcProvider(rpcUrl);
  const executor = new Contract(executorAddress, EXECUTOR_ABI, provider);

  const minProfit = (await executor.minimumProfitThreshold()) as bigint;
  console.log("Chain:", chain);
  console.log("Executor:", executorAddress);
  console.log("Current minimum profit threshold:", minProfit.toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
