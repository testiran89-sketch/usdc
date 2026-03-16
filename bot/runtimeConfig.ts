import "dotenv/config";
import fs from "fs";

type ChainName = "mainnet" | "arbitrum";

interface ChainConfig {
  privateRpc: string;
  publicRpc: string;
}

const NETWORKS: Record<ChainName, ChainConfig> = {
  mainnet: {
    privateRpc: "https://relay.flashbots.net",
    publicRpc: "https://cloudflare-eth.com"
  },
  arbitrum: {
    privateRpc: "https://arbitrum.blockpi.network/v1/rpc/public",
    publicRpc: "https://arb1.arbitrum.io/rpc"
  }
};

function normalizeChain(input?: string): ChainName {
  const raw = (input || "mainnet").toLowerCase();

  if (["mainnet", "ethereum", "eth", "1"].includes(raw)) {
    return "mainnet";
  }

  if (["arbitrum", "arbitrum-one", "arb", "42161"].includes(raw)) {
    return "arbitrum";
  }

  throw new Error(
    `Unsupported CHAIN=${input}. Use mainnet|ethereum|eth or arbitrum|arb (also supports chain IDs 1/42161).`
  );
}

export function getChain(): ChainName {
  return normalizeChain(process.env.CHAIN);
}

export function resolveRpcUrl(chain: ChainName): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;

  const alchemy = process.env.ALCHEMY_API_KEY;
  if (alchemy) {
    if (chain === "mainnet") return `https://eth-mainnet.g.alchemy.com/v2/${alchemy}`;
    if (chain === "arbitrum") return `https://arb-mainnet.g.alchemy.com/v2/${alchemy}`;
  }

  return NETWORKS[chain].publicRpc;
}

export function resolvePrivateRelay(chain: ChainName): string {
  return process.env.FLASHBOTS_RELAY || NETWORKS[chain].privateRpc;
}

export function loadNetworkConfig(chain: ChainName) {
  const networks = JSON.parse(fs.readFileSync("config/networks.json.example", "utf8"));
  const cfg = networks[chain];
  if (!cfg) throw new Error(`Missing network config for ${chain}`);
  return cfg;
}

export function resolveExecutorAddress(): string {
  const fromEnv = process.env.EXECUTOR_ADDRESS;
  if (fromEnv) return fromEnv;

  const deployedPath = "deployments/latest.json";
  if (fs.existsSync(deployedPath)) {
    const latest = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
    if (latest.executor) return latest.executor;
  }

  throw new Error("Missing EXECUTOR_ADDRESS. Deploy first or set EXECUTOR_ADDRESS in .env");
}
