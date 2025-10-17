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

import { DLoopIncreaseLeverageBase, ERC20, IERC3156FlashLender } from "../../DLoopIncreaseLeverageBase.sol";
import { OdosSwapLogic, IOdosRouterV2 } from "./OdosSwapLogic.sol";
import { RescuableVault } from "contracts/vaults/dloop/shared/RescuableVault.sol";

/**
 * @title DLoopIncreaseLeverageOdos
 * @dev Implementation of DLoopIncreaseLeverageBase with Odos swap functionality
 */
contract DLoopIncreaseLeverageOdos is DLoopIncreaseLeverageBase, RescuableVault {
    IOdosRouterV2 public immutable odosRouter;

    /**
     * @dev Constructor for the DLoopIncreaseLeverageOdos contract
     * @param _flashLender Address of the flash loan provider
     * @param _odosRouter Address of the Odos router
     */
    constructor(IERC3156FlashLender _flashLender, IOdosRouterV2 _odosRouter) DLoopIncreaseLeverageBase(_flashLender) {
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
     * @dev Estimates the amount of collateral token to swap for the flash loan (swap from debt token to collateral token)
     *      In this flow, we need to swap from the flashloaned debt tokens to collateral tokens
     * @param rebalanceCollateralAmount The amount of collateral token to rebalance
     * @return amount Amount of collateral token received from the swap
     */
    function estimateFlashLoanSwapOutputCollateralAmount(
        uint256 rebalanceCollateralAmount
    ) public pure returns (uint256) {
        return rebalanceCollateralAmount;
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
        bytes memory debtTokenToCollateralSwapData
    ) internal override {
        // Do not need to track the spent input token amount, it will be checked in the SwappableVault contract
        OdosSwapLogic.swapExactOutput(
            inputToken,
            outputToken,
            amountOut,
            amountInMaximum,
            receiver,
            deadline,
            debtTokenToCollateralSwapData,
            odosRouter
        );
    }
}
