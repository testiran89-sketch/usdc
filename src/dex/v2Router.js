const { V2_ROUTER_ABI } = require('../abis');
const { DexAdapter } = require('./base');
const { quoteToPrice } = require('../utils/format');

class V2RouterDex extends DexAdapter {
  async quoteExactInput(tokenIn, tokenOut, amountIn) {
    const started = Date.now();
    const router = this.createContract(this.routerAddress, V2_ROUTER_ABI);
    const amounts = await router.getAmountsOut(amountIn, [tokenIn.address, tokenOut.address]);

    const result = {
      dex: this.name,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: amounts[amounts.length - 1],
      feeBps: 30,
      latencyMs: Date.now() - started,
      price: 0
    };

    result.price = quoteToPrice(result);
    return result;
  }
}

module.exports = { V2RouterDex };
