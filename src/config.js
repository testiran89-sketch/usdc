const { readFile } = require('node:fs/promises');
const { getAddress } = require('ethers');

async function loadConfig(path) {
  const raw = await readFile(path, 'utf-8');
  const config = JSON.parse(raw);

  config.tokens = config.tokens.map((token) => ({ ...token, address: getAddress(token.address) }));
  config.dexes.uniswapV3.router = getAddress(config.dexes.uniswapV3.router);
  config.dexes.uniswapV3.quoter = config.dexes.uniswapV3.quoter ? getAddress(config.dexes.uniswapV3.quoter) : undefined;
  config.dexes.sushiSwap.router = getAddress(config.dexes.sushiSwap.router);
  config.dexes.camelot.router = getAddress(config.dexes.camelot.router);

  return config;
}

function createTokenMap(config) {
  return Object.fromEntries(config.tokens.map((token) => [token.symbol, token]));
}

module.exports = {
  loadConfig,
  createTokenMap
};
