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

import {IBaseCurveAdapter} from "./IBaseCurveAdapter.sol";

/**
 * @title ICurveRepayAdapter
 * @notice Defines the basic interface for CurveRepayAdapter
 * @dev Implement this interface to provide functionality of repaying debt with collateral
 **/
interface ICurveRepayAdapter is IBaseCurveAdapter {
    struct RepayParams {
        address collateralAsset; // the asset you want to swap collateral from
        uint256 maxCollateralAmountToSwap; // the max amount you want to swap from
        address debtRepayAsset; // the asset you want to repay the debt
        uint256 debtRepayAmount; // the amount of debt to repay
        uint256 debtRepayMode; // debt interest rate mode (1 for stable, 2 for variable)
        bool withFlashLoan; // true if flashloan is needed to repay the debt, otherwise false
        address user; // the address of user
        address[11] route; // the route to swap the collateral asset to the debt asset on Curve
        uint256[4][5] swapParams; // the swap parameters on Curve
    }

    /**
     * @notice Repays with collateral by swapping the collateral asset to debt asset
     * @param repayParams struct describing the repay with collateral swap
     * @param collateralATokenPermit optional permit for collateral aToken
     */
    function repayWithCollateral(
        RepayParams memory repayParams,
        PermitInput memory collateralATokenPermit
    ) external;
}
