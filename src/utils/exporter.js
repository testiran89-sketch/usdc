const { appendFile, writeFile } = require('node:fs/promises');

function toCsvRow(opportunity) {
  if (opportunity.type === 'cross-dex') {
    return [
      new Date().toISOString(),
      opportunity.type,
      opportunity.pair,
      opportunity.buyDex,
      opportunity.sellDex,
      opportunity.tradeSizeUsd,
      opportunity.spreadPct.toFixed(4),
      opportunity.estimatedProfitUsd.toFixed(2),
      opportunity.estimatedGasUsd.toFixed(2)
    ].join(',');
  }

  return [
    new Date().toISOString(),
    opportunity.type,
    opportunity.path,
    opportunity.dexes.join('>'),
    '',
    opportunity.tradeSizeUsd,
    opportunity.spreadPct.toFixed(4),
    opportunity.estimatedProfitUsd.toFixed(2),
    opportunity.estimatedGasUsd.toFixed(2)
  ].join(',');
}

async function exportOpportunities(opportunities, jsonPath, csvPath) {
  if (jsonPath) {
    await writeFile(jsonPath, JSON.stringify(opportunities, null, 2));
  }

  if (csvPath && opportunities.length) {
    const header = 'timestamp,type,pair_or_path,buy_or_dexes,sell_dex,trade_size_usd,spread_pct,estimated_profit_usd,estimated_gas_usd\n';
    await writeFile(csvPath, header);
    await appendFile(csvPath, `${opportunities.map(toCsvRow).join('\n')}\n`);
  }
}

module.exports = { exportOpportunities };
