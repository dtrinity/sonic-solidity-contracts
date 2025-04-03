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

import {IBaseOdosAdapter} from "./IBaseOdosAdapter.sol";

/**
 * @title IOdosRepayAdapter
 * @notice Interface for the OdosRepayAdapter
 */
interface IOdosRepayAdapter is IBaseOdosAdapter {
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
     * @dev Struct for repay parameters
     * @param collateralAsset The address of the collateral asset
     * @param collateralAmount The amount of collateral to swap
     * @param debtAsset The address of the debt asset
     * @param repayAmount The amount of debt to repay
     * @param rateMode The rate mode of the debt (1 = stable, 2 = variable)
     * @param user The address of the user
     * @param minAmountToReceive The minimum amount to receive from the swap
     * @param swapData The encoded swap data for Odos
     */
    struct RepayParams {
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
     * @param repayParams The parameters of the repay
     * @param permitInput The parameters of the permit signature, to approve collateral aToken
     * @return uint256 The amount repaid
     */
    function swapAndRepay(
        RepayParams memory repayParams,
        PermitInput memory permitInput
    ) external returns (uint256);
}
