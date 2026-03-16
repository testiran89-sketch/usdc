import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";

function defaultRpc(network: "mainnet" | "arbitrum"): string {
  if (network === "mainnet") return `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  return `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
}

const mainnetUrl = process.env.MAINNET_RPC_URL || process.env.RPC_URL || (ALCHEMY_API_KEY ? defaultRpc("mainnet") : "");
const arbitrumUrl = process.env.ARBITRUM_RPC_URL || process.env.RPC_URL || (ALCHEMY_API_KEY ? defaultRpc("arbitrum") : "");

export default {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500
      }
    }
  },
  networks: {
    hardhat: {},
    mainnet: {
      url: mainnetUrl,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    },
    arbitrum: {
      url: arbitrumUrl,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
