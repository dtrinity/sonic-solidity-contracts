// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { ERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { OdosSwapUtils } from "contracts/odos/OdosSwapUtils.sol";

/**
 * @title OdosSwapLogic
 * @dev Library for common Odos swap functions used in dLOOP contracts
 */
library OdosSwapLogic {
    using SafeERC20 for ERC20;

    /**
     * @dev Swaps an exact amount of output tokens for input tokens using Odos router
     * @param inputToken Input token to be swapped
     * @param outputToken Output token to receive (used for validating the swap direction)
     * @param amountOut Exact amount of output tokens to receive
     * @param amountInMaximum Maximum amount of input tokens to spend
     * @param receiver Address to receive the output tokens (not used directly in Odos, but kept for interface consistency)
     * @param swapData Encoded swap data for Odos router
     * @param odosRouter Odos router instance
     * @return uint256 Amount of input tokens used
     */
    function swapExactOutput(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256, // deadline, not used in Odos
        bytes memory swapData,
        IOdosRouterV2 odosRouter
    ) external returns (uint256) {
        // Measure the contract’s balance, not the receiver’s, because Odos router sends the
        // output tokens to the caller (i.e. this contract). We refund any surplus afterwards.
        uint256 balanceBefore = ERC20(outputToken).balanceOf(address(this));

        // Use the OdosSwapUtils library to execute the swap
        uint256 amountSpent = OdosSwapUtils.executeSwapOperation(
            odosRouter,
            address(inputToken),
            address(outputToken),
            amountInMaximum,
            amountOut,
            swapData
        );

        uint256 balanceAfter = ERC20(outputToken).balanceOf(address(this));

        uint256 actualReceived = balanceAfter - balanceBefore;

        // Safety check – OdosSwapUtils should already revert if insufficient, but double-check.
        if (actualReceived < amountOut) {
            revert("INSUFFICIENT_OUTPUT");
        }

        uint256 surplus = actualReceived - amountOut;

        // Transfer surplus to receiver when receiver is not this contract and surplus exists
        if (surplus > 0 && receiver != address(this)) {
            ERC20(outputToken).safeTransfer(receiver, surplus);
        }

        return amountSpent;
    }
}
