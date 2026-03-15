import fs from "fs";

type ChainName = "mainnet" | "arbitrum";

interface ChainConfig {
  chainId: number;
  privateRpc: string;
}

const NETWORKS: Record<ChainName, ChainConfig> = {
  mainnet: {
    chainId: 1,
    privateRpc: "https://relay.flashbots.net"
  },
  arbitrum: {
    chainId: 42161,
    privateRpc: "https://arbitrum.blockpi.network/v1/rpc/public"
  }
};

export function getChain(): ChainName {
  const chain = (process.env.CHAIN || "mainnet") as ChainName;
  if (!(chain in NETWORKS)) {
    throw new Error(`Unsupported CHAIN=${chain}. Use mainnet or arbitrum.`);
  }
  return chain;
}

export function resolveRpcUrl(chain: ChainName): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;

  const alchemy = process.env.ALCHEMY_API_KEY;
  if (alchemy) {
    if (chain === "mainnet") return `https://eth-mainnet.g.alchemy.com/v2/${alchemy}`;
    if (chain === "arbitrum") return `https://arb-mainnet.g.alchemy.com/v2/${alchemy}`;
  }

  throw new Error("Missing RPC_URL (or provide ALCHEMY_API_KEY for auto RPC). ");
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
