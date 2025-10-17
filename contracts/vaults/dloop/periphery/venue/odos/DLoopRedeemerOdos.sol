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

import { DLoopRedeemerBase, ERC20, IERC3156FlashLender, DLoopCoreBase } from "../../DLoopRedeemerBase.sol";
import { DLoopCoreLogic } from "../../../core/DLoopCoreLogic.sol";
import { OdosSwapLogic, IOdosRouterV2 } from "./OdosSwapLogic.sol";
import { RescuableVault } from "contracts/vaults/dloop/shared/RescuableVault.sol";

/**
 * @title DLoopRedeemerOdos
 * @dev Implementation of DLoopRedeemerBase with Odos swap functionality
 */
contract DLoopRedeemerOdos is DLoopRedeemerBase, RescuableVault {
    IOdosRouterV2 public immutable odosRouter;

    /**
     * @dev Constructor for the DLoopRedeemerOdos contract
     * @param _flashLender Address of the flash loan provider
     * @param _odosRouter Address of the Odos router
     */
    constructor(IERC3156FlashLender _flashLender, IOdosRouterV2 _odosRouter) DLoopRedeemerBase(_flashLender) {
        odosRouter = _odosRouter;
    }

    /* RescuableVault Override */

    /**
     * @dev Gets the restricted rescue tokens
     * @return restrictedTokens Restricted rescue tokens
     */
    function isRescuableToken(address) public view virtual override returns (bool) {
        // No restricted rescue tokens
        return false;
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
     * @dev Estimates the amount of debt token to swap for the flash loan
     *      This method is specific for Odos venue only, as we cannot do exact output swap with Odos wrapper,
     *      thus we can only relies on the quote to make sure the output amount is as expected
     * @param shares Amount of shares to redeem
     * @param dLoopCore Address of the DLoopCore contract
     * @return estimatedRepaidDebtTokenAmount Amount of debt token to swap for the flash loan
     */
    function estimateFlashLoanSwapOutputDebtAmount(
        uint256 shares,
        DLoopCoreBase dLoopCore
    ) public view returns (uint256) {
        uint256 collateralTokenToWithdraw = dLoopCore.previewRedeem(shares);

        // Get the current leverage before repaying the debt (IMPORTANT: this is the leverage before repaying the debt)
        // It is used to calculate the expected withdrawable amount that keeps the current leverage
        uint256 leverageBpsBeforeRepayDebt = dLoopCore.getCurrentLeverageBps();

        ERC20 collateralToken = ERC20(dLoopCore.collateralToken());
        ERC20 debtToken = ERC20(dLoopCore.debtToken());

        // Get the amount of debt token to repay to keep the current leverage
        uint256 estimatedRepaidDebtTokenAmount = DLoopCoreLogic.getRepayAmountThatKeepCurrentLeverage(
            collateralTokenToWithdraw,
            leverageBpsBeforeRepayDebt,
            collateralToken.decimals(),
            dLoopCore.getAssetPriceFromOracle(address(collateralToken)),
            debtToken.decimals(),
            dLoopCore.getAssetPriceFromOracle(address(debtToken))
        );

        return estimatedRepaidDebtTokenAmount;
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
    ) internal override {
        // Do not need to track the spent input token amount, it will be checked in the SwappableVault contract
        OdosSwapLogic.swapExactOutput(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            underlyingToDStableSwapData,
            odosRouter
        );
    }
}
