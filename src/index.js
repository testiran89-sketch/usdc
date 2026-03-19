require('dotenv/config');
const { loadConfig, createTokenMap } = require('./config');
const { Logger } = require('./utils/logger');
const { UniswapV3Dex } = require('./dex/uniswapV3');
const { V2RouterDex } = require('./dex/v2Router');
const { QuoteEngine } = require('./pricing/quoteEngine');
const { estimateGasUsd } = require('./pricing/gas');
const { detectCrossDexArbitrage } = require('./arbitrage/crossDex');
const { detectTriangularArbitrage } = require('./arbitrage/triangular');
const { exportOpportunities } = require('./utils/exporter');
const { renderOpportunity } = require('./utils/format');
const { createProvider } = require('./providerFactory');

const logger = new Logger();

function getArg(flag) {
  const index = process.argv.findIndex((arg) => arg === flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const configPath = getArg('--config') ?? './config/config.json';
  const config = await loadConfig(configPath);
  const tokens = createTokenMap(config);

  const provider = await createProvider(config.rpc, logger);

  const adapters = [];
  if (config.dexes.uniswapV3.enabled && config.dexes.uniswapV3.quoter) {
    adapters.push(new UniswapV3Dex(provider, config.dexes.uniswapV3.router, config.dexes.uniswapV3.quoter));
  }
  if (config.dexes.sushiSwap.enabled) {
    adapters.push(new V2RouterDex('SushiSwap', provider, config.dexes.sushiSwap.router));
  }
  if (config.dexes.camelot.enabled) {
    adapters.push(new V2RouterDex('Camelot', provider, config.dexes.camelot.router));
  }

  const quoteEngine = new QuoteEngine(config, tokens, adapters);
  logger.info(`Loaded ${adapters.length} DEX adapters from ${configPath}`);

  let scanInFlight = false;
  let lastScanError = { message: '', at: 0 };

  const runScan = async () => {
    if (scanInFlight) {
      logger.warn('Skipping scan tick because previous scan is still running');
      return;
    }

    scanInFlight = true;
    try {
      const ethUsdQuotes = await quoteEngine.getPairQuotes({ base: 'WETH', quote: 'USDC', uniswapV3Fee: 500 }, 1000);
      const ethUsd = Math.max(...ethUsdQuotes.quotes.map((quote) => 1 / quote.price));
      const allOpportunities = [];

      for (const tradeSizeUsd of config.tradeSizesUsd) {
        const gasUsdTwoSwaps = await estimateGasUsd(provider, config.gasLimitPerSwap * 2, ethUsd, config.gasMultiplier);
        const gasUsdThreeSwaps = await estimateGasUsd(provider, config.gasLimitPerSwap * 3, ethUsd, config.gasMultiplier);

        for (const pair of config.pairs) {
          const pairQuotes = await quoteEngine.getPairQuotes(pair, tradeSizeUsd);
          const crossDex = await detectCrossDexArbitrage(pair, pairQuotes.quotes, tradeSizeUsd, tokens, adapters, gasUsdTwoSwaps, config);
          allOpportunities.push(...crossDex);
        }

        const triangular = await detectTriangularArbitrage(config.triangularPaths, tradeSizeUsd, tokens, adapters, gasUsdThreeSwaps, config);
        allOpportunities.push(...triangular);
      }

      const maxItems = config.output?.maxOpportunities ?? 10;
      const top = allOpportunities.sort((a, b) => b.estimatedProfitUsd - a.estimatedProfitUsd).slice(0, maxItems);
      console.clear();
      if (!top.length) {
        logger.info('No opportunities matched configured thresholds');
      } else {
        top.forEach((opportunity) => {
          console.log(renderOpportunity(opportunity));
          console.log('');
        });
      }

      await exportOpportunities(top, config.output?.exportJsonPath, config.output?.exportCsvPath);
    } catch (error) {
      const message = error?.message ?? String(error);
      const now = Date.now();
      if (message !== lastScanError.message || now - lastScanError.at > 30000) {
        logger.error('Scan iteration failed', error);
        lastScanError = { message, at: now };
      }
    } finally {
      scanInFlight = false;
    }
  };

  await runScan();
  setInterval(runScan, config.scanIntervalMs);
}

main().catch((error) => {
  logger.error('Scanner crashed', error);
  process.exitCode = 1;
});
