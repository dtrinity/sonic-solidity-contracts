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

import {SafeERC20} from "contracts/dlend/periphery/treasury/libs/SafeERC20.sol";
import {PercentageMath} from "contracts/dlend/core/protocol/libraries/math/PercentageMath.sol";
import {IPoolAddressesProvider} from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import {IERC20Detailed} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import {ICurveRouterNgPoolsOnlyV1} from "contracts/dlend/periphery/adapters/curve/interfaces/ICurveRouterNgPoolsOnlyV1.sol";
import {BaseCurveSwapAdapter} from "contracts/dlend/periphery/adapters/curve/BaseCurveSwapAdapter.sol";

/**
 * @title BaseCurveSellAdapter
 * @notice Implements the logic for selling tokens on Curve
 */
abstract contract BaseCurveSellAdapter is BaseCurveSwapAdapter {
    using PercentageMath for uint256;
    using SafeERC20 for IERC20Detailed;

    /// @notice The address of the Curve RouterNG
    ICurveRouterNgPoolsOnlyV1 public immutable swapRouter;

    /**
     * @dev Constructor
     * @param addressesProvider The address of the Aave PoolAddressesProvider contract
     * @param pool The address of the Aave Pool contract
     * @param _swapRouter The address of the Curve RouterNG
     */
    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ICurveRouterNgPoolsOnlyV1 _swapRouter
    ) BaseCurveSwapAdapter(addressesProvider, pool) {
        swapRouter = _swapRouter;
    }

    /**
     * @dev Swaps a token for another using Curve RouterNG
     * @param assetToSwapFrom Address of the asset to be swapped from
     * @param assetToSwapTo Address of the asset to be swapped to
     * @param amountToSwap Amount to be swapped
     * @param minAmountToReceive Minimum amount to be received from the swap
     * @param route Multi-hop path of the swap
     * @param swapParams Swap parameters
     * @return amountReceived The amount received from the swap
     */
    function _sellOnCurve(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 amountToSwap,
        uint256 minAmountToReceive,
        address[11] memory route,
        uint256[4][5] memory swapParams
    ) internal returns (uint256 amountReceived) {
        uint256 balanceBeforeAssetFrom = assetToSwapFrom.balanceOf(
            address(this)
        );
        if (balanceBeforeAssetFrom < amountToSwap) {
            revert InsufficientBalanceBeforeSwap(
                balanceBeforeAssetFrom,
                amountToSwap
            );
        }

        address tokenIn = address(assetToSwapFrom);
        address tokenOut = address(assetToSwapTo);

        // Approve the router to spend our tokens
        assetToSwapFrom.safeApprove(address(swapRouter), amountToSwap);

        // Execute the swap
        amountReceived = swapRouter.exchange(
            route,
            swapParams,
            amountToSwap,
            minAmountToReceive,
            address(this)
        );

        // Ensure we received the minimum expected amount
        if (amountReceived < minAmountToReceive) {
            revert InsufficientOutputAmount(amountReceived, minAmountToReceive);
        }

        emit Bought(tokenIn, tokenOut, amountToSwap, amountReceived);
    }
}
