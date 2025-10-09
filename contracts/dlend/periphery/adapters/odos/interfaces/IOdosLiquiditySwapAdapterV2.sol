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

import { IBaseOdosAdapterV2 } from "./IBaseOdosAdapterV2.sol";

/**
 * @title IOdosLiquiditySwapAdapterV2
 * @notice Defines the basic interface for OdosLiquiditySwapAdapterV2 with PT token support
 * @dev Implement this interface to provide functionality of swapping one collateral asset to another collateral asset
 **/
interface IOdosLiquiditySwapAdapterV2 is IBaseOdosAdapterV2 {
    /**
     * @dev Struct for liquidity swap parameters with PT token support
     * @param collateralAsset the asset to swap collateral from
     * @param collateralAmountToSwap the amount of asset to swap from
     * @param newCollateralAsset the asset to swap collateral to
     * @param newCollateralAmount the minimum amount of new collateral asset to receive
     * @param withFlashLoan true if flashloan is needed to swap collateral, otherwise false
     * @param swapData the encoded swap data (either regular Odos data or PTSwapDataV2)
     * @param allBalanceOffset offset to all balance of the user
     */
    struct LiquiditySwapParamsV2 {
        address collateralAsset;
        uint256 collateralAmountToSwap;
        address newCollateralAsset;
        uint256 newCollateralAmount;
        bool withFlashLoan;
        bytes swapData;
        uint256 allBalanceOffset;
    }

    /**
     * @dev Internal struct for flash loan parameters
     * @param liquiditySwapParams The liquidity swap parameters
     * @param collateralATokenPermit The collateral aToken permit
     * @param user The address of the user initiating the swap
     */
    struct FlashParamsV2 {
        LiquiditySwapParamsV2 liquiditySwapParams;
        PermitInput collateralATokenPermit;
        address user;
    }

    /**
     * @notice Swaps liquidity(collateral) from one asset to another
     * @dev Now supports PT tokens through composed Pendle + Odos swaps
     * @param liquiditySwapParams struct describing the liquidity swap
     * @param collateralATokenPermit optional permit for collateral aToken
     */
    function swapLiquidity(
        LiquiditySwapParamsV2 memory liquiditySwapParams,
        PermitInput memory collateralATokenPermit
    ) external;
}
