# Arbitrum Arbitrage Opportunity Scanner

A production-style **on-chain arbitrage scanner** for **Arbitrum**. It reads live quotes from supported DEX routers/quoters and prints **cross-DEX** and **triangular** opportunities to the CLI.

## Scope

This project is **scanner-only**:

- ✅ Uses on-chain DEX data only
- ✅ Supports WebSocket + HTTP RPC
- ✅ Computes spread and estimated USD profit
- ✅ Includes gas-aware filtering
- ❌ Does **not** execute trades
- ❌ Does **not** use flash loans
- ❌ Does **not** use centralized exchanges

## Supported DEXs

- Uniswap V3
- SushiSwap
- Camelot

## Supported pairs in the example config

- WETH / USDC
- WBTC / USDC
- ARB / USDC
- ARB / WETH

## Features

- Modular architecture under `src/`
- Real-time scanning loop (default: every 2 seconds)
- Configurable trade sizes, thresholds, RPC endpoints, and tokens
- Cross-DEX arbitrage detection
- Triangular arbitrage detection
- Estimated gas-aware USD profitability
- JSON + CSV exports
- Console-first output for operational monitoring

## Project structure

```text
src/
  arbitrage/
  dex/
  pricing/
  utils/
config/
  config.json
```

## Installation

```bash
npm install
```

> If your environment already has the dependencies vendored, you can run the scanner immediately.

## Configuration

Edit `config/config.json`.

Example:

```json
{
  "rpc": {
    "httpUrl": "https://arb1.arbitrum.io/rpc",
    "wsUrl": "wss://arb1.arbitrum.io/ws"
  },
  "scanIntervalMs": 2000,
  "gasLimitPerSwap": 250000,
  "gasMultiplier": 1.15,
  "minProfitUsd": 20,
  "minSpreadPct": 0.5,
  "tradeSizesUsd": [1000, 10000, 100000]
}
```

You can also:

- disable individual DEX adapters
- add/remove token pairs
- add/remove triangular routes
- change export output paths

## How it works

### 1. Quote collection

- **Uniswap V3** quotes are fetched from the **Quoter** contract.
- **SushiSwap** and **Camelot** quotes are fetched via `getAmountsOut` on router-style contracts.
- Token decimals are normalized before price/profit calculations.

### 2. Cross-DEX arbitrage

For each configured pair and trade size:

1. Quote `quoteToken -> baseToken` on each DEX
2. Treat the best route as the synthetic buy leg
3. Re-quote `baseToken -> quoteToken` on other DEXs
4. Subtract estimated gas cost
5. Keep only opportunities above configured spread/profit thresholds

### 3. Triangular arbitrage

For each configured cycle, e.g. `USDC -> WETH -> ARB -> USDC`:

1. Quote hop 1
2. Feed output into hop 2
3. Feed output into hop 3
4. Compute cycle spread and net estimated USD profit after gas

## Running the scanner

With the default config path:

```bash
npm start
```

With a custom config file:

```bash
node src/index.js --config ./config/config.json
```

## CLI output example

```text
[OPPORTUNITY]
PAIR: WETH/USDC
BUY: UniswapV3 @ 1823.210000
SELL: SushiSwap @ 1831.450000
SPREAD: 0.45%
EST_PROFIT (10,000): $82.12
EST_GAS: $4.83
```

## Notes for production usage

- Use a high-quality Arbitrum RPC provider for stable latency.
- Consider routing RPC reads over WebSocket for lower-latency block updates.
- Increase the pair universe gradually and benchmark RPC saturation.
- Tune `gasLimitPerSwap` and `gasMultiplier` to match your infrastructure.
- Extend `src/dex/` if you want to add more Arbitrum-native venues.

## Validation

```bash
npm run lint
```
