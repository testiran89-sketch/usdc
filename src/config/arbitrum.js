const { ethers } = require('ethers');

const TOKENS = {
  USDC: {
    symbol: 'USDC',
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6
  },
  WETH: {
    symbol: 'WETH',
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    decimals: 18
  },
  DAI: {
    symbol: 'DAI',
    address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    decimals: 18
  },
  USDT: {
    symbol: 'USDT',
    address: '0xFd086bC7CD5C481DCC9C85ebe478A1C0b69FCbb9',
    decimals: 6
  }
};

const ADDRESSES = {
  chainId: 42161,
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  aavePoolAddressesProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  uniswapV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  sushiRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
};

const DEFAULT_RPC_URLS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum.blockpi.network/v1/rpc/public',
  'https://rpc.ankr.com/arbitrum'
];

const DIRECT_BASE_SIZES = {
  USDC: ethers.parseUnits('5000', TOKENS.USDC.decimals),
  WETH: ethers.parseUnits('2', TOKENS.WETH.decimals),
  DAI: ethers.parseUnits('5000', TOKENS.DAI.decimals),
  USDT: ethers.parseUnits('5000', TOKENS.USDT.decimals)
};

const UNISWAP_V3_FEES = {
  'USDC-WETH': 500,
  'USDC-DAI': 100,
  'USDC-USDT': 100,
  'WETH-DAI': 3000,
  'WETH-USDT': 3000,
  'DAI-USDT': 100
};

const CURVE_POOLS = [
  {
    name: 'Curve Stable Pool Placeholder',
    address: process.env.CURVE_STABLE_POOL || '',
    supportedPairs: {
      'USDC-USDT': { i: 0, j: 1 },
      'USDT-USDC': { i: 1, j: 0 },
      'USDC-DAI': { i: 0, j: 2 },
      'DAI-USDC': { i: 2, j: 0 },
      'DAI-USDT': { i: 2, j: 1 },
      'USDT-DAI': { i: 1, j: 2 }
    }
  }
].filter((pool) => pool.address);

const BALANCER_POOLS = [
  {
    name: 'Balancer USDC/WETH Placeholder',
    poolId: process.env.BALANCER_USDC_WETH_POOL_ID || '',
    assets: [TOKENS.USDC.address, TOKENS.WETH.address],
    pairs: {
      'USDC-WETH': { assetInIndex: 0, assetOutIndex: 1 },
      'WETH-USDC': { assetInIndex: 1, assetOutIndex: 0 }
    }
  },
  {
    name: 'Balancer Stable Pool Placeholder',
    poolId: process.env.BALANCER_STABLE_POOL_ID || '',
    assets: [TOKENS.USDC.address, TOKENS.DAI.address, TOKENS.USDT.address],
    pairs: {
      'USDC-DAI': { assetInIndex: 0, assetOutIndex: 1 },
      'DAI-USDC': { assetInIndex: 1, assetOutIndex: 0 },
      'USDC-USDT': { assetInIndex: 0, assetOutIndex: 2 },
      'USDT-USDC': { assetInIndex: 2, assetOutIndex: 0 },
      'DAI-USDT': { assetInIndex: 1, assetOutIndex: 2 },
      'USDT-DAI': { assetInIndex: 2, assetOutIndex: 1 }
    }
  }
].filter((pool) => pool.poolId);

module.exports = {
  TOKENS,
  ADDRESSES,
  DEFAULT_RPC_URLS,
  DIRECT_BASE_SIZES,
  UNISWAP_V3_FEES,
  CURVE_POOLS,
  BALANCER_POOLS
};
