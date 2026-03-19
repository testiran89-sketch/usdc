const { ethers } = require('ethers');

const addr = (value) => ethers.getAddress(value.toLowerCase());

const TOKENS = {
  USDC: {
    symbol: 'USDC',
    address: addr('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
    decimals: 6
  },
  WETH: {
    symbol: 'WETH',
    address: addr('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
    decimals: 18
  },
  DAI: {
    symbol: 'DAI',
    address: addr('0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'),
    decimals: 18
  },
  USDT: {
    symbol: 'USDT',
    address: addr('0xFd086bC7CD5C481DCC9C85ebe478A1C0b69FCbb9'),
    decimals: 6
  },
  WBTC: {
    symbol: 'WBTC',
    address: addr('0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'),
    decimals: 8
  },
  ARB: {
    symbol: 'ARB',
    address: addr('0x912CE59144191C1204E64559FE8253a0e49E6548'),
    decimals: 18
  },
  LINK: {
    symbol: 'LINK',
    address: addr('0xf97f4df75117a78c1A5a0DBb814Af92458539FB4'),
    decimals: 18
  },
  GMX: {
    symbol: 'GMX',
    address: addr('0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a'),
    decimals: 18
  }
};

const ADDRESSES = {
  chainId: 42161,
  multicall3: addr('0xcA11bde05977b3631167028862bE2a173976CA11'),
  aavePoolAddressesProvider: addr('0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb'),
  uniswapV3Router: addr('0xE592427A0AEce92De3Edee1F18E0157C05861564'),
  uniswapV3QuoterV2: addr('0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
  sushiRouter: addr('0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'),
  camelotRouter: addr('0xc873fEcbd354f5A56E00E710B90EF4201db2448d'),
  balancerVault: addr('0xBA12222222228d8Ba445958a75a0704d566BF2C8')
};

const DEFAULT_RPC_URLS = [
  'https://arbitrum.blockpi.network/v1/rpc/public',
  'https://rpc.ankr.com/arbitrum',
  'https://arb1.arbitrum.io/rpc'
];

const DIRECT_BASE_SIZES = {
  USDC: ethers.parseUnits('5000', TOKENS.USDC.decimals),
  WETH: ethers.parseUnits('2', TOKENS.WETH.decimals),
  DAI: ethers.parseUnits('5000', TOKENS.DAI.decimals),
  USDT: ethers.parseUnits('5000', TOKENS.USDT.decimals),
  WBTC: ethers.parseUnits('0.05', TOKENS.WBTC.decimals),
  ARB: ethers.parseUnits('10000', TOKENS.ARB.decimals),
  LINK: ethers.parseUnits('500', TOKENS.LINK.decimals),
  GMX: ethers.parseUnits('200', TOKENS.GMX.decimals)
};

const UNISWAP_V3_FEES = {
  'USDC-WETH': 500,
  'USDC-DAI': 100,
  'USDC-USDT': 100,
  'USDC-WBTC': 500,
  'USDC-ARB': 500,
  'USDC-LINK': 500,
  'USDC-GMX': 3000,
  'WETH-DAI': 3000,
  'WETH-WBTC': 500,
  'WETH-ARB': 3000,
  'WETH-LINK': 3000,
  'WETH-GMX': 3000,
  'WETH-USDT': 3000,
  'DAI-WBTC': 3000,
  'DAI-USDT': 100
};

const CURVE_POOLS = [];

const BALANCER_POOLS = [
  {
    name: 'Gyroscope ECLP WETH/USDC',
    address: addr('0x2c045c222bd603b9f1d6fb8af077d705efe83d4a'),
    poolId: '0x2c045c222bd603b9f1d6fb8af077d705efe83d4a0002000000000000000005e6',
    assets: [TOKENS.WETH.address, TOKENS.USDC.address],
    pairs: {
      'WETH-USDC': { assetInIndex: 0, assetOutIndex: 1 },
      'USDC-WETH': { assetInIndex: 1, assetOutIndex: 0 }
    }
  },
  {
    name: 'Gyroscope ECLP USDT/USDC',
    address: addr('0xb6911f80b1122f41c19b299a69dca07100452bf9'),
    poolId: '0xb6911f80b1122f41c19b299a69dca07100452bf90002000000000000000004ba',
    assets: [TOKENS.USDT.address, TOKENS.USDC.address],
    pairs: {
      'USDT-USDC': { assetInIndex: 0, assetOutIndex: 1 },
      'USDC-USDT': { assetInIndex: 1, assetOutIndex: 0 }
    }
  }
];

module.exports = {
  TOKENS,
  ADDRESSES,
  DEFAULT_RPC_URLS,
  DIRECT_BASE_SIZES,
  UNISWAP_V3_FEES,
  CURVE_POOLS,
  BALANCER_POOLS
};
