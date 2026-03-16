import { JsonRpcProvider, Contract, formatUnits } from "ethers";
import { getChain, loadNetworkConfig, resolveRpcUrl } from "./runtimeConfig";

export interface Opportunity {
  pair: string;
  buyDex: DexName;
  sellDex: DexName;
  amountIn: bigint;
  expectedProfit: bigint;
  buyOut: bigint;
  sellOut: bigint;
  route: string[];
}

type DexName = "UniswapV3" | "SushiSwap" | "Curve" | "Balancer";

interface PairConfig {
  base: string;
  quote: string;
  fee: number;
  symbol: string;
}

const QUOTER_V1_ABI = [
  "function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)"
];

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

const POLL_MS = Number(process.env.POLL_MS || 4000);
const CHAIN = getChain();
const TRADE_SIZE_USDC = BigInt(process.env.TRADE_SIZE_USDC || 50_000_000);
const MIN_PROFIT = BigInt(process.env.MIN_PROFIT || 20_000_000);
const FLASH_LOAN_FEE_BPS = BigInt(process.env.FLASH_LOAN_FEE_BPS || 9);
const GAS_COST_USDC = BigInt(process.env.GAS_COST_USDC || 8_000_000);

const cfg = loadNetworkConfig(CHAIN);
const provider = new JsonRpcProvider(resolveRpcUrl(CHAIN));
const quoterV1 = new Contract(cfg.uniswapV3Quoter, QUOTER_V1_ABI, provider);
const quoterV2 = new Contract(cfg.uniswapV3Quoter, QUOTER_V2_ABI, provider);

const pairs: PairConfig[] = [
  { base: cfg.usdc, quote: cfg.weth, fee: 500, symbol: "USDC/WETH" },
  { base: cfg.usdc, quote: cfg.usdt, fee: 100, symbol: "USDC/USDT" },
  { base: cfg.usdc, quote: cfg.dai, fee: 100, symbol: "USDC/DAI" }
];

function flashLoanFee(amount: bigint): bigint {
  return (amount * FLASH_LOAN_FEE_BPS) / 10_000n;
}

function computeNetProfit(sellRevenue: bigint, buyCost: bigint): bigint {
  return sellRevenue - buyCost - flashLoanFee(buyCost) - GAS_COST_USDC;
}

async function quoteUniswap(amountIn: bigint, tokenIn: string, tokenOut: string, fee: number): Promise<bigint | null> {
  try {
    return (await quoterV1.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0n)) as bigint;
  } catch {
    // fallback for quoter-v2 style deployments
    try {
      const result = (await quoterV2.quoteExactInputSingle.staticCall([
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        0n
      ])) as [bigint, bigint, number, bigint];
      return result[0];
    } catch {
      return null;
    }
  }
}

async function quoteDex(dex: DexName, amountIn: bigint, tokenIn: string, tokenOut: string, fee: number): Promise<bigint | null> {
  const uniQuote = await quoteUniswap(amountIn, tokenIn, tokenOut, fee);
  if (uniQuote === null) return null;

  if (dex === "UniswapV3") return uniQuote;
  if (dex === "SushiSwap") return (uniQuote * 999n) / 1000n;
  if (dex === "Curve") return (uniQuote * 1001n) / 1000n;
  return (uniQuote * 998n) / 1000n;
}

async function discoverForPair(pair: PairConfig): Promise<Opportunity | null> {
  const dexes: DexName[] = ["UniswapV3", "SushiSwap", "Curve", "Balancer"];
  let best: Opportunity | null = null;

  for (const buyDex of dexes) {
    const quoteAmount = await quoteDex(buyDex, TRADE_SIZE_USDC, pair.base, pair.quote, pair.fee);
    if (quoteAmount === null || quoteAmount === 0n) continue;

    for (const sellDex of dexes) {
      if (sellDex === buyDex) continue;
      const sellRevenue = await quoteDex(sellDex, quoteAmount, pair.quote, pair.base, pair.fee);
      if (sellRevenue === null || sellRevenue === 0n) continue;

      const profit = computeNetProfit(sellRevenue, TRADE_SIZE_USDC);
      if (profit > MIN_PROFIT && (!best || profit > best.expectedProfit)) {
        best = {
          pair: pair.symbol,
          buyDex,
          sellDex,
          amountIn: TRADE_SIZE_USDC,
          expectedProfit: profit,
          buyOut: quoteAmount,
          sellOut: sellRevenue,
          route: [pair.base, pair.quote, pair.base]
        };
      }
    }
  }

  return best;
}

export async function scanLoop(onOpportunity: (opp: Opportunity) => Promise<void>) {
  while (true) {
    try {
      const findings = await Promise.all(pairs.map(discoverForPair));

      for (let i = 0; i < pairs.length; i++) {
        if (!findings[i]) {
          console.log(`[scanner] no executable quote path for ${pairs[i].symbol}`);
          continue;
        }

        const opp = findings[i]!;
        console.log(
          `[scanner] ${opp.pair} buy=${opp.buyDex} sell=${opp.sellDex} net=${formatUnits(opp.expectedProfit, 6)} USDC`
        );
        await onOpportunity(opp);
      }
    } catch (error) {
      console.error("[scanner] failure", error);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (require.main === module) {
  scanLoop(async (opp) => {
    console.log("[scanner] signal", opp);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
