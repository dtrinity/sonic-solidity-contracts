// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { OdosSwapLogic } from "contracts/vaults/dloop/periphery/venue/odos/OdosSwapLogic.sol";

contract OdosSwapLogicHarness {
    function callSwapExactOutput(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        bytes calldata swapData,
        IOdosRouterV2 router
    ) external returns (uint256 amountSpent) {
        uint256 inputTokenBalanceBefore = inputToken.balanceOf(address(this));

        OdosSwapLogic.swapExactOutput(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            0,
            swapData,
            router
        );

        uint256 inputTokenBalanceAfter = inputToken.balanceOf(address(this));

        if (inputTokenBalanceAfter < inputTokenBalanceBefore) {
            amountSpent = inputTokenBalanceBefore - inputTokenBalanceAfter;
            if (amountSpent > amountInMaximum) {
                revert("Amount spent exceeds amount in maximum");
            }
        } else {
            amountSpent = 0;
        }
    }
}
