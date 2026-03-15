// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

contract MockAavePool {
    using SafeERC20 for IERC20;

    uint256 public feeBps = 9;

    function setFeeBps(uint256 _feeBps) external {
        feeBps = _feeBps;
    }

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16
    ) external {
        uint256 fee = (amount * feeBps) / 10_000;
        IERC20(asset).safeTransfer(receiverAddress, amount);
        bool ok = IReceiver(receiverAddress).executeOperation(asset, amount, fee, receiverAddress, params);
        require(ok, "callback failed");
        IERC20(asset).safeTransferFrom(receiverAddress, address(this), amount + fee);
    }
}
