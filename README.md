# Flash Loan Arbitrage Bot

Production-focused USDC flash-loan arbitrage system for Ethereum mainnet and Arbitrum.

## Features

- Solidity arbitrage executor with Aave V3 + Balancer flash-loan support
- Multi-DEX route execution (Uniswap, SushiSwap, Curve, Balancer adapters)
- Off-chain scanner for USDC/WETH, USDC/USDT, USDC/DAI
- Private transaction execution using Flashbots relay
- Mainnet-fork integration testing and unit tests
- Configurable risk parameters: slippage, minimum profit, max gas price

## Repository Layout

```text
/contracts/ArbitrageExecutor.sol
/contracts/mocks/*
/scripts/deploy.ts
/scripts/simulate.ts
/bot/scanner.ts
/bot/executor.ts
/config/networks.json.example
/tests/*.test.ts
/ci/github-actions.yml
README.md
SECURITY.md
```

## Quick Start

```bash
npm install
cp .env.example .env
npm run build
npm test
```

## Environment Variables

Required:

- `RPC_URL`
- `PRIVATE_KEY`
- `FLASHBOTS_RELAY`

Optional:

- `MAINNET_RPC_URL`
- `ARBITRUM_RPC_URL`
- `CHAIN`
- `EXECUTOR_ADDRESS`
- `FORK_BLOCK`
- `POLL_MS`
- `TRADE_SIZE_USDC`
- `MIN_PROFIT`

## Deploy

```bash
npm run deploy:mainnet
npm run deploy:arbitrum
```

## Run Scanner + Executor

```bash
npx ts-node bot/scanner.ts
npx ts-node bot/executor.ts
```

## Simulate On-Chain Parameters

```bash
EXECUTOR_ADDRESS=<deployed_address> npm run simulate
```

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
