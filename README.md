# Arbitrum USDC Flash-Loan Arbitrage Bot

This repository contains a production-oriented USDC-centric flash-loan arbitrage system for Arbitrum using:

- **Aave v3** for flash loans
- **Uniswap v3**, **SushiSwap**, **Curve**, and **Balancer** for quoting and execution
- **Node.js + ethers.js** for off-chain scanning and transaction submission
- **Solidity** for atomic execution and profit validation

> Important: this is a serious on-chain trading system. Run it only after validating token routes, pool IDs, gas behavior, and revert paths on an Arbitrum fork or test environment.

## Architecture

### 1. Smart contract

`FlashLoanArbitrage.sol` performs the atomic execution layer:

- borrows the flash-loan asset from Aave v3
- applies the approvals required for each swap step
- executes arbitrary low-level swap calls against supported routers/pools
- validates that the final balance covers:
  - flash-loan principal
  - flash-loan premium
  - configured minimum profit
- repays the loan and transfers the profit to the configured receiver
- supports owner pause/unpause and emergency recovery

### 2. Bot

`bot.js` is the automation layer:

- rotates between multiple **free public Arbitrum RPC endpoints**
- scans every **10 seconds** by default
- gathers direct and triangular opportunities centered on **USDC**
- estimates gas cost and flash-loan fees
- applies slippage limits and minimum profit thresholds
- signs and sends transactions with the **PRIVATE_KEY** from `.env`
- supports an **emergency stop** via env flag or sentinel file

### 3. Config

`src/config/arbitrum.js` centralizes:

- token metadata
- protocol addresses
- public RPC fallback list
- default trade sizes
- Uniswap fee tiers
- protocol defaults that are already baked into the codebase

## Supported tokens

Primary token:
- USDC

Secondary tokens:
- WETH
- DAI
- USDT

## Supported opportunity types

### Direct arbitrage

Example:

1. flash-borrow USDC
2. swap USDC -> WETH on DEX A
3. swap WETH -> USDC on DEX B
4. repay Aave
5. keep the spread

### Triangular arbitrage

Example:

1. flash-borrow USDC
2. swap USDC -> WETH on DEX A
3. swap WETH -> DAI on DEX B
4. swap DAI -> USDC on DEX C
5. repay Aave
6. keep the spread

## MEV / risk controls

The bot includes the following safeguards:

- **slippage protection** via `amountOutMinimum`
- **atomic settlement** via flash-loan callback execution
- **profit validation on-chain** before repayment approval
- **minimum profit threshold** via `MIN_PROFIT_USDC`
- **maximum trade size** via `MAX_TRADE_SIZE_USDC`
- **emergency stop** via `.emergency-stop` file or `EMERGENCY_STOP=true`
- **public RPC fallback** to avoid a single endpoint dependency

### Private transaction submission

Public free RPC endpoints generally broadcast to the public mempool. If you have access to a private relay/builder that supports Arbitrum private delivery, you can extend `executeOpportunity()` to submit through that endpoint instead of `eth_sendRawTransaction`.

## Installation

```bash
npm install
cp .env.example .env
```

Fill in at minimum:

- `PRIVATE_KEY`
- `ARBITRAGE_CONTRACT` after deployment

You do **not** need to know Aave / pool / router addresses manually; they are already prefilled in the repository defaults.

## Deploy the contract

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network arbitrum
```

Or use the npm script:

```bash
npm run deploy
```

After deployment, copy the deployed address into:

```bash
ARBITRAGE_CONTRACT=0x...
```

## Run the bot

```bash
node bot.js
```

Or:

```bash
npm start
```

## Important note about pool addresses

You said you do not have pool addresses and only want to provide:

1. wallet private key
2. deployed contract address

The repository is now aligned with that workflow:

- `.env.example` only expects those two fields from you in practice
- Aave and RPC defaults are already set
- no Curve/Balancer pool IDs are required in `.env`

If later you want to widen the route universe, you can still edit `src/config/arbitrum.js`, but it is no longer required for first run.

## Operational notes

- Always test on a **forked Arbitrum environment** before production capital.
- Tune the trade sizes and slippage thresholds per pair.
- Keep a reserve of ETH on Arbitrum for gas.
- Reassess pool configuration periodically because liquidity moves.
- Add observability (Prometheus/Telegram/Discord/webhooks) before production deployment.

## Quick start

1. `npm install`
2. `cp .env.example .env`
3. put your `PRIVATE_KEY`
4. deploy the contract
5. put your `ARBITRAGE_CONTRACT`
6. run `node bot.js`

## Security warnings

- Do **not** commit your real `.env` file.
- Do **not** run this with large capital before thorough fork testing.
- Public mempool execution is MEV-sensitive.
- Smart-contract and execution logic should be independently audited before meaningful capital deployment.
