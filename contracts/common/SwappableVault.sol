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

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { Compare } from "contracts/common/Compare.sol";

/**
 * @title SwappableVault
 * @dev Base contract for swap functions
 *      - Need to implement the _swapExactOutputImplementation function
 *      - The wrapper function _swapExactOutput has some sanity checks
 */
abstract contract SwappableVault {
    error SpentInputTokenAmountGreaterThanAmountInMaximum(uint256 spentInputTokenAmount, uint256 amountInMaximum);
    error ReceivedOutputTokenAmountNotEqualAmountOut(uint256 receivedOutputTokenAmount, uint256 amountOut);
    error OutputTokenBalanceNotIncreasedAfterSwap(uint256 outputTokenBalanceBefore, uint256 outputTokenBalanceAfter);

    uint256 public constant BALANCE_DIFF_TOLERANCE = 1;

    /* Virtual functions */

    /**
     * @dev Swaps an exact amount of input assets for as much output assets as possible
     * @param inputToken Input asset
     * @param outputToken Output asset
     * @param amountOut Amount of input assets
     * @param amountInMaximum Minimum amount of output assets (slippage protection)
     * @param receiver Address to receive the output assets
     * @param deadline Deadline for the swap
     * @param extraData Additional data for the swap
     */
    function _swapExactOutputImplementation(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory extraData
    ) internal virtual;

    /**
     * @dev The difference tolerance for the swapped output amount
     * @param expectedOutputAmount Expected output amount
     * @return differenceTolerance The difference tolerance amount
     */
    function swappedOutputDifferenceToleranceAmount(uint256 expectedOutputAmount) public virtual returns (uint256);

    /* Swap functions */

    /**
     * @dev A wrapper function for the _swapExactOutputImplementation function
     *      - Add some sanity checks
     * @param inputToken Input asset
     * @param outputToken Output asset
     * @param amountOut Amount of input assets
     * @param amountInMaximum Minimum amount of output assets (slippage protection)
     * @param receiver Address to receive the output assets
     * @param deadline Deadline for the swap
     * @param extraData Additional data for the swap
     * @return spentInputTokenAmount Amount of input assets used for the swap
     */
    function _swapExactOutput(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory extraData
    ) internal returns (uint256 spentInputTokenAmount) {
        // Track the balances before the swap
        uint256 inputTokenBalanceBefore = inputToken.balanceOf(address(this));
        uint256 outputTokenBalanceBefore = outputToken.balanceOf(address(this));

        // Perform the swap
        _swapExactOutputImplementation(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            extraData
        );

        // Track the balances after the swap
        uint256 inputTokenBalanceAfter = inputToken.balanceOf(address(this));
        uint256 outputTokenBalanceAfter = outputToken.balanceOf(address(this));

        // Input token: ensure the spent amount is not over max and within tolerance of amountIn
        if (inputTokenBalanceAfter < inputTokenBalanceBefore) {
            // Now we know the input token balance decreased after the swap, thus we can calculate the spent amount
            spentInputTokenAmount = inputTokenBalanceBefore - inputTokenBalanceAfter;
            // Slippage protection
            if (spentInputTokenAmount > amountInMaximum) {
                revert SpentInputTokenAmountGreaterThanAmountInMaximum(spentInputTokenAmount, amountInMaximum);
            }
        } else {
            spentInputTokenAmount = 0;
        }

        // Output token: must increase and be within tolerance of amountOut
        {
            uint256 differenceTolerance = swappedOutputDifferenceToleranceAmount(amountOut);

            Compare.BalanceCheckResult memory outCheck = Compare.checkBalanceDelta(
                outputTokenBalanceBefore,
                outputTokenBalanceAfter,
                amountOut,
                BALANCE_DIFF_TOLERANCE + differenceTolerance,
                Compare.BalanceDirection.Increase
            );
            if (!outCheck.directionOk) {
                revert OutputTokenBalanceNotIncreasedAfterSwap(outputTokenBalanceBefore, outputTokenBalanceAfter);
            }
            if (!outCheck.toleranceOk) {
                revert ReceivedOutputTokenAmountNotEqualAmountOut(outCheck.observedDelta, amountOut);
            }
        }

        return spentInputTokenAmount;
    }
}
