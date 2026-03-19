const { formatUnits } = require('ethers');

function amountToNumber(amount, token) {
  return Number(formatUnits(amount, token.decimals));
}

function quoteToPrice(quote) {
  const inValue = amountToNumber(quote.amountIn, quote.tokenIn);
  const outValue = amountToNumber(quote.amountOut, quote.tokenOut);
  return outValue / inValue;
}

function formatUsd(value) {
  return `$${value.toFixed(2)}`;
}

function renderOpportunity(opportunity) {
  if (opportunity.type === 'cross-dex') {
    return [
      '[OPPORTUNITY]',
      `PAIR: ${opportunity.pair}`,
      `BUY: ${opportunity.buyDex} @ ${opportunity.buyPrice.toFixed(6)}`,
      `SELL: ${opportunity.sellDex} @ ${opportunity.sellPrice.toFixed(6)}`,
      `SPREAD: ${opportunity.spreadPct.toFixed(2)}%`,
      `EST_PROFIT (${opportunity.tradeSizeUsd.toLocaleString()}): ${formatUsd(opportunity.estimatedProfitUsd)}`,
      `EST_GAS: ${formatUsd(opportunity.estimatedGasUsd)}`
    ].join('\n');
  }

  return [
    '[OPPORTUNITY]',
    `PATH: ${opportunity.path}`,
    `DEXES: ${opportunity.dexes.join(' -> ')}`,
    `SPREAD: ${opportunity.spreadPct.toFixed(2)}%`,
    `EST_PROFIT (${opportunity.tradeSizeUsd.toLocaleString()}): ${formatUsd(opportunity.estimatedProfitUsd)}`,
    `EST_GAS: ${formatUsd(opportunity.estimatedGasUsd)}`
  ].join('\n');
}

module.exports = {
  amountToNumber,
  quoteToPrice,
  formatUsd,
  renderOpportunity
};
