const { formatUnits, parseUnits } = require('ethers');

async function detectCrossDexArbitrage(pair, buyQuotes, tradeSizeUsd, tokens, adapters, gasUsd, config) {
  const baseToken = tokens[pair.base];
  const quoteToken = tokens[pair.quote];
  const inputQuoteAmount = parseUnits(tradeSizeUsd.toString(), quoteToken.decimals);
  const opportunities = [];

  for (const buyQuote of buyQuotes) {
    for (const sellAdapter of adapters) {
      if (buyQuote.dex === sellAdapter.name) {
        continue;
      }

      try {
        const sellQuote = await sellAdapter.quoteExactInput(baseToken, quoteToken, buyQuote.amountOut, pair.uniswapV3Fee);
        const recoveredUsd = Number(formatUnits(sellQuote.amountOut, quoteToken.decimals));
        const inputUsd = Number(formatUnits(inputQuoteAmount, quoteToken.decimals));
        const estimatedProfitUsd = recoveredUsd - inputUsd - gasUsd;
        const baseUnits = Number(formatUnits(buyQuote.amountOut, baseToken.decimals));
        const buyPrice = inputUsd / baseUnits;
        const sellPrice = recoveredUsd / baseUnits;
        const spreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;

        if (estimatedProfitUsd >= config.minProfitUsd && spreadPct >= config.minSpreadPct) {
          opportunities.push({
            type: 'cross-dex',
            pair: `${pair.base}/${pair.quote}`,
            tradeSizeUsd,
            buyDex: buyQuote.dex,
            sellDex: sellAdapter.name,
            buyPrice,
            sellPrice,
            spreadPct,
            estimatedGasUsd: gasUsd,
            estimatedProfitUsd
          });
        }
      } catch {
        // Unsupported or illiquid reverse path on this DEX.
      }
    }
  }

  return opportunities.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);
}

module.exports = { detectCrossDexArbitrage };
