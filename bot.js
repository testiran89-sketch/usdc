require('dotenv').config();

const { ethers } = require('ethers');
const {
  ERC20_ABI,
  AAVE_POOL_PROVIDER_ABI,
  AAVE_POOL_ABI,
  FLASH_LOAN_ARBITRAGE_ABI,
  MULTICALL3_ABI,
  UNISWAP_V3_QUOTER_ABI,
  UNISWAP_V3_ROUTER_ABI,
  SUSHI_V2_ROUTER_ABI,
  BALANCER_VAULT_ABI,
  CURVE_POOL_ABI
} = require('./src/lib/abis');
const { RotatingRpcProvider } = require('./src/lib/provider');
const {
  TOKENS,
  ADDRESSES,
  DEFAULT_RPC_URLS,
  DIRECT_BASE_SIZES,
  UNISWAP_V3_FEES,
  CURVE_POOLS,
  BALANCER_POOLS
} = require('./src/config/arbitrum');

const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 10_000);
const MAX_TRADE_SIZE_USDC = ethers.parseUnits(process.env.MAX_TRADE_SIZE_USDC || '10000', TOKENS.USDC.decimals);
const MIN_PROFIT_USDC = ethers.parseUnits(process.env.MIN_PROFIT_USDC || '10', TOKENS.USDC.decimals);
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 30);
const SIMULATION_SLIPPAGE_BPS = Number(process.env.SIMULATION_SLIPPAGE_BPS || 50);
const DEADLINE_SECONDS = Number(process.env.DEADLINE_SECONDS || 90);
const GAS_LIMIT_BUFFER_BPS = Number(process.env.GAS_LIMIT_BUFFER_BPS || 12000);
const EMERGENCY_STOP_FILE = process.env.EMERGENCY_STOP_FILE || '.emergency-stop';
const DISPLAY_LOAN_USDC = ethers.parseUnits(process.env.DISPLAY_LOAN_USDC || '100000', TOKENS.USDC.decimals);
const PAIR_SPREAD_SANITY_FACTOR = Number(process.env.PAIR_SPREAD_SANITY_FACTOR || 5);
const DEBUG_PRICE_LOG = String(process.env.DEBUG_PRICE_LOG || '').toLowerCase() === 'true';
const DEBUG_PRICE_PAIRS = new Set(
  (process.env.DEBUG_PRICE_PAIRS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
);

const TOKEN_LIST = Object.values(TOKENS);
const TOKEN_BY_ADDRESS = Object.fromEntries(TOKEN_LIST.map((token) => [token.address.toLowerCase(), token]));
const SECONDARY_TOKENS = Object.keys(TOKENS).filter((symbol) => symbol !== 'USDC');

function pairKey(symbolA, symbolB) {
  return `${symbolA}-${symbolB}`;
}

function amountToFloat(amount, decimals) {
  return Number(ethers.formatUnits(amount, decimals));
}

function applyBps(amount, bps, subtract = true) {
  const numerator = subtract ? 10_000n - BigInt(bps) : 10_000n + BigInt(bps);
  return (amount * numerator) / 10_000n;
}

function normalizeAmountOut(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (Array.isArray(value)) {
    return normalizeAmountOut(value[0]);
  }
  if (typeof value === 'object') {
    if ('amountOut' in value && value.amountOut != null) {
      return normalizeAmountOut(value.amountOut);
    }
    if (0 in value && value[0] != null) {
      return normalizeAmountOut(value[0]);
    }
  }
  return null;
}

function formatTokenAmount(amount, token, precision = 6) {
  return Number(ethers.formatUnits(amount, token.decimals)).toFixed(precision);
}

function uniquePush(map, key, value) {
  if (!map.has(key)) {
    map.set(key, value);
  }
}

function formatSignedUsdc(amount) {
  const prefix = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;
  return `${prefix}${ethers.formatUnits(absolute, TOKENS.USDC.decimals)}`;
}

function formatUsdc(amount) {
  return ethers.formatUnits(amount, TOKENS.USDC.decimals);
}

function formatUnitPrice(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  if (value >= 1000) {
    return value.toFixed(2);
  }
  if (value >= 1) {
    return value.toFixed(4);
  }
  if (value >= 0.01) {
    return value.toFixed(6);
  }
  if (value >= 0.0001) {
    return value.toFixed(8);
  }
  return value.toExponential(4);
}

function supportsColor() {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function colorize(text, colorCode) {
  if (!supportsColor()) {
    return text;
  }
  return `\u001b[${colorCode}m${text}\u001b[0m`;
}

function padLine(value, width) {
  return `${value}${' '.repeat(Math.max(0, width - value.length))}`;
}

function renderPanel(title, lines, colorCode = '36') {
  const content = lines.length ? lines : [''];
  const width = Math.max(title.length, ...content.map((line) => line.length));
  const top = colorize(`┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length))}┐`, colorCode);
  const body = content.map((line) => colorize(`│ ${padLine(line, width)} │`, colorCode)).join('\n');
  const bottom = colorize(`└${'─'.repeat(width + 2)}┘`, colorCode);
  return `${top}\n${body}\n${bottom}`;
}

function chunkLines(items, itemsPerLine = 2) {
  const lines = [];
  for (let index = 0; index < items.length; index += itemsPerLine) {
    lines.push(items.slice(index, index + itemsPerLine).join('  •  '));
  }
  return lines;
}

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const path of paths) {
    const key = path.join('>');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(path);
    }
  }
  return result;
}

function shouldDebugPair(tokenInSymbol, tokenOutSymbol) {
  if (!DEBUG_PRICE_LOG) {
    return false;
  }
  if (!DEBUG_PRICE_PAIRS.size) {
    return true;
  }
  return DEBUG_PRICE_PAIRS.has(`${tokenInSymbol}->${tokenOutSymbol}`);
}

class ArbitrageBot {
  constructor() {
    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY is required');
    }
    if (!process.env.ARBITRAGE_CONTRACT) {
      throw new Error('ARBITRAGE_CONTRACT is required');
    }

    const rpcUrls = (process.env.RPC_URLS || DEFAULT_RPC_URLS.join(','))
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    this.rpc = new RotatingRpcProvider(rpcUrls, ADDRESSES.chainId);
    this.state = {
      running: false,
      flashLoanFeeBps: 0n,
      busy: false,
      lastBestOpportunityId: ''
    };
  }

  async init() {
    await this.rpc.initialize();
    this.wallet = this.rpc.wallet(process.env.PRIVATE_KEY);
    this.provider = this.wallet.provider;

    this.arbContract = new ethers.Contract(
      process.env.ARBITRAGE_CONTRACT,
      FLASH_LOAN_ARBITRAGE_ABI,
      this.wallet
    );

    this.multicall = new ethers.Contract(ADDRESSES.multicall3, MULTICALL3_ABI, this.provider);
    this.uniswapQuoter = new ethers.Contract(ADDRESSES.uniswapV3QuoterV2, UNISWAP_V3_QUOTER_ABI, this.provider);
    this.uniswapRouterInterface = new ethers.Interface(UNISWAP_V3_ROUTER_ABI);
    this.sushiRouter = new ethers.Contract(ADDRESSES.sushiRouter, SUSHI_V2_ROUTER_ABI, this.provider);
    this.sushiRouterInterface = new ethers.Interface(SUSHI_V2_ROUTER_ABI);
    this.camelotRouter = new ethers.Contract(ADDRESSES.camelotRouter, SUSHI_V2_ROUTER_ABI, this.provider);
    this.camelotRouterInterface = new ethers.Interface(SUSHI_V2_ROUTER_ABI);
    this.balancerVault = new ethers.Contract(ADDRESSES.balancerVault, BALANCER_VAULT_ABI, this.provider);
    this.balancerVaultInterface = new ethers.Interface(BALANCER_VAULT_ABI);
    this.curvePoolInterface = new ethers.Interface(CURVE_POOL_ABI);
    this.v2Dexes = [
      {
        name: 'sushiswap',
        address: ADDRESSES.sushiRouter,
        contract: this.sushiRouter,
        interface: this.sushiRouterInterface
      },
      {
        name: 'camelot',
        address: ADDRESSES.camelotRouter,
        contract: this.camelotRouter,
        interface: this.camelotRouterInterface
      }
    ];

    const provider = new ethers.Contract(ADDRESSES.aavePoolAddressesProvider, AAVE_POOL_PROVIDER_ABI, this.provider);
    const poolAddress = await provider.getPool();
    const pool = new ethers.Contract(poolAddress, AAVE_POOL_ABI, this.provider);
    this.state.flashLoanFeeBps = BigInt(await pool.FLASHLOAN_PREMIUM_TOTAL());

    console.log(`Connected to ${this.rpc.currentUrl}`);
    console.log(`Wallet: ${this.wallet.address}`);
    console.log(`Flash loan fee: ${this.state.flashLoanFeeBps} bps`);
    if (DEBUG_PRICE_LOG) {
      console.log(`Price debug logging: enabled${DEBUG_PRICE_PAIRS.size ? ` for ${[...DEBUG_PRICE_PAIRS].join(', ')}` : ' for all pairs'}`);
      console.log('Debug mode makes many extra RPC calls. If you hit 429/521/timeout errors, set RPC_URLS to better Arbitrum endpoints and optionally raise RPC_TIMEOUT_MS.');
    } else {
      console.log('Price debug logging: disabled. Enable with DEBUG_PRICE_LOG=true (optionally set DEBUG_PRICE_PAIRS=USDC->WETH,WETH->USDC,USDC->ARB,ARB->USDC).');
    }
  }

  async start() {
    this.state.running = true;
    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error(`[tick] ${error.stack || error.message}`);
      });
    }, SCAN_INTERVAL_MS);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.state.running = false;
  }

  async tick() {
    if (this.state.busy) {
      return;
    }
    if (await this.isEmergencyStopped()) {
      console.warn('Emergency stop active. Remove the stop file to resume execution.');
      return;
    }

    this.state.busy = true;
    try {
      const opportunities = await this.scanAll();
      if (!opportunities.length) {
        console.log(`[${new Date().toISOString()}] No profitable opportunity found.`);
        return;
      }

      opportunities.sort((a, b) => (a.netProfit > b.netProfit ? -1 : 1));
      const best = opportunities[0];
      if (best.id !== this.state.lastBestOpportunityId) {
        console.log(`[best] ${best.id} net=${ethers.formatUnits(best.netProfit, TOKENS.USDC.decimals)} USDC`);
        this.state.lastBestOpportunityId = best.id;
      }

      await this.executeOpportunity(best);
    } finally {
      this.state.busy = false;
    }
  }

  async isEmergencyStopped() {
    const fs = require('fs/promises');
    try {
      await fs.access(EMERGENCY_STOP_FILE);
      return true;
    } catch {
      return String(process.env.EMERGENCY_STOP || '').toLowerCase() === 'true';
    }
  }

  async scanAll() {
    const marketQuotes = await this.collectQuotes();
    this.latestQuotes = marketQuotes;
    const directOpportunities = this.findDirectOpportunities(marketQuotes);
    const triangularOpportunities = this.findTriangularOpportunities(marketQuotes);
    const directDiagnostics = this.buildDirectDiagnostics(marketQuotes);
    const opportunities = [...directOpportunities, ...triangularOpportunities];

    let bestAttempt = null;

    const viable = [];
    for (const opportunity of opportunities) {
      const gasCost = await this.estimateGasCost(opportunity, marketQuotes).catch(() => opportunity.estimatedGasCost || 0n);
      opportunity.estimatedGasCost = gasCost;
      const flashLoanFee = (opportunity.loanAmount * this.state.flashLoanFeeBps) / 10_000n;
      opportunity.flashLoanFee = flashLoanFee;
      opportunity.netProfit = opportunity.expectedProfit - gasCost - flashLoanFee;
      if (!bestAttempt || opportunity.netProfit > bestAttempt.netProfit) {
        bestAttempt = opportunity;
      }
      if (opportunity.netProfit > MIN_PROFIT_USDC && opportunity.netProfit > 0n) {
        viable.push(opportunity);
      }
    }

    this.logScanSummary({
      quotes: marketQuotes,
      directCount: directOpportunities.length,
      triangularCount: triangularOpportunities.length,
      viableCount: viable.length,
      bestAttempt,
      directDiagnostics,
      topCandidates: opportunities
        .slice()
        .sort((a, b) => (a.netProfit > b.netProfit ? -1 : 1))
        .slice(0, 6)
    });

    return viable;
  }

  async collectQuotes() {
    const quotes = new Map();
    const multicallPayload = [];
    const decoders = [];

    for (const secondarySymbol of SECONDARY_TOKENS) {
      const baseAmount = DIRECT_BASE_SIZES.USDC;
      const tokenIn = TOKENS.USDC;
      const tokenOut = TOKENS[secondarySymbol];
      const uniFee = UNISWAP_V3_FEES[pairKey('USDC', secondarySymbol)] || 3000;

      multicallPayload.push({
        target: ADDRESSES.uniswapV3QuoterV2,
        allowFailure: true,
        callData: this.uniswapQuoter.interface.encodeFunctionData('quoteExactInputSingle', [{
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn: baseAmount,
          fee: uniFee,
          sqrtPriceLimitX96: 0
        }])
      });
      decoders.push({ type: 'uniswap', tokenIn, tokenOut, fee: uniFee, amountIn: baseAmount });

      for (const dex of this.v2Dexes) {
        for (const path of this.buildV2Paths(tokenIn, tokenOut)) {
          multicallPayload.push({
            target: dex.address,
            allowFailure: true,
            callData: dex.interface.encodeFunctionData('getAmountsOut', [baseAmount, path])
          });
          decoders.push({ type: 'v2', dex: dex.name, tokenIn, tokenOut, amountIn: baseAmount, path });
        }
      }

      for (const curvePool of CURVE_POOLS) {
        const mapping = curvePool.supportedPairs[pairKey('USDC', secondarySymbol)];
        if (!mapping) {
          continue;
        }
        multicallPayload.push({
          target: curvePool.address,
          allowFailure: true,
          callData: this.curvePoolInterface.encodeFunctionData('get_dy', [mapping.i, mapping.j, baseAmount])
        });
        decoders.push({ type: 'curve', pool: curvePool, tokenIn, tokenOut, amountIn: baseAmount, mapping });
      }
    }

    const responses = multicallPayload.length ? await this.multicall.aggregate3.staticCall(multicallPayload) : [];
    for (let index = 0; index < responses.length; index += 1) {
      const response = responses[index];
      if (!response.success) {
        continue;
      }
      const meta = decoders[index];
      if (meta.type === 'uniswap') {
        const decoded = this.uniswapQuoter.interface.decodeFunctionResult('quoteExactInputSingle', response.returnData);
        this.storeQuote(quotes, this.makeQuote({
          dex: 'uniswapV3',
          tokenIn: meta.tokenIn,
          tokenOut: meta.tokenOut,
          amountIn: meta.amountIn,
          amountOut: normalizeAmountOut(decoded),
          routeData: { fee: meta.fee }
        }));
      } else if (meta.type === 'v2') {
        const dex = this.getV2Dex(meta.dex);
        const [amounts] = dex.interface.decodeFunctionResult('getAmountsOut', response.returnData);
        this.storeQuote(quotes, this.makeQuote({
          dex: meta.dex,
          tokenIn: meta.tokenIn,
          tokenOut: meta.tokenOut,
          amountIn: meta.amountIn,
          amountOut: amounts[amounts.length - 1],
          routeData: { path: meta.path }
        }));
      } else if (meta.type === 'curve') {
        const [amountOut] = this.curvePoolInterface.decodeFunctionResult('get_dy', response.returnData);
        this.storeQuote(quotes, this.makeQuote({
          dex: 'curve',
          tokenIn: meta.tokenIn,
          tokenOut: meta.tokenOut,
          amountIn: meta.amountIn,
          amountOut,
          routeData: { pool: meta.pool, i: meta.mapping.i, j: meta.mapping.j }
        }));
      }
    }

    for (const secondarySymbol of SECONDARY_TOKENS) {
      const tokenA = TOKENS[secondarySymbol];
      await this.collectSupplementalQuotes(quotes, TOKENS.USDC, tokenA, DIRECT_BASE_SIZES.USDC);
      await this.collectReverseQuotes(quotes, tokenA, TOKENS.USDC, DIRECT_BASE_SIZES[secondarySymbol]);
    }

    for (const first of SECONDARY_TOKENS) {
      for (const second of SECONDARY_TOKENS) {
        if (first === second) {
          continue;
        }
        await this.collectCrossQuotes(quotes, TOKENS[first], TOKENS[second], DIRECT_BASE_SIZES[first]);
      }
    }

    return quotes;
  }

  async collectReverseQuotes(quotes, tokenIn, tokenOut, amountIn) {
    await this.collectCrossQuotes(quotes, tokenIn, tokenOut, amountIn);
  }

  async collectSupplementalQuotes(quotes, tokenIn, tokenOut, amountIn) {
    const quoteCalls = [
      this.safeQuoteCurve(tokenIn, tokenOut, amountIn),
      this.safeQuoteBalancer(tokenIn, tokenOut, amountIn)
    ];

    const results = (await Promise.all(quoteCalls)).flat().filter(Boolean);
    for (const quote of results) {
      this.storeQuote(quotes, quote);
    }
  }

  async collectCrossQuotes(quotes, tokenIn, tokenOut, amountIn) {
    const uniFee = UNISWAP_V3_FEES[pairKey(tokenIn.symbol, tokenOut.symbol)]
      || UNISWAP_V3_FEES[pairKey(tokenOut.symbol, tokenIn.symbol)]
      || 3000;

    const quoteCalls = [
      this.safeQuoteUniswap(tokenIn, tokenOut, amountIn, uniFee),
      ...this.v2Dexes.map((dex) => this.safeQuoteV2Dex(dex.name, tokenIn, tokenOut, amountIn)),
      this.safeQuoteCurve(tokenIn, tokenOut, amountIn),
      this.safeQuoteBalancer(tokenIn, tokenOut, amountIn)
    ];

    const results = (await Promise.all(quoteCalls)).flat().filter(Boolean);
    for (const quote of results) {
      this.storeQuote(quotes, quote);
    }
  }

  storeQuote(quotes, quote) {
    if (!quote) {
      return;
    }
    const key = `${quote.dex}:${quote.tokenIn.symbol}:${quote.tokenOut.symbol}`;
    const existing = quotes.get(key);
    if (!existing || quote.amountOut > existing.amountOut) {
      quotes.set(key, quote);
      if (shouldDebugPair(quote.tokenIn.symbol, quote.tokenOut.symbol)) {
        const routePath = quote.routeData?.path
          ? quote.routeData.path.map((address) => TOKEN_BY_ADDRESS[address.toLowerCase()]?.symbol || address).join('>')
          : quote.routeData?.pool?.name || 'direct';
        console.log(
          `[price-debug] accepted pair=${quote.tokenIn.symbol}->${quote.tokenOut.symbol} `
          + `dex=${quote.dex} amountIn=${formatTokenAmount(quote.amountIn, quote.tokenIn, 6)} ${quote.tokenIn.symbol} `
          + `amountOut=${formatTokenAmount(quote.amountOut, quote.tokenOut, 6)} ${quote.tokenOut.symbol} `
          + `path=${routePath}`
        );
      }
    }
  }

  makeQuote({ dex, tokenIn, tokenOut, amountIn, amountOut, routeData }) {
    const normalizedAmountOut = normalizeAmountOut(amountOut);
    if (normalizedAmountOut == null || normalizedAmountOut <= 0n) {
      return null;
    }
    const idealPrice = (amountToFloat(normalizedAmountOut, tokenOut.decimals) / amountToFloat(amountIn, tokenIn.decimals));
    const stressedIn = applyBps(amountIn, SIMULATION_SLIPPAGE_BPS, false);
    return {
      dex,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: normalizedAmountOut,
      routeData,
      idealPrice,
      stressedIn
    };
  }

  getQuote(quotes, dex, tokenInSymbol, tokenOutSymbol) {
    return quotes.get(`${dex}:${tokenInSymbol}:${tokenOutSymbol}`);
  }

  shortDexName(dex) {
    const aliases = {
      uniswapV3: 'uni',
      sushiswap: 'sushi',
      camelot: 'camelot',
      curve: 'curve',
      balancer: 'bal'
    };
    return aliases[dex] || dex;
  }

  formatOpportunityRadar(opportunity) {
    const route = opportunity.path
      .map((step) => `${step.tokenOut.symbol}(${this.shortDexName(step.dex)})`)
      .join('->');
    const spreadBps = opportunity.loanAmount > 0n
      ? Number((opportunity.expectedProfit * 10_000n) / opportunity.loanAmount) / 100
      : 0;
    const projectedGross = opportunity.loanAmount > 0n
      ? (opportunity.expectedProfit * DISPLAY_LOAN_USDC) / opportunity.loanAmount
      : 0n;
    const projectedFlashFee = opportunity.loanAmount > 0n
      ? ((opportunity.flashLoanFee || 0n) * DISPLAY_LOAN_USDC) / opportunity.loanAmount
      : 0n;
    const projectedNet = projectedGross - projectedFlashFee - (opportunity.estimatedGasCost || 0n);
    const projectedFinal = DISPLAY_LOAN_USDC + projectedNet;
    const spreadPrefix = spreadBps >= 0 ? '+' : '';
    return `${route}= ${spreadPrefix}${spreadBps.toFixed(2)}% (100k => ${formatUsdc(projectedFinal)} USDC after fees)`;
  }

  quoteUnitPrice(quote) {
    return amountToFloat(quote.amountOut, quote.tokenOut.decimals) / amountToFloat(quote.amountIn, quote.tokenIn.decimals);
  }

  bestQuoteForPair(pairQuotesByKey, pairKeyName) {
    const pairQuotes = pairQuotesByKey.get(pairKeyName) || [];
    return pairQuotes.slice().sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))[0] || null;
  }

  quoteUsdcValue(amount, tokenSymbol, pairQuotesByKey) {
    if (tokenSymbol === 'USDC') {
      return amount;
    }
    const toUsdc = this.bestQuoteForPair(pairQuotesByKey, `${tokenSymbol}->USDC`);
    if (!toUsdc || toUsdc.amountOut <= 0n) {
      return null;
    }
    return (amount * toUsdc.amountOut) / toUsdc.amountIn;
  }

  comparablePairQuotes(pairQuotes, pairQuotesByKey) {
    const pricedQuotes = pairQuotes
      .map((quote) => {
        const unitPrice = this.quoteUnitPrice(quote);
        const inputUsdc = this.quoteUsdcValue(quote.amountIn, quote.tokenIn.symbol, pairQuotesByKey);
        const outputUsdc = this.quoteUsdcValue(quote.amountOut, quote.tokenOut.symbol, pairQuotesByKey);
        return { quote, unitPrice, inputUsdc, outputUsdc };
      })
      .filter((entry) => Number.isFinite(entry.unitPrice) && entry.unitPrice > 0)
      .filter((entry) => entry.inputUsdc != null && entry.outputUsdc != null && entry.inputUsdc > 0n && entry.outputUsdc > 0n)
      .filter((entry) => {
        const minOutput = (entry.inputUsdc * 3n) / 10n;
        const maxOutput = entry.inputUsdc * 3n;
        return entry.outputUsdc >= minOutput && entry.outputUsdc <= maxOutput;
      })
      .sort((a, b) => a.unitPrice - b.unitPrice);

    if (pricedQuotes.length < 2) {
      return [];
    }

    const middle = Math.floor(pricedQuotes.length / 2);
    const median = pricedQuotes.length % 2 === 1
      ? pricedQuotes[middle].unitPrice
      : (pricedQuotes[middle - 1].unitPrice + pricedQuotes[middle].unitPrice) / 2;
    const minAllowed = median / PAIR_SPREAD_SANITY_FACTOR;
    const maxAllowed = median * PAIR_SPREAD_SANITY_FACTOR;

    return pricedQuotes
      .filter((entry) => entry.unitPrice >= minAllowed && entry.unitPrice <= maxAllowed)
      .map((entry) => entry.quote);
  }

  formatPairSpread(pairKeyName, pairQuotes, pairQuotesByKey) {
    const comparableQuotes = this.comparablePairQuotes(pairQuotes, pairQuotesByKey);
    if (comparableQuotes.length < 2) {
      return null;
    }
    const ordered = comparableQuotes.slice().sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1));
    const best = ordered[0];
    const next = ordered[1];
    const bestUnitPrice = this.quoteUnitPrice(best);
    const nextUnitPrice = this.quoteUnitPrice(next);
    const deltaPct = nextUnitPrice > 0 ? ((bestUnitPrice - nextUnitPrice) / nextUnitPrice) * 100 : 0;
    const pairUnit = `${best.tokenOut.symbol}/${best.tokenIn.symbol}`;

    return `${pairKeyName}: ${this.shortDexName(best.dex)}=${formatUnitPrice(bestUnitPrice)} ${pairUnit} | `
      + `${this.shortDexName(next.dex)}=${formatUnitPrice(nextUnitPrice)} ${pairUnit} | `
      + `Δ=${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%`;
  }

  formatDirectDiagnostic(diagnostic) {
    const projectedGrossReturn = diagnostic.loanAmount > 0n
      ? (diagnostic.grossReturn * DISPLAY_LOAN_USDC) / diagnostic.loanAmount
      : 0n;
    const projectedFlashFee = (DISPLAY_LOAN_USDC * this.state.flashLoanFeeBps) / 10_000n;
    const projectedGas = ethers.parseUnits('0.75', TOKENS.USDC.decimals);
    const projectedFinal = projectedGrossReturn - projectedFlashFee - projectedGas;
    const projectedPnl = projectedFinal - DISPLAY_LOAN_USDC;
    const projectedPnlPct = Number((projectedPnl * 10_000n) / DISPLAY_LOAN_USDC) / 100;
    const pnlPrefix = projectedPnl >= 0n ? '+' : '';

    return `USDC->${diagnostic.pair}(${this.shortDexName(diagnostic.buyDex)})->USDC(${this.shortDexName(diagnostic.sellDex)}): `
      + `100k => ${formatUsdc(projectedFinal)} USDC after flash fee/gas `
      + `(PnL ${pnlPrefix}${formatSignedUsdc(projectedPnl)} USDC, ${pnlPrefix}${projectedPnlPct.toFixed(2)}%)`;
  }

  logScanSummary({ quotes, directCount, triangularCount, viableCount, bestAttempt, directDiagnostics = [], topCandidates = [] }) {
    const dexCounts = {};
    const bestByPair = new Map();
    const pairQuotesByKey = new Map();
    const supportedDexes = ['uniswapV3', ...this.v2Dexes.map((dex) => dex.name), 'curve', 'balancer'];

    for (const quote of quotes.values()) {
      dexCounts[quote.dex] = (dexCounts[quote.dex] || 0) + 1;
      const key = `${quote.tokenIn.symbol}->${quote.tokenOut.symbol}`;
      const entries = pairQuotesByKey.get(key) || [];
      entries.push(quote);
      pairQuotesByKey.set(key, entries);
      const existing = bestByPair.get(key);
      if (!existing || quote.amountOut > existing.amountOut) {
        bestByPair.set(key, quote);
      }
    }
    const dexParts = supportedDexes.map((dex) => `${dex}:${dexCounts[dex] || 0}`);
    const inactiveDexes = supportedDexes.filter((dex) => !dexCounts[dex]);
    const radarLines = topCandidates.map((opportunity) => this.formatOpportunityRadar(opportunity));
    const quoteParts = [...bestByPair.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pair, quote]) => (
        `${pair}=${quote.dex}:${formatTokenAmount(quote.amountOut, quote.tokenOut, 4)} ${quote.tokenOut.symbol}`
      ));
    const pairSpreadLines = [...pairQuotesByKey.entries()]
      .map(([pair, pairQuotes]) => this.formatPairSpread(pair, pairQuotes, pairQuotesByKey))
      .filter(Boolean)
      .sort();

    console.log('');
    console.log(renderPanel('SCAN SNAPSHOT', [
      `quotes=${quotes.size}`,
      `dex=${dexParts.join(' | ')}`,
      'flash-asset=USDC only',
      `direct=${directCount} triangular=${triangularCount} viable=${viableCount}`,
      inactiveDexes.length ? `inactive=${inactiveDexes.join(', ')}` : 'inactive=none'
    ], '36'));

    if (radarLines.length) {
      console.log(renderPanel('ROUTE RADAR', radarLines, '35'));
      if (pairSpreadLines.length) {
        console.log(renderPanel('PAIR COMPARISON ONLY (per 1 token, not arb)', pairSpreadLines.slice(0, 12), '34'));
      }
    } else if (quoteParts.length) {
      if (pairSpreadLines.length) {
        console.log(renderPanel('PAIR COMPARISON ONLY (per 1 token, not arb)', pairSpreadLines.slice(0, 12), '34'));
      } else {
        console.log(renderPanel('MARKET SNAPSHOT', chunkLines(quoteParts, 2), '35'));
      }
    }

    if (!bestAttempt && directDiagnostics.length) {
      console.log(renderPanel('BEST USDC ROUNDTRIPS (actual arb check)', directDiagnostics.map((entry) => this.formatDirectDiagnostic(entry)), '33'));
    }

    if (bestAttempt) {
      console.log(renderPanel('TOP CANDIDATE', [
        `${bestAttempt.id}`,
        `gross=${formatTokenAmount(bestAttempt.expectedProfit, TOKENS.USDC, 6)} gas=${formatTokenAmount(bestAttempt.estimatedGasCost, TOKENS.USDC, 6)} flashFee=${formatTokenAmount(bestAttempt.flashLoanFee, TOKENS.USDC, 6)} net=${formatTokenAmount(bestAttempt.netProfit, TOKENS.USDC, 6)} USDC`,
        this.describeOpportunity(bestAttempt)
      ], bestAttempt.netProfit > MIN_PROFIT_USDC && bestAttempt.netProfit > 0n ? '32' : '33'));
    } else {
      console.log(renderPanel('TOP CANDIDATE', [
        'No profitable route found on this scan.',
        inactiveDexes.length ? `Missing live quotes from: ${inactiveDexes.join(', ')}` : 'All configured DEX buckets returned at least one quote.'
      ], '33'));
    }
  }

  findDirectOpportunities(quotes) {
    const dexes = ['uniswapV3', ...this.v2Dexes.map((dex) => dex.name), 'curve', 'balancer'];
    const opportunities = [];

    for (const secondarySymbol of SECONDARY_TOKENS) {
      for (const buyDex of dexes) {
        for (const sellDex of dexes) {
          if (buyDex === sellDex) {
            continue;
          }
          const firstLeg = this.getQuote(quotes, buyDex, 'USDC', secondarySymbol);
          if (!firstLeg) {
            continue;
          }

          const secondLeg = this.getQuote(quotes, sellDex, secondarySymbol, 'USDC');
          if (!secondLeg) {
            continue;
          }

          const grossReturn = (firstLeg.amountOut * secondLeg.amountOut) / secondLeg.amountIn;
          if (grossReturn <= firstLeg.amountIn) {
            continue;
          }

          const expectedProfit = grossReturn - firstLeg.amountIn;
          opportunities.push({
            id: `direct:${buyDex}:${sellDex}:USDC:${secondarySymbol}`,
            type: 'direct',
            loanAsset: TOKENS.USDC,
            loanAmount: firstLeg.amountIn > MAX_TRADE_SIZE_USDC ? MAX_TRADE_SIZE_USDC : firstLeg.amountIn,
            path: [firstLeg, { ...secondLeg, amountIn: firstLeg.amountOut, amountOut: grossReturn }],
            expectedProfit,
            estimatedGasCost: ethers.parseUnits('0.75', TOKENS.USDC.decimals)
          });
        }
      }
    }

    return opportunities;
  }

  buildDirectDiagnostics(quotes) {
    const dexes = ['uniswapV3', ...this.v2Dexes.map((dex) => dex.name), 'curve', 'balancer'];
    const diagnostics = [];

    for (const secondarySymbol of SECONDARY_TOKENS) {
      for (const buyDex of dexes) {
        for (const sellDex of dexes) {
          if (buyDex === sellDex) {
            continue;
          }
          const firstLeg = this.getQuote(quotes, buyDex, 'USDC', secondarySymbol);
          const secondLeg = this.getQuote(quotes, sellDex, secondarySymbol, 'USDC');
          if (!firstLeg || !secondLeg) {
            continue;
          }

          const grossReturn = (firstLeg.amountOut * secondLeg.amountOut) / secondLeg.amountIn;
          if (shouldDebugPair('USDC', secondarySymbol) || shouldDebugPair(secondarySymbol, 'USDC')) {
            console.log(
              `[price-debug] direct-check pair=USDC->${secondarySymbol}->USDC `
              + `buyDex=${buyDex} sellDex=${sellDex} `
              + `firstLeg=${formatTokenAmount(firstLeg.amountIn, firstLeg.tokenIn, 6)} ${firstLeg.tokenIn.symbol}`
              + `->${formatTokenAmount(firstLeg.amountOut, firstLeg.tokenOut, 6)} ${firstLeg.tokenOut.symbol} `
              + `secondLeg=${formatTokenAmount(secondLeg.amountIn, secondLeg.tokenIn, 6)} ${secondLeg.tokenIn.symbol}`
              + `->${formatTokenAmount(secondLeg.amountOut, secondLeg.tokenOut, 6)} ${secondLeg.tokenOut.symbol} `
              + `grossReturn=${formatTokenAmount(grossReturn, TOKENS.USDC, 6)} USDC`
            );
          }
          diagnostics.push({
            pair: secondarySymbol,
            buyDex,
            sellDex,
            loanAmount: firstLeg.amountIn,
            grossReturn
          });
        }
      }
    }

    return diagnostics
      .sort((a, b) => (a.grossReturn > b.grossReturn ? -1 : 1))
      .slice(0, 12);
  }

  findTriangularOpportunities(quotes) {
    const dexes = ['uniswapV3', ...this.v2Dexes.map((dex) => dex.name), 'curve', 'balancer'];
    const opportunities = [];

    for (const firstToken of SECONDARY_TOKENS) {
      for (const secondToken of SECONDARY_TOKENS) {
        if (firstToken === secondToken) {
          continue;
        }
        for (const dexA of dexes) {
          for (const dexB of dexes) {
            for (const dexC of dexes) {
              const leg1 = this.getQuote(quotes, dexA, 'USDC', firstToken);
              const leg2 = this.getQuote(quotes, dexB, firstToken, secondToken);
              const leg3 = this.getQuote(quotes, dexC, secondToken, 'USDC');
              if (!leg1 || !leg2 || !leg3) {
                continue;
              }

              const out2 = (leg1.amountOut * leg2.amountOut) / leg2.amountIn;
              const out3 = (out2 * leg3.amountOut) / leg3.amountIn;
              if (out3 <= leg1.amountIn) {
                continue;
              }

              opportunities.push({
                id: `tri:${dexA}:${dexB}:${dexC}:USDC:${firstToken}:${secondToken}`,
                type: 'triangular',
                loanAsset: TOKENS.USDC,
                loanAmount: leg1.amountIn > MAX_TRADE_SIZE_USDC ? MAX_TRADE_SIZE_USDC : leg1.amountIn,
                path: [
                  leg1,
                  { ...leg2, amountIn: leg1.amountOut, amountOut: out2 },
                  { ...leg3, amountIn: out2, amountOut: out3 }
                ],
                expectedProfit: out3 - leg1.amountIn,
                estimatedGasCost: ethers.parseUnits('1.1', TOKENS.USDC.decimals)
              });
            }
          }
        }
      }
    }

    return opportunities;
  }

  async estimateGasCost(opportunity, marketQuotes = this.latestQuotes) {
    const params = this.buildFlashLoanParams(opportunity, true);
    const populated = await this.arbContract.requestArbitrage.populateTransaction(params);
    const estimate = await this.wallet.estimateGas(populated);
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
    const gasWithBuffer = (estimate * BigInt(GAS_LIMIT_BUFFER_BPS)) / 10_000n;
    const ethCost = gasWithBuffer * gasPrice;
    const wethUsdc = this.getQuote(marketQuotes, 'uniswapV3', 'WETH', 'USDC');
    if (!wethUsdc) {
      return ethers.parseUnits('1', TOKENS.USDC.decimals);
    }
    return (ethCost * wethUsdc.amountOut) / wethUsdc.amountIn;
  }

  buildFlashLoanParams(opportunity, forEstimation = false) {
    const approvals = new Map();
    const calls = [];
    let currentAmountIn = opportunity.loanAmount;

    for (const step of opportunity.path) {
      const minAmountOut = applyBps(step.amountOut, SLIPPAGE_BPS, true);
      const spender = this.getDexSpender(step);
      uniquePush(approvals, `${step.tokenIn.address}:${spender}`, {
        token: step.tokenIn.address,
        spender,
        amount: currentAmountIn
      });
      calls.push(this.buildSwapCall(step, currentAmountIn, minAmountOut, forEstimation));
      currentAmountIn = step.amountOut;
    }

    return {
      asset: opportunity.loanAsset.address,
      amount: opportunity.loanAmount,
      minProfit: MIN_PROFIT_USDC,
      profitReceiver: this.wallet.address,
      approvalTokens: Array.from(approvals.values()).map((entry) => entry.token),
      approvalSpenders: Array.from(approvals.values()).map((entry) => entry.spender),
      approvalAmounts: Array.from(approvals.values()).map((entry) => entry.amount),
      calls
    };
  }

  getDexSpender(step) {
    if (step.dex === 'uniswapV3') {
      return ADDRESSES.uniswapV3Router;
    }
    if (this.v2Dexes.some((dex) => dex.name === step.dex)) {
      return this.getV2Dex(step.dex).address;
    }
    if (step.dex === 'balancer') {
      return ADDRESSES.balancerVault;
    }
    if (step.dex === 'curve') {
      return step.routeData.pool.address;
    }
    throw new Error(`Unsupported dex ${step.dex}`);
  }

  buildSwapCall(step, amountIn, minAmountOut) {
    if (step.dex === 'uniswapV3') {
      return {
        target: ADDRESSES.uniswapV3Router,
        value: 0,
        data: this.uniswapRouterInterface.encodeFunctionData('exactInputSingle', [{
          tokenIn: step.tokenIn.address,
          tokenOut: step.tokenOut.address,
          fee: step.routeData.fee,
          recipient: process.env.ARBITRAGE_CONTRACT,
          deadline: Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
          amountIn,
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0
        }])
      };
    }

    if (this.v2Dexes.some((dex) => dex.name === step.dex)) {
      const dex = this.getV2Dex(step.dex);
      return {
        target: dex.address,
        value: 0,
        data: dex.interface.encodeFunctionData('swapExactTokensForTokens', [
          amountIn,
          minAmountOut,
          [step.tokenIn.address, step.tokenOut.address],
          process.env.ARBITRAGE_CONTRACT,
          Math.floor(Date.now() / 1000) + DEADLINE_SECONDS
        ])
      };
    }

    if (step.dex === 'balancer') {
      return {
        target: ADDRESSES.balancerVault,
        value: 0,
        data: this.balancerVaultInterface.encodeFunctionData('swap', [{
          poolId: step.routeData.pool.poolId,
          kind: 0,
          assetIn: step.tokenIn.address,
          assetOut: step.tokenOut.address,
          amount: amountIn,
          userData: '0x'
        }, {
          sender: process.env.ARBITRAGE_CONTRACT,
          fromInternalBalance: false,
          recipient: process.env.ARBITRAGE_CONTRACT,
          toInternalBalance: false
        }, minAmountOut, Math.floor(Date.now() / 1000) + DEADLINE_SECONDS])
      };
    }

    if (step.dex === 'curve') {
      return {
        target: step.routeData.pool.address,
        value: 0,
        data: this.curvePoolInterface.encodeFunctionData('exchange', [
          step.routeData.i,
          step.routeData.j,
          amountIn,
          minAmountOut
        ])
      };
    }

    throw new Error(`Unsupported dex ${step.dex}`);
  }

  async executeOpportunity(opportunity) {
    const params = this.buildFlashLoanParams(opportunity);
    console.log(`Executing ${opportunity.id}`);

    const tx = await this.arbContract.requestArbitrage(params, {
      gasLimit: 1_800_000
    });
    const receipt = await tx.wait();
    console.log(`Arbitrage executed in tx ${receipt.hash}`);
  }

  async safeQuoteUniswap(tokenIn, tokenOut, amountIn, fee) {
    try {
      const result = await this.uniswapQuoter.quoteExactInputSingle.staticCall({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0
      });
      return [this.makeQuote({
        dex: 'uniswapV3',
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: normalizeAmountOut(result),
        routeData: { fee }
      })];
    } catch {
      return [];
    }
  }

  getV2Dex(name) {
    const dex = this.v2Dexes.find((entry) => entry.name === name);
    if (!dex) {
      throw new Error(`Unsupported v2 dex ${name}`);
    }
    return dex;
  }

  describeOpportunity(opportunity) {
    const routeSummary = opportunity.path.map((step) => (
      `${step.dex}:${step.tokenIn.symbol}->${step.tokenOut.symbol} `
      + `${formatTokenAmount(step.amountIn, step.tokenIn, 6)} -> ${formatTokenAmount(step.amountOut, step.tokenOut, 6)}`
    )).join(' | ');
    const verdict = opportunity.netProfit > MIN_PROFIT_USDC && opportunity.netProfit > 0n ? 'YES' : 'NO';
    return `[analysis] route=${routeSummary} spread=${formatSignedUsdc(opportunity.expectedProfit)} USDC `
      + `gas=${formatSignedUsdc(opportunity.estimatedGasCost || 0n)} USDC `
      + `flashFee=${formatSignedUsdc(opportunity.flashLoanFee || 0n)} USDC `
      + `net=${formatSignedUsdc(opportunity.netProfit || 0n)} USDC `
      + `arb-worthy=${verdict}`;
  }

  async safeQuoteV2Dex(dexName, tokenIn, tokenOut, amountIn) {
    const dex = this.getV2Dex(dexName);
    const quotes = [];
    try {
      for (const path of this.buildV2Paths(tokenIn, tokenOut)) {
        try {
          const amounts = await dex.contract.getAmountsOut(amountIn, path);
          quotes.push(this.makeQuote({
            dex: dex.name,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut: amounts[amounts.length - 1],
            routeData: { path }
          }));
        } catch {
          // ignore per-path failures
        }
      }
      return quotes.filter(Boolean);
    } catch {
      return quotes.filter(Boolean);
    }
  }

  buildV2Paths(tokenIn, tokenOut) {
    const directPath = [tokenIn.address, tokenOut.address];
    const connectorSymbols = ['WETH', 'USDC', 'USDT', 'DAI'];
    const paths = [directPath];

    for (const connectorSymbol of connectorSymbols) {
      const connector = TOKENS[connectorSymbol];
      if (!connector || connector.address === tokenIn.address || connector.address === tokenOut.address) {
        continue;
      }
      paths.push([tokenIn.address, connector.address, tokenOut.address]);
    }

    return uniquePaths(paths);
  }

  async safeQuoteCurve(tokenIn, tokenOut, amountIn) {
    const quotes = [];
    for (const pool of CURVE_POOLS) {
      const mapping = pool.supportedPairs[pairKey(tokenIn.symbol, tokenOut.symbol)];
      if (!mapping) {
        continue;
      }
      try {
        const curvePool = new ethers.Contract(pool.address, CURVE_POOL_ABI, this.provider);
        const amountOut = await curvePool.get_dy(mapping.i, mapping.j, amountIn);
        quotes.push(this.makeQuote({
          dex: 'curve',
          tokenIn,
          tokenOut,
          amountIn,
          amountOut,
          routeData: { pool, i: mapping.i, j: mapping.j }
        }));
      } catch {
        // ignore per-pool read failures
      }
    }
    return quotes;
  }

  async safeQuoteBalancer(tokenIn, tokenOut, amountIn) {
    const quotes = [];
    for (const pool of BALANCER_POOLS) {
      const mapping = pool.pairs[pairKey(tokenIn.symbol, tokenOut.symbol)];
      if (!mapping) {
        continue;
      }
      try {
        const deltas = await this.balancerVault.queryBatchSwap.staticCall(
          0,
          [{
            poolId: pool.poolId,
            assetInIndex: mapping.assetInIndex,
            assetOutIndex: mapping.assetOutIndex,
            amount: amountIn,
            userData: '0x'
          }],
          pool.assets,
          {
            sender: process.env.ARBITRAGE_CONTRACT,
            fromInternalBalance: false,
            recipient: process.env.ARBITRAGE_CONTRACT,
            toInternalBalance: false
          }
        );
        const amountOut = deltas[mapping.assetOutIndex] < 0 ? -deltas[mapping.assetOutIndex] : 0n;
        if (amountOut > 0) {
          quotes.push(this.makeQuote({
            dex: 'balancer',
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            routeData: { pool, ...mapping }
          }));
        }
      } catch {
        // ignore per-pool read failures
      }
    }
    return quotes;
  }
}

async function main() {
  const bot = new ArbitrageBot();
  await bot.init();
  await bot.start();

  process.on('SIGINT', async () => {
    console.log('Stopping bot...');
    await bot.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
