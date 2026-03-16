# Flash Loan Arbitrage Bot

Production-focused USDC flash-loan arbitrage system for Ethereum mainnet and Arbitrum.

## Features

- Solidity arbitrage executor with Aave V3 + Balancer flash-loan support
- Multi-DEX route execution (Uniswap, SushiSwap, Curve, Balancer adapters)
- Off-chain scanner for USDC/WETH, USDC/USDT, USDC/DAI
- Private transaction execution using Flashbots relay/private RPC
- Mainnet-fork integration testing and unit tests
- Configurable risk parameters: slippage, minimum profit, max gas price

## Repository Layout

```text
/contracts/ArbitrageExecutor.sol
/contracts/mocks/*
/scripts/deploy.ts
/scripts/simulate.ts
/bot/runtimeConfig.ts
/bot/scanner.ts
/bot/executor.ts
/config/networks.json.example
/tests/*.test.ts
/ci/github-actions.yml
README.md
SECURITY.md
```

## Quick Start (Simple)

Only set these in `.env`:

- `PRIVATE_KEY`
- `ALCHEMY_API_KEY` (optional)

Defaults if not provided:

- Scanner/executor auto-load `.env`
- Public RPC fallback (`cloudflare-eth` on mainnet, `arb1.arbitrum.io/rpc` on Arbitrum)
- Private relay (`https://relay.flashbots.net` for mainnet)
- Executor address from `deployments/latest.json` after deploy

```bash
npm install
cp .env.example .env
npm run build
```

## Deploy

```bash
# default chain: mainnet (set CHAIN=arbitrum for Arbitrum)
CHAIN=mainnet npm run deploy:mainnet
```

This writes `deployments/latest.json` automatically.

## Run Scanner + Executor

```bash
npx ts-node bot/scanner.ts
npx ts-node bot/executor.ts
```

## Simulate On-Chain Parameters

```bash
# uses RPC resolution from runtimeConfig (no hardhat fork needed)
npm run simulate
```

## Optional Overrides

You can still override anything via env vars:

- `RPC_URL`, `MAINNET_RPC_URL`, `ARBITRUM_RPC_URL`
- `FLASHBOTS_RELAY`
- `EXECUTOR_ADDRESS`
- `POLL_MS`, `TRADE_SIZE_USDC`, `MIN_PROFIT`, `MAX_GAS_USDC`

## Security Tooling

```bash
pip install slither-analyzer mythril
slither contracts/ArbitrageExecutor.sol
myth analyze contracts/ArbitrageExecutor.sol
```

## Production Notes

- Replace placeholder quote adapters in `bot/scanner.ts` with real per-DEX pool quoting logic.
- Extend execution payload encoding for route-specific data (`Curve` indices, `Balancer` pool IDs).
- Route all submissions via private relays / builder APIs to avoid public mempool exposure.
