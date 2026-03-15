import { JsonRpcProvider, Wallet, Contract, Interface, parseUnits } from "ethers";
import fs from "fs";
import { Opportunity, scanLoop } from "./scanner";

const EXECUTOR_ABI = [
  "function executeArbitrage((address,uint256,(uint8,address,address,address,uint256,bytes)[],uint256,uint8)) external",
  "function minimumProfitThreshold() view returns (uint256)"
];

const CHAIN = process.env.CHAIN || "mainnet";
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS || "";
const FLASHBOTS_RELAY = process.env.FLASHBOTS_RELAY || "https://relay.flashbots.net";
const MAX_GAS_USDC = BigInt(process.env.MAX_GAS_USDC || 20_000_000);

if (!process.env.RPC_URL) throw new Error("Missing RPC_URL");
if (!process.env.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");
if (!EXECUTOR_ADDRESS) throw new Error("Missing EXECUTOR_ADDRESS");

const provider = new JsonRpcProvider(process.env.RPC_URL);
const privateProvider = new JsonRpcProvider(FLASHBOTS_RELAY);
const signer = new Wallet(process.env.PRIVATE_KEY, provider);
const privateSigner = new Wallet(process.env.PRIVATE_KEY, privateProvider);
const executor = new Contract(EXECUTOR_ADDRESS, EXECUTOR_ABI, signer);
const networks = JSON.parse(fs.readFileSync("config/networks.json.example", "utf8"));
const cfg = networks[CHAIN];

function estimateGasCostUSDC(gasLimit: bigint, maxFeePerGas: bigint): bigint {
  const ethCost = gasLimit * maxFeePerGas;
  const ethUsd = parseUnits(process.env.ETH_PRICE_USD || "3500", 6);
  return (ethCost * ethUsd) / parseUnits("1", 18);
}

async function simulateOpportunity(opp: Opportunity): Promise<{ profitable: boolean; calldata: string; gasCost: bigint }> {
  const minProfitThreshold = (await executor.minimumProfitThreshold()) as bigint;
  if (opp.expectedProfit < minProfitThreshold) {
    return { profitable: false, calldata: "0x", gasCost: 0n };
  }

  const steps = [
    [0, cfg.sushiRouter, cfg.usdc, cfg.weth, opp.buyOut, "0x"],
    [1, cfg.sushiRouter, cfg.weth, cfg.usdc, opp.sellOut, "0x"]
  ];

  const args = [cfg.usdc, opp.amountIn, steps, minProfitThreshold, 0];
  const iface = new Interface(EXECUTOR_ABI);
  const calldata = iface.encodeFunctionData("executeArbitrage", [args]);

  const tx = {
    from: await signer.getAddress(),
    to: EXECUTOR_ADDRESS,
    data: calldata,
    value: 0
  };

  await provider.call(tx);

  const gas = await provider.estimateGas(tx);
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas || parseUnits("20", "gwei");
  const gasCost = estimateGasCostUSDC(gas, maxFeePerGas);

  return {
    profitable: opp.expectedProfit > gasCost + MAX_GAS_USDC,
    calldata,
    gasCost
  };
}

async function submitPrivateTransaction(calldata: string) {
  const feeData = await provider.getFeeData();
  const tx = await privateSigner.sendTransaction({
    chainId: Number((await provider.getNetwork()).chainId),
    to: EXECUTOR_ADDRESS,
    data: calldata,
    type: 2,
    maxFeePerGas: feeData.maxFeePerGas || parseUnits("30", "gwei"),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || parseUnits("2", "gwei"),
    gasLimit: 1_500_000
  });

  console.log("[executor] private tx hash", tx.hash);
}

async function main() {
  await scanLoop(async (opp) => {
    const simulation = await simulateOpportunity(opp);
    if (!simulation.profitable) {
      console.log(`[executor] skipped ${opp.pair} not profitable after gas`);
      return;
    }

    console.log(`[executor] submitting private tx for ${opp.pair}; gasCostUSDC=${simulation.gasCost}`);
    await submitPrivateTransaction(simulation.calldata);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
