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

import {IBaseOdosAdapterV2} from "./IBaseOdosAdapterV2.sol";

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
    error InsufficientAmountToRepay(
        uint256 amountReceived,
        uint256 amountToRepay
    );

    /**
     * @dev Struct for repay parameters with PT token support
     * @param collateralAsset The address of the collateral asset
     * @param collateralAmount The amount of collateral to swap
     * @param debtAsset The address of the debt asset
     * @param repayAmount The amount of debt to repay
     * @param rateMode The rate mode of the debt (1 = stable, 2 = variable)
     * @param user The address of the user
     * @param minAmountToReceive The minimum amount to receive from the swap
     * @param swapData The encoded swap data (either regular Odos data or PTSwapDataV2)
     */
    struct RepayParamsV2 {
        address collateralAsset;
        uint256 collateralAmount;
        address debtAsset;
        uint256 repayAmount;
        uint256 rateMode;
        address user;
        uint256 minAmountToReceive;
        bytes swapData;
    }

    /**
     * @dev Swaps collateral for another asset and uses that asset to repay a debt
     * @dev Now supports PT tokens through composed Pendle + Odos swaps
     * @param repayParams The parameters of the repay
     * @param permitInput The parameters of the permit signature, to approve collateral aToken
     * @return uint256 The amount repaid
     */
    function swapAndRepay(
        RepayParamsV2 memory repayParams,
        PermitInput memory permitInput
    ) external returns (uint256);
}
