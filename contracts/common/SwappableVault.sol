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

pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title SwappableVault
 * @dev Base contract for swap functions
 *      - Need to implement the _swapExactOutputImplementation function
 *      - The wrapper function _swapExactOutput has some sanity checks
 */
abstract contract SwappableVault {
    error SpentInputTokenAmountGreaterThanAmountInMaximum(
        uint256 spentInputTokenAmount,
        uint256 amountInMaximum
    );
    error ReceivedOutputTokenAmountNotEqualAmountOut(
        uint256 receivedOutputTokenAmount,
        uint256 amountOut
    );
    error OutputTokenBalanceNotIncreasedAfterSwap(
        uint256 outputTokenBalanceBefore,
        uint256 outputTokenBalanceAfter
    );
    error SpentInputTokenAmountNotEqualReturnedAmountIn(
        uint256 spentInputTokenAmount,
        uint256 returnedAmountIn
    );

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
     * @return amountIn Amount of input assets used for the swap
     */
    function _swapExactOutputImplementation(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory extraData
    ) internal virtual returns (uint256);

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
     * @return amountIn Amount of input assets used for the swap
     */
    function _swapExactOutput(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory extraData
    ) internal returns (uint256) {
        uint256 inputTokenBalanceBefore = inputToken.balanceOf(address(this));
        uint256 outputTokenBalanceBefore = outputToken.balanceOf(address(this));

        // Perform the swap
        uint256 amountIn = _swapExactOutputImplementation(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            extraData
        );
        uint256 inputTokenBalanceAfter = inputToken.balanceOf(address(this));
        uint256 outputTokenBalanceAfter = outputToken.balanceOf(address(this));

        // Make sure the spent input token amount is not greater than the amount in maximum
        if (inputTokenBalanceAfter < inputTokenBalanceBefore) {
            uint256 spentInputTokenAmount = inputTokenBalanceBefore -
                inputTokenBalanceAfter;
            if (spentInputTokenAmount > amountInMaximum) {
                revert SpentInputTokenAmountGreaterThanAmountInMaximum(
                    spentInputTokenAmount,
                    amountInMaximum
                );
            }

            if (spentInputTokenAmount > amountInMaximum) {
                if (spentInputTokenAmount - amountInMaximum > BALANCE_DIFF_TOLERANCE) {
                    revert SpentInputTokenAmountNotEqualReturnedAmountIn(
                        spentInputTokenAmount,
                        amountIn
                    );
                }
            } else {
                if (amountIn - spentInputTokenAmount > BALANCE_DIFF_TOLERANCE) {
                    revert SpentInputTokenAmountNotEqualReturnedAmountIn(
                        spentInputTokenAmount,
                        amountIn
                    );
                }
            }
        }
        // Do not need to check the input token balance decreased after the swap
        // as it is not a risk for the caller

        // Make sure the received output token amount is exactly the amount out
        if (outputTokenBalanceAfter > outputTokenBalanceBefore) {
            uint256 receivedOutputTokenAmount = outputTokenBalanceAfter -
                outputTokenBalanceBefore;
            if (receivedOutputTokenAmount != amountOut) {
                revert ReceivedOutputTokenAmountNotEqualAmountOut(
                    receivedOutputTokenAmount,
                    amountOut
                );
            }
        } else {
            revert OutputTokenBalanceNotIncreasedAfterSwap(
                outputTokenBalanceBefore,
                outputTokenBalanceAfter
            );
        }

        return amountIn;
    }
}
