// SPDX-License-Identifier: AGPL-3.0
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

import { IBaseOdosAdapterV2 } from "./IBaseOdosAdapterV2.sol";

/**
 * @title IOdosRepayAdapterV2
 * @notice Interface for the OdosRepayAdapterV2 with PT token support
 */
interface IOdosRepayAdapterV2 is IBaseOdosAdapterV2 {
    /**
     * @dev Custom error for insufficient amount to repay
     * @param amountReceived The amount received from the swap
     * @param amountToRepay The amount needed to repay
     */
    error InsufficientAmountToRepay(uint256 amountReceived, uint256 amountToRepay);

    /**
     * @dev Struct for repay parameters with PT token support
     * @param collateralAsset The address of the collateral asset
     * @param collateralAmount The amount of collateral to swap
     * @param debtAsset The address of the debt asset
     * @param repayAmount The amount of debt to repay
     * @param rateMode The rate mode of the debt (1 = stable, 2 = variable)
     * @param withFlashLoan true if flashloan is needed to repay the debt, otherwise false
     * @param minAmountToReceive The minimum amount to receive from the swap
     * @param swapData The encoded swap data (either regular Odos data or PTSwapDataV2)
     * @param allBalanceOffset offset to all balance of the user
     */
    struct RepayParamsV2 {
        address collateralAsset;
        uint256 collateralAmount;
        address debtAsset;
        uint256 repayAmount;
        uint256 rateMode;
        bool withFlashLoan;
        uint256 minAmountToReceive;
        bytes swapData;
        uint256 allBalanceOffset;
    }

    /**
     * @notice Repays with collateral by swapping the collateral asset to debt asset
     * @param repayParams struct describing the repay with collateral swap
     * @param collateralATokenPermit optional permit for collateral aToken
     */
    function repayWithCollateral(RepayParamsV2 memory repayParams, PermitInput memory collateralATokenPermit) external;
}
