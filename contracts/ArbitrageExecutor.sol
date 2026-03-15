// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IAavePool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IBalancerFlashLoanRecipient {
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
}

interface IUniswapV2RouterLike {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface ICurvePoolLike {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 minDy
    ) external returns (uint256);
}

interface IBalancerPoolLike {
    function swap(
        bytes32 poolId,
        uint8 kind,
        address assetIn,
        address assetOut,
        uint256 amount,
        bytes memory userData
    ) external returns (uint256 amountCalculated);
}

contract ArbitrageExecutor is
    IFlashLoanSimpleReceiver,
    IBalancerFlashLoanRecipient,
    ReentrancyGuard,
    Ownable
{
    using SafeERC20 for IERC20;

    enum FlashLoanProvider {
        AaveV3,
        Balancer
    }

    enum DexType {
        Uniswap,
        Sushi,
        Curve,
        Balancer
    }

    struct SwapStep {
        DexType dex;
        address routerOrPool;
        address tokenIn;
        address tokenOut;
        uint256 minAmountOut;
        bytes data;
    }

    struct ArbitrageParams {
        address loanToken;
        uint256 loanAmount;
        SwapStep[] steps;
        uint256 minProfit;
        FlashLoanProvider provider;
    }

    address public immutable usdc;
    address public aavePool;
    address public balancerVault;

    uint256 public slippageToleranceBps = 50;
    uint256 public minimumProfitThreshold = 10e6;
    uint256 public maxGasPrice = 120 gwei;

    event FlashLoanRequested(address indexed token, uint256 amount, FlashLoanProvider provider);
    event SwapExecuted(
        DexType indexed dex,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event ArbitrageProfit(address indexed token, uint256 grossProfit, uint256 netProfit, uint256 gasPrice);
    event TransactionReverted(string reason);
    event ConfigurationUpdated(uint256 slippageToleranceBps, uint256 minimumProfitThreshold, uint256 maxGasPrice);

    constructor(address _usdc, address _aavePool, address _balancerVault) Ownable(msg.sender) {
        require(_usdc != address(0), "invalid usdc");
        usdc = _usdc;
        aavePool = _aavePool;
        balancerVault = _balancerVault;
    }

    function setRiskParameters(
        uint256 _slippageToleranceBps,
        uint256 _minimumProfitThreshold,
        uint256 _maxGasPrice
    ) external onlyOwner {
        require(_slippageToleranceBps <= 500, "slippage too high");
        slippageToleranceBps = _slippageToleranceBps;
        minimumProfitThreshold = _minimumProfitThreshold;
        maxGasPrice = _maxGasPrice;
        emit ConfigurationUpdated(_slippageToleranceBps, _minimumProfitThreshold, _maxGasPrice);
    }

    function setFlashLoanProviders(address _aavePool, address _balancerVault) external onlyOwner {
        aavePool = _aavePool;
        balancerVault = _balancerVault;
    }

    function executeArbitrage(ArbitrageParams calldata params) external onlyOwner nonReentrant {
        require(tx.gasprice <= maxGasPrice, "gas too high");
        require(params.loanAmount > 0, "loan amount zero");
        require(params.steps.length > 1, "insufficient steps");
        require(params.steps[0].tokenIn == params.loanToken, "first step token mismatch");
        require(params.steps[params.steps.length - 1].tokenOut == params.loanToken, "last step token mismatch");

        bytes memory encoded = abi.encode(params, tx.gasprice, block.number);

        emit FlashLoanRequested(params.loanToken, params.loanAmount, params.provider);

        if (params.provider == FlashLoanProvider.AaveV3) {
            IAavePool(aavePool).flashLoanSimple(address(this), params.loanToken, params.loanAmount, encoded, 0);
        } else {
            address[] memory tokens = new address[](1);
            uint256[] memory amounts = new uint256[](1);
            tokens[0] = params.loanToken;
            amounts[0] = params.loanAmount;
            IBalancerVault(balancerVault).flashLoan(address(this), tokens, amounts, encoded);
        }
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == aavePool, "only aave pool");
        require(initiator == address(this), "invalid initiator");
        _runArbitrage(asset, amount, premium, params);
        IERC20(asset).safeIncreaseAllowance(aavePool, amount + premium);
        return true;
    }

    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == balancerVault, "only balancer vault");
        require(tokens.length == 1 && amounts.length == 1 && feeAmounts.length == 1, "single token only");
        _runArbitrage(tokens[0], amounts[0], feeAmounts[0], userData);
        IERC20(tokens[0]).safeTransfer(balancerVault, amounts[0] + feeAmounts[0]);
    }

    function _runArbitrage(address loanToken, uint256 amount, uint256 fee, bytes memory payload) internal {
        (ArbitrageParams memory params, uint256 submittedGasPrice, ) = abi.decode(payload, (ArbitrageParams, uint256, uint256));
        require(params.loanToken == loanToken, "loan token mismatch");
        require(submittedGasPrice <= maxGasPrice, "submitted gas too high");

        uint256 amountCursor = amount;
        for (uint256 i = 0; i < params.steps.length; i++) {
            SwapStep memory step = params.steps[i];
            require(step.minAmountOut > 0, "min out missing");
            require(step.tokenIn != address(0) && step.tokenOut != address(0), "invalid tokens");
            amountCursor = _executeSwap(step, amountCursor);
        }

        uint256 totalDebt = amount + fee;
        uint256 realizedProfit = amountCursor > totalDebt ? amountCursor - totalDebt : 0;
        uint256 minProfit = params.minProfit > minimumProfitThreshold ? params.minProfit : minimumProfitThreshold;

        if (realizedProfit <= minProfit) {
            emit TransactionReverted("profit below threshold");
            revert("profit below threshold");
        }

        emit ArbitrageProfit(loanToken, realizedProfit, realizedProfit, tx.gasprice);
    }

    function _executeSwap(SwapStep memory step, uint256 amountIn) internal returns (uint256 amountOut) {
        if (step.dex == DexType.Uniswap) {
            amountOut = swapOnUniswap(step.routerOrPool, step.tokenIn, step.tokenOut, amountIn, step.minAmountOut);
        } else if (step.dex == DexType.Sushi) {
            amountOut = swapOnSushi(step.routerOrPool, step.tokenIn, step.tokenOut, amountIn, step.minAmountOut);
        } else if (step.dex == DexType.Curve) {
            amountOut = swapOnCurve(step.routerOrPool, amountIn, step.minAmountOut, step.data);
        } else {
            amountOut = swapOnBalancer(step.routerOrPool, step.tokenIn, step.tokenOut, amountIn, step.minAmountOut, step.data);
        }

        emit SwapExecuted(step.dex, step.tokenIn, step.tokenOut, amountIn, amountOut);
    }

    function swapOnUniswap(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) public returns (uint256 amountOut) {
        IERC20(tokenIn).safeIncreaseAllowance(router, amountIn);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint256[] memory amounts = IUniswapV2RouterLike(router).swapExactTokensForTokens(
            amountIn,
            _applySlippage(minAmountOut),
            path,
            address(this),
            block.timestamp
        );
        amountOut = amounts[amounts.length - 1];
    }

    function swapOnSushi(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) public returns (uint256 amountOut) {
        amountOut = swapOnUniswap(router, tokenIn, tokenOut, amountIn, minAmountOut);
    }

    function swapOnCurve(address pool, uint256 amountIn, uint256 minAmountOut, bytes memory data) public returns (uint256 amountOut) {
        (address tokenIn, int128 i, int128 j) = abi.decode(data, (address, int128, int128));
        IERC20(tokenIn).safeIncreaseAllowance(pool, amountIn);
        amountOut = ICurvePoolLike(pool).exchange(i, j, amountIn, _applySlippage(minAmountOut));
    }

    function swapOnBalancer(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes memory data
    ) public returns (uint256 amountOut) {
        bytes32 poolId = abi.decode(data, (bytes32));
        IERC20(tokenIn).safeIncreaseAllowance(pool, amountIn);
        amountOut = IBalancerPoolLike(pool).swap(poolId, 0, tokenIn, tokenOut, amountIn, "");
        require(amountOut >= _applySlippage(minAmountOut), "balancer slippage");
    }

    function _applySlippage(uint256 quotedAmount) internal view returns (uint256) {
        return (quotedAmount * (10_000 - slippageToleranceBps)) / 10_000;
    }

    function rescueToken(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
