# Security Analysis

## Threat Model

### 1. MEV and Front-Running
- **Risk**: Public mempool submission can be copied or sandwiched.
- **Mitigation**: `bot/executor.ts` submits bundles through Flashbots/private relay only.

### 2. Slippage / Pool Manipulation
- **Risk**: Attackers move price before execution.
- **Mitigation**: Contract enforces `minAmountOut` per step and global minimum profit threshold.

### 3. Flash Loan Callback Abuse
- **Risk**: Untrusted caller invokes callbacks.
- **Mitigation**: Callback authorization checks (`msg.sender == aavePool` / `balancerVault`).

### 4. Reentrancy
- **Risk**: Nested execution during arbitrage can drain funds.
- **Mitigation**: `ReentrancyGuard` on top-level execution and strict control flow.

### 5. Gas Price Spikes
- **Risk**: Opportunity appears profitable but gas spikes before inclusion.
- **Mitigation**: `maxGasPrice` on-chain guard + off-chain gas-inclusive profit calculation.

### 6. Approval/Token Handling
- **Risk**: Unsafe ERC20 interactions.
- **Mitigation**: OpenZeppelin `SafeERC20` for transfers and approvals.

## Operational Risks

- Incorrect DEX adapter calldata can revert or mis-route funds.
- Stale off-chain quotes may cause false positives.
- Chain congestion may delay private bundle inclusion.
- Pool liquidity fragmentation can invalidate assumptions.

## Recommended Ops Controls

- Use hardware-backed signer or isolated key management.
- Run scanner + executor with health checks and alerting.
- Maintain dynamic gas and slippage models.
- Enforce per-route notional limits.
- Keep an emergency pause/ownership runbook.

## Static Analysis

Run before deploy:

```bash
slither contracts/ArbitrageExecutor.sol
myth analyze contracts/ArbitrageExecutor.sol
```
