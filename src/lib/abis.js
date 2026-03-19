const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

const AAVE_POOL_PROVIDER_ABI = ['function getPool() view returns (address)'];
const AAVE_POOL_ABI = ['function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)'];

const FLASH_LOAN_ARBITRAGE_ABI = [
  'function requestArbitrage((address asset,uint256 amount,uint256 minProfit,address profitReceiver,address[] approvalTokens,address[] approvalSpenders,uint256[] approvalAmounts,(address target,uint256 value,bytes data)[] calls) params) external',
  'function pause() external',
  'function unpause() external',
  'function executor() view returns (address)'
];

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) view returns (tuple(bool success,bytes returnData)[] returnData)'
];

const UNISWAP_V3_QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'
];

const UNISWAP_V3_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)'
];

const SUSHI_V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) returns (uint256[] memory amounts)'
];

const BALANCER_VAULT_ABI = [
  'function queryBatchSwap(uint8 kind, tuple(bytes32 poolId,uint256 assetInIndex,uint256 assetOutIndex,uint256 amount,bytes userData)[] swaps, address[] assets, tuple(address sender,bool fromInternalBalance,address recipient,bool toInternalBalance) funds) returns (int256[] assetDeltas)',
  'function swap(tuple(bytes32 poolId,uint8 kind,address assetIn,address assetOut,uint256 amount,bytes userData) singleSwap, tuple(address sender,bool fromInternalBalance,address recipient,bool toInternalBalance) funds, uint256 limit, uint256 deadline) payable returns (uint256 amountCalculated)'
];

const CURVE_POOL_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
  'function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)'
];

module.exports = {
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
};
