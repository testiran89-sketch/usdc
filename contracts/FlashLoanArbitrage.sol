// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAaveV3PoolAddressesProvider} from "./interfaces/IAaveV3PoolAddressesProvider.sol";
import {IAaveV3Pool} from "./interfaces/IAaveV3Pool.sol";
import {IAaveV3FlashLoanSimpleReceiver} from "./interfaces/IAaveV3FlashLoanSimpleReceiver.sol";

contract FlashLoanArbitrage is Ownable2Step, Pausable, ReentrancyGuard, IAaveV3FlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    struct ExternalCall {
        address target;
        uint256 value;
        bytes data;
    }

    struct FlashLoanParams {
        address asset;
        uint256 amount;
        uint256 minProfit;
        address profitReceiver;
        address[] approvalTokens;
        address[] approvalSpenders;
        uint256[] approvalAmounts;
        ExternalCall[] calls;
    }

    IAaveV3PoolAddressesProvider public immutable addressesProvider;
    IAaveV3Pool public immutable pool;
    address public executor;

    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event ArbitrageRequested(address indexed caller, address indexed asset, uint256 amount, uint256 minProfit);
    event ArbitrageExecuted(address indexed asset, uint256 amount, uint256 premium, uint256 profit);
    event EmergencyTokenRecovered(address indexed token, address indexed to, uint256 amount);
    event EmergencyEtherRecovered(address indexed to, uint256 amount);

    error NotAuthorized();
    error InvalidArrayLengths();
    error InvalidFlashLoanCaller();
    error InvalidInitiator();
    error InsufficientProfit(uint256 available, uint256 required);
    error ExternalCallFailed(address target, bytes returndata);

    modifier onlyAuthorized() {
        if (msg.sender != owner() && msg.sender != executor) {
            revert NotAuthorized();
        }
        _;
    }

    constructor(address provider, address initialOwner, address initialExecutor) Ownable(initialOwner) {
        addressesProvider = IAaveV3PoolAddressesProvider(provider);
        pool = IAaveV3Pool(addressesProvider.getPool());
        executor = initialExecutor;
    }

    receive() external payable {}

    function setExecutor(address newExecutor) external onlyOwner {
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function requestArbitrage(FlashLoanParams calldata params)
        external
        whenNotPaused
        nonReentrant
        onlyAuthorized
    {
        if (
            params.approvalTokens.length != params.approvalSpenders.length
                || params.approvalTokens.length != params.approvalAmounts.length
        ) {
            revert InvalidArrayLengths();
        }

        emit ArbitrageRequested(msg.sender, params.asset, params.amount, params.minProfit);
        pool.flashLoanSimple(address(this), params.asset, params.amount, abi.encode(params), 0);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata paramsData
    ) external override whenNotPaused returns (bool) {
        if (msg.sender != address(pool)) {
            revert InvalidFlashLoanCaller();
        }
        if (initiator != address(this)) {
            revert InvalidInitiator();
        }

        FlashLoanParams memory params = abi.decode(paramsData, (FlashLoanParams));
        uint256 initialBalance = IERC20(asset).balanceOf(address(this));

        for (uint256 index = 0; index < params.approvalTokens.length; ++index) {
            _ensureAllowance(
                params.approvalTokens[index],
                params.approvalSpenders[index],
                params.approvalAmounts[index]
            );
        }

        for (uint256 index = 0; index < params.calls.length; ++index) {
            ExternalCall memory currentCall = params.calls[index];
            (bool success, bytes memory returndata) = currentCall.target.call{value: currentCall.value}(currentCall.data);
            if (!success) {
                revert ExternalCallFailed(currentCall.target, returndata);
            }
        }

        uint256 repayment = amount + premium;
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        uint256 requiredBalance = repayment + params.minProfit;
        if (finalBalance < requiredBalance) {
            revert InsufficientProfit(finalBalance, requiredBalance);
        }

        uint256 profit = finalBalance - repayment;
        IERC20(asset).forceApprove(address(pool), 0);
        IERC20(asset).forceApprove(address(pool), repayment);

        if (profit > 0) {
            IERC20(asset).safeTransfer(params.profitReceiver, profit);
        }

        emit ArbitrageExecuted(asset, amount, premium, profit);
        initialBalance;
        return true;
    }

    function recoverToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyTokenRecovered(token, to, amount);
    }

    function recoverEther(address payable to, uint256 amount) external onlyOwner {
        (bool success,) = to.call{value: amount}("");
        require(success, "ETH_TRANSFER_FAILED");
        emit EmergencyEtherRecovered(to, amount);
    }

    function _ensureAllowance(address token, address spender, uint256 minimumAmount) internal {
        if (IERC20(token).allowance(address(this), spender) >= minimumAmount) {
            return;
        }

        IERC20(token).forceApprove(spender, 0);
        IERC20(token).forceApprove(spender, type(uint256).max);
    }
}
