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

const TOKEN_LIST = Object.values(TOKENS);
const TOKEN_BY_ADDRESS = Object.fromEntries(TOKEN_LIST.map((token) => [token.address.toLowerCase(), token]));
const SECONDARY_TOKENS = ['WETH', 'DAI', 'USDT'];

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
    this.balancerVault = new ethers.Contract(ADDRESSES.balancerVault, BALANCER_VAULT_ABI, this.provider);
    this.balancerVaultInterface = new ethers.Interface(BALANCER_VAULT_ABI);
    this.curvePoolInterface = new ethers.Interface(CURVE_POOL_ABI);

    const provider = new ethers.Contract(ADDRESSES.aavePoolAddressesProvider, AAVE_POOL_PROVIDER_ABI, this.provider);
    const poolAddress = await provider.getPool();
    const pool = new ethers.Contract(poolAddress, AAVE_POOL_ABI, this.provider);
    this.state.flashLoanFeeBps = BigInt(await pool.FLASHLOAN_PREMIUM_TOTAL());

    console.log(`Connected to ${this.rpc.currentUrl}`);
    console.log(`Wallet: ${this.wallet.address}`);
    console.log(`Flash loan fee: ${this.state.flashLoanFeeBps} bps`);
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
      bestAttempt
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

      multicallPayload.push({
        target: ADDRESSES.sushiRouter,
        allowFailure: true,
        callData: this.sushiRouterInterface.encodeFunctionData('getAmountsOut', [baseAmount, [tokenIn.address, tokenOut.address]])
      });
      decoders.push({ type: 'sushi', tokenIn, tokenOut, amountIn: baseAmount });

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
      } else if (meta.type === 'sushi') {
        const [amounts] = this.sushiRouterInterface.decodeFunctionResult('getAmountsOut', response.returnData);
        this.storeQuote(quotes, this.makeQuote({
          dex: 'sushiswap',
          tokenIn: meta.tokenIn,
          tokenOut: meta.tokenOut,
          amountIn: meta.amountIn,
          amountOut: amounts[amounts.length - 1],
          routeData: { path: [meta.tokenIn.address, meta.tokenOut.address] }
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

  async collectCrossQuotes(quotes, tokenIn, tokenOut, amountIn) {
    const uniFee = UNISWAP_V3_FEES[pairKey(tokenIn.symbol, tokenOut.symbol)]
      || UNISWAP_V3_FEES[pairKey(tokenOut.symbol, tokenIn.symbol)]
      || 3000;

    const quoteCalls = [
      this.safeQuoteUniswap(tokenIn, tokenOut, amountIn, uniFee),
      this.safeQuoteSushi(tokenIn, tokenOut, amountIn),
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
    quotes.set(key, quote);
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

  logScanSummary({ quotes, directCount, triangularCount, viableCount, bestAttempt }) {
    const dexCounts = {};
    const bestByPair = new Map();

    for (const quote of quotes.values()) {
      dexCounts[quote.dex] = (dexCounts[quote.dex] || 0) + 1;
      const key = `${quote.tokenIn.symbol}->${quote.tokenOut.symbol}`;
      const existing = bestByPair.get(key);
      if (!existing || quote.amountOut > existing.amountOut) {
        bestByPair.set(key, quote);
      }
    }

    const quoteParts = [...bestByPair.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pair, quote]) => (
        `${pair}=${quote.dex}:${formatTokenAmount(quote.amountOut, quote.tokenOut, 4)} ${quote.tokenOut.symbol}`
      ));

    console.log(
      `[scan] quotes=${quotes.size} dex=${JSON.stringify(dexCounts)} `
      + `direct=${directCount} triangular=${triangularCount} viable=${viableCount}`
    );

    if (quoteParts.length) {
      console.log(`[quotes] ${quoteParts.join(' | ')}`);
    }

    if (bestAttempt) {
      console.log(
        `[candidate] ${bestAttempt.id} gross=${formatTokenAmount(bestAttempt.expectedProfit, TOKENS.USDC, 6)} `
        + `gas=${formatTokenAmount(bestAttempt.estimatedGasCost, TOKENS.USDC, 6)} `
        + `flashFee=${formatTokenAmount(bestAttempt.flashLoanFee, TOKENS.USDC, 6)} `
        + `net=${formatTokenAmount(bestAttempt.netProfit, TOKENS.USDC, 6)} USDC`
      );
    } else {
      console.log('[candidate] none');
    }
  }

  findDirectOpportunities(quotes) {
    const dexes = ['uniswapV3', 'sushiswap', 'curve', 'balancer'];
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

  findTriangularOpportunities(quotes) {
    const dexes = ['uniswapV3', 'sushiswap', 'curve', 'balancer'];
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
    if (step.dex === 'sushiswap') {
      return ADDRESSES.sushiRouter;
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

    if (step.dex === 'sushiswap') {
      return {
        target: ADDRESSES.sushiRouter,
        value: 0,
        data: this.sushiRouterInterface.encodeFunctionData('swapExactTokensForTokens', [
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

  async safeQuoteSushi(tokenIn, tokenOut, amountIn) {
    try {
      const amounts = await this.sushiRouter.getAmountsOut(amountIn, [tokenIn.address, tokenOut.address]);
      return [this.makeQuote({
        dex: 'sushiswap',
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: amounts[amounts.length - 1],
        routeData: { path: [tokenIn.address, tokenOut.address] }
      })];
    } catch {
      return [];
    }
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
