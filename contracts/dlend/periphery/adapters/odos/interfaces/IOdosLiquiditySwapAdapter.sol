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

import {IBaseOdosAdapter} from "./IBaseOdosAdapter.sol";

/**
 * @title IOdosLiquiditySwapAdapter
 * @notice Defines the basic interface for CurveLiquiditySwapAdapter
 * @dev Implement this interface to provide functionality of swapping one collateral asset to another collateral asset
 **/
interface IOdosLiquiditySwapAdapter is IBaseOdosAdapter {
    struct LiquiditySwapParams {
        address collateralAsset; // the asset to swap collateral from
        uint256 collateralAmountToSwap; // the amount of asset to swap from
        address newCollateralAsset; // the asset to swap collateral to
        uint256 newCollateralAmount; // the minimum amount of new collateral asset to receive
        address user; // the address of user
        bool withFlashLoan; // true if flashloan is needed to swap collateral, otherwise false
        bytes swapData; // the encoded swap data for Odos
    }

    /**
     * @notice Swaps liquidity(collateral) from one asset to another
     * @param liquiditySwapParams struct describing the liquidity swap
     * @param collateralATokenPermit optional permit for collateral aToken
     */
    function swapLiquidity(
        LiquiditySwapParams memory liquiditySwapParams,
        PermitInput memory collateralATokenPermit
    ) external;
}
