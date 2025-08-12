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

import {SafeERC20} from "contracts/dlend/core/dependencies/openzeppelin/contracts/SafeERC20.sol";
import {PercentageMath} from "contracts/dlend/core/protocol/libraries/math/PercentageMath.sol";
import {IPoolAddressesProvider} from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import {IERC20Detailed} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import {IOdosRouterV2} from "contracts/odos/interface/IOdosRouterV2.sol";
import {BaseOdosSwapAdapter} from "./BaseOdosSwapAdapter.sol";
import {OdosSwapUtils} from "contracts/odos/OdosSwapUtils.sol";

/**
 * @title BaseOdosSellAdapter
 * @notice Implements the logic for selling tokens on Odos
 */
abstract contract BaseOdosSellAdapter is BaseOdosSwapAdapter {
    using PercentageMath for uint256;
    using SafeERC20 for IERC20Detailed;

    /// @notice The address of the Odos Router
    IOdosRouterV2 public immutable swapRouter;

    /**
     * @dev Constructor
     * @param addressesProvider The address of the Aave PoolAddressesProvider contract
     * @param pool The address of the Aave Pool contract
     * @param _swapRouter The address of the Odos Router
     */
    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter
    ) BaseOdosSwapAdapter(addressesProvider, pool) {
        swapRouter = _swapRouter;
    }

    /**
     * @dev Swaps a token for another using Odos
     * @param assetToSwapFrom Address of the asset to be swapped from
     * @param assetToSwapTo Address of the asset to be swapped to
     * @param amountToSwap Amount to be swapped
     * @param minAmountToReceive Minimum amount to be received from the swap
     * @param swapData The encoded swap data for Odos
     * @return amountReceived The amount received from the swap
     */
    function _sellOnOdos(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 amountToSwap,
        uint256 minAmountToReceive,
        bytes memory swapData
    ) internal returns (uint256 amountReceived) {
        uint256 balanceBeforeAssetFrom = assetToSwapFrom.balanceOf(
            address(this)
        );
        uint256 balanceBeforeAssetTo = assetToSwapTo.balanceOf(address(this));

        if (balanceBeforeAssetFrom < amountToSwap) {
            revert InsufficientBalanceBeforeSwap(
                balanceBeforeAssetFrom,
                amountToSwap
            );
        }

        address tokenIn = address(assetToSwapFrom);
        address tokenOut = address(assetToSwapTo);

        uint256 amountSpent = OdosSwapUtils.executeSwapOperation(
            swapRouter,
            tokenIn,
            tokenOut,
            amountToSwap,
            minAmountToReceive,
            swapData
        );

        amountReceived =
            assetToSwapTo.balanceOf(address(this)) -
            balanceBeforeAssetTo;

        emit Bought(tokenIn, tokenOut, amountSpent, amountReceived);
    }
}
