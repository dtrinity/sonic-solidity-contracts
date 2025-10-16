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
 * @title IOdosWithdrawSwapAdapterV2
 * @notice Interface for the OdosWithdrawSwapAdapterV2 with PT token support
 * @dev V2 interface with PT token functionality via composed swaps
 */
interface IOdosWithdrawSwapAdapterV2 is IBaseOdosAdapterV2 {
    /**
     * @dev Enhanced withdraw swap parameters for V2 with PT support
     * @param oldAsset The asset to withdraw and swap from
     * @param oldAssetAmount The amount to withdraw
     * @param newAsset The asset to swap to (can be PT token)
     * @param minAmountToReceive The minimum amount of new asset to receive
     * @param swapData The swap data (either regular Odos calldata or encoded PTSwapDataV2)
     * @param allBalanceOffset offset to all balance of the user
     */
    struct WithdrawSwapParamsV2 {
        address oldAsset;
        uint256 oldAssetAmount;
        address newAsset;
        uint256 minAmountToReceive;
        bytes swapData;
        uint256 allBalanceOffset;
    }

    /**
     * @notice Withdraws and swaps an asset that is supplied to the Aave Pool with PT token support
     * @param withdrawSwapParams struct describing the withdraw swap
     * @param permitInput optional permit for collateral aToken
     */
    function withdrawAndSwap(WithdrawSwapParamsV2 memory withdrawSwapParams, PermitInput memory permitInput) external;
}
