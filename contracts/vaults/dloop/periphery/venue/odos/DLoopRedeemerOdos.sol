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

import { DLoopRedeemerBase, ERC20, IERC3156FlashLender } from "../../DLoopRedeemerBase.sol";
import { OdosSwapLogic, IOdosRouterV2 } from "./OdosSwapLogic.sol";

/**
 * @title DLoopRedeemerOdos
 * @dev Implementation of DLoopRedeemerBase with Odos swap functionality
 */
contract DLoopRedeemerOdos is DLoopRedeemerBase {
    IOdosRouterV2 public immutable odosRouter;

    /**
     * @dev Constructor for the DLoopRedeemerOdos contract
     * @param _flashLender Address of the flash loan provider
     * @param _odosRouter Address of the Odos router
     */
    constructor(IERC3156FlashLender _flashLender, IOdosRouterV2 _odosRouter) DLoopRedeemerBase(_flashLender) {
        odosRouter = _odosRouter;
    }

    /**
     * @dev The difference tolerance for the swapped output amount
     * @param expectedOutputAmount Expected output amount
     * @return differenceTolerance The difference tolerance amount
     */
    function swappedOutputDifferenceToleranceAmount(
        uint256 expectedOutputAmount
    ) public pure override returns (uint256) {
        return OdosSwapLogic.swappedOutputDifferenceToleranceAmount(expectedOutputAmount);
    }

    /**
     * @dev Swaps an exact amount of output tokens for the minimum input tokens using Odos
     */
    function _swapExactOutputImplementation(
        ERC20 inputToken,
        ERC20 outputToken,
        uint256 amountOut,
        uint256 amountInMaximum,
        address receiver,
        uint256 deadline,
        bytes memory underlyingToDStableSwapData
    ) internal override returns (uint256) {
        // We check the actual spent amount of input token here, as the returned amount from Odos wrapper is not reliable
        uint256 inputTokenBalanceBefore = inputToken.balanceOf(address(this));
        OdosSwapLogic.swapExactOutputWithBreakPoint(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            underlyingToDStableSwapData,
            odosRouter,
            breakPoint
        );
        uint256 inputTokenBalanceAfter = inputToken.balanceOf(address(this));

        if (inputTokenBalanceAfter >= inputTokenBalanceBefore) {
            revert InputTokenBalanceDoesNotDecreaseAfterSwap(inputTokenBalanceBefore, inputTokenBalanceAfter);
        }

        return inputTokenBalanceBefore - inputTokenBalanceAfter;
    }
}
