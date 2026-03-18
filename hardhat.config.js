require('dotenv').config();
require('hardhat/config');

const rpcUrls = (process.env.RPC_URLS || 'https://arb1.arbitrum.io/rpc')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

module.exports = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: {
        enabled: true,
        runs: 500
      },
      viaIR: true
    }
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      chainId: 42161
    },
    arbitrum: {
      url: rpcUrls[0],
      chainId: 42161,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  paths: {
    sources: './contracts',
    cache: './cache',
    artifacts: './artifacts'
  }
};
