const { Contract } = require('ethers');
const { UNISWAP_V3_QUOTER_ABI } = require('../abis');
const { DexAdapter } = require('./base');
const { quoteToPrice } = require('../utils/format');

class UniswapV3Dex extends DexAdapter {
  constructor(provider, routerAddress, quoterAddress) {
    super('UniswapV3', provider, routerAddress);
    this.quoter = new Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, provider);
  }

  async quoteExactInput(tokenIn, tokenOut, amountIn, feeHint = 500) {
    const started = Date.now();
    const [amountOut] = await this.quoter.quoteExactInputSingle.staticCall([
      tokenIn.address,
      tokenOut.address,
      amountIn,
      feeHint,
      0
    ]);

    const result = {
      dex: 'UniswapV3',
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      feeBps: feeHint / 100,
      latencyMs: Date.now() - started,
      price: 0,
      metadata: { feeHint }
    };

    result.price = quoteToPrice(result);
    return result;
  }
}

module.exports = { UniswapV3Dex };
