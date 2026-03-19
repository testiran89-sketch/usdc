const { parseUnits } = require('ethers');

class QuoteEngine {
  constructor(config, tokens, adapters) {
    this.config = config;
    this.tokens = tokens;
    this.adapters = adapters;
    this.cache = new Map();
  }

  async getPairQuotes(pair, tradeSizeUsd) {
    const baseToken = this.tokens[pair.base];
    const quoteToken = this.tokens[pair.quote];
    const amountIn = parseUnits(tradeSizeUsd.toString(), quoteToken.decimals);

    const quotes = (await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        const key = [adapter.name, pair.base, pair.quote, tradeSizeUsd].join(':');
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
          return cached.quote;
        }

        const quote = await adapter.quoteExactInput(quoteToken, baseToken, amountIn, pair.uniswapV3Fee);
        this.cache.set(key, { quote, expiresAt: Date.now() + Math.max(500, this.config.scanIntervalMs - 200) });
        return quote;
      })
    ))
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);

    return { pair, tradeSizeUsd, quotes };
  }
}

module.exports = { QuoteEngine };
