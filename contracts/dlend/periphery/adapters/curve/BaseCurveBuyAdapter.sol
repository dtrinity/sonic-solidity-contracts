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
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";

/**
 * @title BaseCurveBuyAdapter
 * @notice Implements the logic for buying tokens on Curve
 */
abstract contract BaseCurveBuyAdapter is BaseCurveSwapAdapter {
    using PercentageMath for uint256;
    using SafeERC20 for IERC20Detailed;

    /// @notice The address of the Curve RouterNG
    ICurveRouterNgPoolsOnlyV1 public immutable swapRouter;

    uint16 private constant SLIPPAGE_BUFFER_BPS = 1; // 1/100 of a basis point

    /* Custom Errors */
    error EstimatedAmountExceedsMaximum(uint256 estimated, uint256 maximum);

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        ICurveRouterNgPoolsOnlyV1 _swapRouter
    ) BaseCurveSwapAdapter(addressesProvider, pool) {
        swapRouter = _swapRouter;
    }

    function _buyOnCurve(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 maxAmountToSwap,
        uint256 amountToReceive,
        address[11] memory route,
        uint256[4][5] memory swapParams
    ) internal returns (uint256 amountSold) {
        uint256 balanceBeforeAssetFrom = assetToSwapFrom.balanceOf(
            address(this)
        );
        if (balanceBeforeAssetFrom < maxAmountToSwap) {
            revert InsufficientBalanceBeforeSwap(
                balanceBeforeAssetFrom,
                maxAmountToSwap
            );
        }

        address tokenIn = address(assetToSwapFrom);
        address tokenOut = address(assetToSwapTo);

        // Calculate the required input amount
        uint256 estimatedAmountIn = swapRouter.get_dx(
            route,
            swapParams,
            amountToReceive
        );

        // Add a buffer to account for potential slippage
        amountSold =
            (estimatedAmountIn *
                (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
                    SLIPPAGE_BUFFER_BPS)) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Ensure estimated amount is within limits
        if (amountSold > maxAmountToSwap) {
            revert EstimatedAmountExceedsMaximum(amountSold, maxAmountToSwap);
        }

        // Approve the router to spend our tokens
        assetToSwapFrom.safeApprove(address(swapRouter), amountSold);

        // Execute the swap
        uint256 actualAmountOut = swapRouter.exchange(
            route,
            swapParams,
            amountSold,
            amountToReceive, // This is our minimum expected output
            address(this)
        );

        // Ensure we received the expected amount
        if (actualAmountOut < amountToReceive) {
            revert InsufficientOutputAmount(actualAmountOut, amountToReceive);
        }

        emit Bought(tokenIn, tokenOut, amountSold, actualAmountOut);
    }
}
