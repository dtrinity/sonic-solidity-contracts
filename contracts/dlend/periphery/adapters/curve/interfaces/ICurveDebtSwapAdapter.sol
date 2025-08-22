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

import { ICreditDelegationToken } from "contracts/dlend/core/interfaces/ICreditDelegationToken.sol";
import { IBaseCurveAdapter } from "contracts/dlend/periphery/adapters/curve/interfaces/IBaseCurveAdapter.sol";

/**
 * @title ICurveDebtSwapAdapter
 * @notice Defines the basic interface for CurveDebtSwapAdapter
 * @dev Implement this interface to provide functionality of swapping one debt asset to another debt asset
 **/
interface ICurveDebtSwapAdapter is IBaseCurveAdapter {
    struct FlashParams {
        address debtAsset; // the asset to swap debt from
        uint256 debtRepayAmount; // the amount of asset to swap from
        uint256 debtRateMode; // debt interest rate mode (1 for stable, 2 for variable)
        address nestedFlashloanDebtAsset; // 0 if no need of extra collateral. Otherwise internally used for new debt asset
        uint256 nestedFlashloanDebtAmount; // internally used for the amount of new debt asset in case extra collateral
        address user; // the address of user
        address[11] route; // the route to swap the collateral asset to the debt asset on Curve
        uint256[4][5] swapParams; // the swap parameters on Curve
    }

    struct DebtSwapParams {
        address debtAsset; // the asset to repay the debt
        uint256 debtRepayAmount; // the amount of debt to repay
        uint256 debtRateMode; // debt interest rate mode (1 for stable, 2 for variable)
        address newDebtAsset; // the asset of the new debt
        uint256 maxNewDebtAmount; // the maximum amount of asset to swap from
        address extraCollateralAsset; // the asset of extra collateral to use (if needed)
        uint256 extraCollateralAmount; // the amount of extra collateral to use (if needed)
        address[11] route; // the route to swap the collateral asset to the debt asset on Curve
        uint256[4][5] swapParams; // the swap parameters on Curve
    }

    struct CreditDelegationInput {
        ICreditDelegationToken debtToken; // the debt asset to delegate credit for
        uint256 value; // the amount of credit to delegate
        uint256 deadline; // expiration unix timestamp
        uint8 v; // sig v
        bytes32 r; // sig r
        bytes32 s; // sig s
    }

    /**
     * @notice Swaps debt from one asset to another
     * @param debtSwapParams struct describing the debt swap
     * @param creditDelegationPermit optional permit for credit delegation
     * @param collateralATokenPermit optional permit for collateral aToken
     */
    function swapDebt(
        DebtSwapParams memory debtSwapParams,
        CreditDelegationInput memory creditDelegationPermit,
        PermitInput memory collateralATokenPermit
    ) external;
}
