// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAaveV3PoolAddressesProvider} from "./interfaces/IAaveV3PoolAddressesProvider.sol";
import {IAaveV3Pool} from "./interfaces/IAaveV3Pool.sol";
import {IAaveV3FlashLoanSimpleReceiver} from "./interfaces/IAaveV3FlashLoanSimpleReceiver.sol";

interface IERC20Minimal {
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract FlashLoanArbitrage is IAaveV3FlashLoanSimpleReceiver {
    address public constant ARBITRUM_AAVE_V3_ADDRESSES_PROVIDER = 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb;

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
    address public owner;
    address public executor;
    address private _pendingOwner;
    bool public paused;
    uint256 private _locked;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event ArbitrageRequested(address indexed caller, address indexed asset, uint256 amount, uint256 minProfit);
    event ArbitrageExecuted(address indexed asset, uint256 amount, uint256 premium, uint256 profit);
    event EmergencyTokenRecovered(address indexed token, address indexed to, uint256 amount);
    event EmergencyEtherRecovered(address indexed to, uint256 amount);

    error AlreadyPaused();
    error CallToNonContract(address target);
    error NewOwnerIsZeroAddress();
    error NotAuthorized();
    error NotOwner();
    error NotPendingOwner();
    error InvalidArrayLengths();
    error InvalidFlashLoanCaller();
    error InvalidInitiator();
    error InsufficientProfit(uint256 available, uint256 required);
    error ExternalCallFailed(address target, bytes returndata);
    error Reentrancy();
    error SafeTransferFailed(address token, address to, uint256 amount);
    error SafeApproveFailed(address token, address spender, uint256 amount);
    error ZeroAddressNotAllowed();

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != executor) {
            revert NotAuthorized();
        }
        _;
    }

    modifier whenNotPaused() {
        if (paused) {
            revert AlreadyPaused();
        }
        _;
    }

    modifier nonReentrant() {
        if (_locked == 1) {
            revert Reentrancy();
        }
        _locked = 1;
        _;
        _locked = 0;
    }

    constructor() {
        owner = msg.sender;
        executor = msg.sender;
        addressesProvider = IAaveV3PoolAddressesProvider(ARBITRUM_AAVE_V3_ADDRESSES_PROVIDER);
        pool = IAaveV3Pool(addressesProvider.getPool());
        emit OwnershipTransferred(address(0), msg.sender);
    }

    receive() external payable {}

    function pendingOwner() external view returns (address) {
        return _pendingOwner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert NewOwnerIsZeroAddress();
        }
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != _pendingOwner) {
            revert NotPendingOwner();
        }
        address previousOwner = owner;
        owner = msg.sender;
        _pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    function pause() external onlyOwner {
        if (paused) {
            revert AlreadyPaused();
        }
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
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
        for (uint256 index = 0; index < params.approvalTokens.length; ++index) {
            _ensureAllowance(
                params.approvalTokens[index],
                params.approvalSpenders[index],
                params.approvalAmounts[index]
            );
        }

        for (uint256 index = 0; index < params.calls.length; ++index) {
            ExternalCall memory currentCall = params.calls[index];
            if (currentCall.target.code.length == 0) {
                revert CallToNonContract(currentCall.target);
            }
            (bool success, bytes memory returndata) = currentCall.target.call{value: currentCall.value}(currentCall.data);
            if (!success) {
                revert ExternalCallFailed(currentCall.target, returndata);
            }
        }

        uint256 repayment = amount + premium;
        uint256 finalBalance = IERC20Minimal(asset).balanceOf(address(this));
        uint256 requiredBalance = repayment + params.minProfit;
        if (finalBalance < requiredBalance) {
            revert InsufficientProfit(finalBalance, requiredBalance);
        }

        uint256 profit = finalBalance - repayment;
        _forceApprove(asset, address(pool), repayment);

        if (profit > 0) {
            _safeTransfer(asset, params.profitReceiver, profit);
        }

        emit ArbitrageExecuted(asset, amount, premium, profit);
        return true;
    }

    function recoverToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        _safeTransfer(token, to, amount);
        emit EmergencyTokenRecovered(token, to, amount);
    }

    function recoverEther(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        (bool success,) = to.call{value: amount}("");
        require(success, "ETH_TRANSFER_FAILED");
        emit EmergencyEtherRecovered(to, amount);
    }

    function _ensureAllowance(address token, address spender, uint256 minimumAmount) internal {
        if (IERC20Minimal(token).allowance(address(this), spender) >= minimumAmount) {
            return;
        }

        _forceApprove(token, spender, type(uint256).max);
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        if (!_callOptionalReturn(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)))) {
            if (!_callOptionalReturn(token, abi.encodeCall(IERC20Minimal.approve, (spender, 0)))) {
                revert SafeApproveFailed(token, spender, 0);
            }
            if (!_callOptionalReturn(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)))) {
                revert SafeApproveFailed(token, spender, amount);
            }
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (!_callOptionalReturn(token, abi.encodeCall(IERC20Minimal.transfer, (to, amount)))) {
            revert SafeTransferFailed(token, to, amount);
        }
    }

    function _callOptionalReturn(address token, bytes memory data) internal returns (bool) {
        (bool success, bytes memory returndata) = token.call(data);
        if (!success) {
            return false;
        }
        if (returndata.length == 0) {
            return true;
        }
        return abi.decode(returndata, (bool));
    }
}
