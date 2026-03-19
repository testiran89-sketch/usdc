// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAaveV3FlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}
