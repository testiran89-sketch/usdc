// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockUniswapRouter {
    using SafeERC20 for IERC20;

    uint256 public multiplierBps = 10_100;

    function setMultiplierBps(uint256 bps) external {
        multiplierBps = bps;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = (amountIn * multiplierBps) / 10_000;
        require(amountOut >= amountOutMin, "min out");
        IERC20(path[1]).safeTransfer(to, amountOut);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }
}
