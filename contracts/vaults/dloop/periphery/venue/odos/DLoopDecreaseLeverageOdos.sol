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

import { DLoopDecreaseLeverageBase, ERC20, IERC3156FlashLender, DLoopCoreBase } from "../../DLoopDecreaseLeverageBase.sol";
import { OdosSwapLogic, IOdosRouterV2 } from "./OdosSwapLogic.sol";
import { RescuableVault } from "contracts/vaults/dloop/shared/RescuableVault.sol";

/**
 * @title DLoopDecreaseLeverageOdos
 * @dev Implementation of DLoopDecreaseLeverageBase with Odos swap functionality
 */
contract DLoopDecreaseLeverageOdos is DLoopDecreaseLeverageBase, RescuableVault {
    IOdosRouterV2 public immutable odosRouter;

    /**
     * @dev Constructor for the DLoopDecreaseLeverageOdos contract
     * @param _flashLender Address of the flash loan provider
     * @param _odosRouter Address of the Odos router
     */
    constructor(IERC3156FlashLender _flashLender, IOdosRouterV2 _odosRouter) DLoopDecreaseLeverageBase(_flashLender) {
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
     * @dev Estimates the amount of debt token to be repaid for the flash loan (swap from collateral token to debt token)
     * @param rebalanceDebtAmount The amount of debt token to be repaid
     * @param dLoopCore Address of the DLoopCore contract
     * @return amount Amount of debt token to be repaid for the flash loan
     */
    function estimateFlashLoanSwapOutputDebtAmount(
        uint256 rebalanceDebtAmount,
        DLoopCoreBase dLoopCore
    ) public view returns (uint256) {
        ERC20 debtToken = dLoopCore.debtToken();
        uint256 fee = flashLender.flashFee(address(debtToken), rebalanceDebtAmount);
        return rebalanceDebtAmount + fee;
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
        bytes memory collateralToDebtTokenSwapData
    ) internal override {
        // Do not need to track the spent input token amount, it will be checked in the SwappableVault contract
        OdosSwapLogic.swapExactOutput(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            collateralToDebtTokenSwapData,
            odosRouter
        );
    }
}
