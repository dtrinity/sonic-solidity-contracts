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

import { DLoopDepositorBase, ERC20, IERC3156FlashLender, SharedLogic, DLoopCoreBase } from "../../DLoopDepositorBase.sol";
import { OdosSwapLogic, IOdosRouterV2 } from "./OdosSwapLogic.sol";

/**
 * @title DLoopDepositorOdos
 * @dev Implementation of DLoopDepositorBase with Odos swap functionality
 */
contract DLoopDepositorOdos is DLoopDepositorBase {
    IOdosRouterV2 public immutable odosRouter;
    error InputTokenBalanceDoesNotDecreaseAfterSwap(uint256 inputTokenBalanceBefore, uint256 inputTokenBalanceAfter);
    error LeveragedCollateralAmountLessThanAssets(uint256 leveragedCollateralAmount, uint256 assets);

    /**
     * @dev Constructor for the DLoopDepositorOdos contract
     * @param _flashLender Address of the flash loan provider
     * @param _odosRouter Address of the Odos router
     */
    constructor(IERC3156FlashLender _flashLender, IOdosRouterV2 _odosRouter) DLoopDepositorBase(_flashLender) {
        odosRouter = _odosRouter;
    }

    /**
     * @dev Estimates the amount of collateral token to swap for the flash loan
     *      This method is specific for Odos venue only, as we cannot do exact output swap with Odos wrapper,
     *      thus we can only relies on the quote to make sure the output amount is as expected
     * @param assets Amount of assets
     * @param minOutputShares Minimum output shares
     * @param dLoopCore Address of the DLoopCore contract
     * @return amount Amount of collateral token to swap for the flash loan
     */
    function estimateFlashLoanSwapOutputCollateralAmount(
        uint256 assets,
        uint256 minOutputShares,
        DLoopCoreBase dLoopCore
    ) public view returns (uint256) {
        uint256 leveragedCollateralAmount = SharedLogic.getLeveragedCollateralAmountWithSlippage(
            assets,
            minOutputShares,
            dLoopCore
        );
        if (leveragedCollateralAmount < assets) {
            revert LeveragedCollateralAmountLessThanAssets(leveragedCollateralAmount, assets);
        }
        return leveragedCollateralAmount - assets;
    }

    /**
     * @dev The difference tolerance for the swapped output amount
     * @param expectedOutputAmount Expected output amount
     * @return differenceTolerance The difference tolerance amount
     */
    function swappedOutputDifferenceToleranceAmount(uint256 expectedOutputAmount) public pure override returns (uint256) {
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
        bytes memory dStableToUnderlyingSwapData
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
            dStableToUnderlyingSwapData,
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
