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
    error SpentInputTokenAmountNotEqualReturnedAmountIn(uint256 spentInputTokenAmount, uint256 returnedAmountIn);

    uint256 public constant BALANCE_DIFF_TOLERANCE = 1;

    uint256 public breakPoint2;

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

        require(breakPoint2 != 40001, string.concat("40001: amountOut:", uint256ToString(amountOut)));

        setBreakPoint2(breakPoint2);

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

        require(breakPoint2 != 40002, "40002");

        uint256 inputTokenBalanceAfter = inputToken.balanceOf(address(this));
        uint256 outputTokenBalanceAfter = outputToken.balanceOf(address(this));

        // Input token: if decreased, ensure not over max and within tolerance of amountIn
        {
            require(breakPoint2 != 40003, "40003");
            Compare.BalanceCheckResult memory inCheck = Compare.checkBalanceDelta(
                inputTokenBalanceBefore,
                inputTokenBalanceAfter,
                amountIn,
                BALANCE_DIFF_TOLERANCE,
                Compare.BalanceDirection.Decrease
            );
            require(breakPoint2 != 40004, "40004");
            if (inCheck.directionOk) {
                // First check: ensure we don't spend more than the maximum allowed
                if (inCheck.observedDelta > amountInMaximum) {
                    revert SpentInputTokenAmountGreaterThanAmountInMaximum(inCheck.observedDelta, amountInMaximum);
                }
                require(breakPoint2 != 40005, string.concat("40005: amountIn:", uint256ToString(amountIn),",amountInMaximum:", uint256ToString(amountInMaximum),",observedDelta:", uint256ToString(inCheck.observedDelta), "BALANCE_DIFF_TOLERANCE:", uint256ToString(BALANCE_DIFF_TOLERANCE),",inputTokenBalanceBefore:", uint256ToString(inputTokenBalanceBefore),",inputTokenBalanceAfter:", uint256ToString(inputTokenBalanceAfter)));
                // Second check: ensure spent amount matches returned amount within tolerance
                if (!inCheck.toleranceOk) {
                    revert SpentInputTokenAmountNotEqualReturnedAmountIn(inCheck.observedDelta, amountIn);
                }
            }
            require(breakPoint2 != 40006, "40006");
            // If not decreased, no checks needed (not a risk for the caller)
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
            require(breakPoint2 != 40008, "40008");
            if (!outCheck.directionOk) {
                revert OutputTokenBalanceNotIncreasedAfterSwap(outputTokenBalanceBefore, outputTokenBalanceAfter);
            }
            require(breakPoint2 != 40009, string.concat("40009: amountOut:", uint256ToString(amountOut),",observedDelta:", uint256ToString(outCheck.observedDelta),",BALANCE_DIFF_TOLERANCE:", uint256ToString(BALANCE_DIFF_TOLERANCE),",outputTokenBalanceBefore:", uint256ToString(outputTokenBalanceBefore),",outputTokenBalanceAfter:", uint256ToString(outputTokenBalanceAfter),",inDelta:", uint256ToString(inputTokenBalanceBefore - inputTokenBalanceAfter)));
            if (!outCheck.toleranceOk) {
                revert ReceivedOutputTokenAmountNotEqualAmountOut(outCheck.observedDelta, amountOut);
            }
            require(breakPoint2 != 40010, "40010");
        }

        return amountIn;
    }

    function uint256ToString(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }
        uint256 j = _i;
        uint256 length;
        while (j != 0) {
            length++;
            j /= 10;
        }

        bytes memory bstr = new bytes(length);
        uint256 k = length;
        j = _i;
        while (j != 0) {
            bstr[--k] = bytes1(uint8(48 + (j % 10)));
            j /= 10;
        }
        return string(bstr);
    }

    function setBreakPoint2(uint256 _breakPoint2) public {
        breakPoint2 = _breakPoint2;
    }
}
