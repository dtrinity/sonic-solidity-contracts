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
 * @title IOdosWithdrawSwapAdapter
 * @notice Defines the basic interface for OdosWithdrawSwapAdapter
 * @dev Implement this interface to provide functionality of withdrawing from the Aave Pool and swapping to another asset
 **/
interface IOdosWithdrawSwapAdapter is IBaseOdosAdapter {
    struct WithdrawSwapParams {
        address oldAsset; // the asset to withdraw and swap from
        uint256 oldAssetAmount; // the amount to withdraw
        address newAsset; // the asset to swap to
        uint256 minAmountToReceive; // the minimum amount of new asset to receive
        address user; // the address of user
        bytes swapData; // the swap data for Odos
    }

    /**
     * @notice Withdraws and swaps an asset that is supplied to the Aave Pool
     * @param withdrawSwapParams struct describing the withdraw swap
     * @param permitInput optional permit for collateral aToken
     */
    function withdrawAndSwap(
        WithdrawSwapParams memory withdrawSwapParams,
        PermitInput memory permitInput
    ) external;
}
