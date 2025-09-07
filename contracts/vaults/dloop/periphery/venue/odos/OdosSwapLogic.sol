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
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { OdosSwapUtils as OdosSwapUtilsDebug } from "contracts/odos/OdosSwapUtilsDebug.sol";

struct SwapExactOutputVariables {
    uint256 balanceBefore;
    uint256 balanceAfter;
    uint256 amountSpent;
    uint256 actualReceived;
    uint256 surplus;
}

/**
 * @title OdosSwapLogic
 * @dev Library for common Odos swap functions used in dLOOP contracts
 */
library OdosSwapLogic {
    using SafeERC20 for ERC20;

    uint256 public constant DIFFERENCE_TOLERANCE_BPS = BasisPointConstants.ONE_PERCENT_BPS;

    /**
     * @dev The difference tolerance for the swapped output amount
     * @param expectedOutputAmount Expected output amount
     * @return differenceTolerance The difference tolerance amount
     */
    function swappedOutputDifferenceToleranceAmount(uint256 expectedOutputAmount) internal pure returns (uint256) {
        return expectedOutputAmount * DIFFERENCE_TOLERANCE_BPS / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
    }

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
    function _swapExactOutputWithBreakPoint(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256, // deadline, not used in Odos
        bytes memory swapData,
        IOdosRouterV2 odosRouter,
        uint256 breakPoint
    ) internal returns (uint256) {
        SwapExactOutputVariables memory vars;

        // Measure the contract’s balance, not the receiver’s, because Odos router sends the
        // output tokens to the caller (i.e. this contract). We refund any surplus afterwards.
        vars.balanceBefore = ERC20(outputToken).balanceOf(address(this));

        require(breakPoint != 60001, "60001");

        // Use the OdosSwapUtils library to execute the swap
        vars.amountSpent = OdosSwapUtilsDebug.executeSwapOperationWithBreakPoint(
            odosRouter,
            address(inputToken),
            address(outputToken),
            amountInMaximum,
            amountOut,
            swapData,
            breakPoint
        );

        require(breakPoint != 60002, "60002");
    
        {
            vars.balanceAfter = ERC20(outputToken).balanceOf(address(this));
            vars.actualReceived = vars.balanceAfter - vars.balanceBefore;

            // Safety check – OdosSwapUtils should already revert if insufficient, but double-check.
            if (vars.actualReceived < amountOut) {
                revert("INSUFFICIENT_OUTPUT");
            }

            vars.surplus = vars.actualReceived - amountOut;

            // Transfer surplus to receiver when receiver is not this contract and surplus exists
            if (vars.surplus > 0 && receiver != address(this)) {
                ERC20(outputToken).safeTransfer(receiver, vars.surplus);
            }
        }

        return vars.amountSpent;
    }

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
        uint256 deadline, // deadline, not used in Odos
        bytes memory swapData,
        IOdosRouterV2 odosRouter
    ) external returns (uint256) {
        return _swapExactOutputWithBreakPoint(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            swapData,
            odosRouter,
            0
        );
    }

    function swapExactOutputWithBreakPoint(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory swapData,
        IOdosRouterV2 odosRouter,
        uint256 breakPoint
    ) external returns (uint256) {
        return _swapExactOutputWithBreakPoint(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            swapData,
            odosRouter,
            breakPoint
        );
    }
}
