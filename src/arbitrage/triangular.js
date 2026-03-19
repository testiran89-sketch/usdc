const { parseUnits } = require('ethers');
const { amountToNumber } = require('../utils/format');

async function detectTriangularArbitrage(paths, tradeSizeUsd, tokens, adapters, gasUsd, config) {
  const opportunities = [];

  for (const path of paths) {
    const [a, b, c, backTo] = path.symbols;
    if (a !== backTo) {
      continue;
    }

    const tokenA = tokens[a];
    const tokenB = tokens[b];
    const tokenC = tokens[c];
    const amountIn = parseUnits(tradeSizeUsd.toString(), tokenA.decimals);

    for (const dex1 of adapters) {
      try {
        const q1 = await dex1.quoteExactInput(tokenA, tokenB, amountIn, findFee(config, a, b));
        for (const dex2 of adapters) {
          const q2 = await dex2.quoteExactInput(tokenB, tokenC, q1.amountOut, findFee(config, b, c));
          for (const dex3 of adapters) {
            const q3 = await dex3.quoteExactInput(tokenC, tokenA, q2.amountOut, findFee(config, c, a));
            const start = amountToNumber(amountIn, tokenA);
            const final = amountToNumber(q3.amountOut, tokenA);
            const estimatedProfitUsd = final - start - gasUsd;
            const spreadPct = ((final - start) / start) * 100;

            if (estimatedProfitUsd >= config.minProfitUsd && spreadPct >= config.minSpreadPct) {
              opportunities.push({
                type: 'triangular',
                path: path.symbols.join(' -> '),
                dexes: [dex1.name, dex2.name, dex3.name],
                tradeSizeUsd,
                startAmountIn: amountIn,
                finalAmountOut: q3.amountOut,
                spreadPct,
                estimatedGasUsd: gasUsd,
                estimatedProfitUsd
              });
            }
          }
        }
      } catch {
        // Skip illiquid or unsupported route.
      }
    }
  }

  return opportunities.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd);
}

function findFee(config, base, quote) {
  const direct = config.pairs.find((pair) => pair.base === base && pair.quote === quote);
  const reverse = config.pairs.find((pair) => pair.base === quote && pair.quote === base);
  return direct?.uniswapV3Fee ?? reverse?.uniswapV3Fee;
}

module.exports = { detectTriangularArbitrage };
