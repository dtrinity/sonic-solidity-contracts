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
import {BaseOdosSwapAdapter} from "./BaseOdosSwapAdapter.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {IOdosRouterV2} from "contracts/odos/interface/IOdosRouterV2.sol";
import {OdosSwapUtils} from "contracts/odos/OdosSwapUtils.sol";

/**
 * @title BaseOdosBuyAdapter
 * @notice Implements the logic for buying tokens on Odos
 */
abstract contract BaseOdosBuyAdapter is BaseOdosSwapAdapter {
    using PercentageMath for uint256;
    using SafeERC20 for IERC20Detailed;

    /// @notice The address of the Odos Router
    IOdosRouterV2 public immutable swapRouter;

    uint16 private constant SLIPPAGE_BUFFER_BPS = 1; // 1/100 of a basis point

    /* Custom Errors */
    error EstimatedAmountExceedsMaximum(uint256 estimated, uint256 maximum);

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter
    ) BaseOdosSwapAdapter(addressesProvider, pool) {
        swapRouter = _swapRouter;
    }

    /**
     * @dev Buys a specific amount of output token by spending a maximum amount of input token
     * @param assetToSwapFrom The asset to swap from
     * @param assetToSwapTo The asset to swap to
     * @param maxAmountToSwap The maximum amount to swap
     * @param amountToReceive The amount to receive
     * @param swapData The encoded swap data for Odos
     * @return amountSold The amount of input token sold
     */
    function _buyOnOdos(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 maxAmountToSwap,
        uint256 amountToReceive,
        bytes memory swapData
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

        amountSold = OdosSwapUtils.executeSwapOperation(
            swapRouter,
            tokenIn,
            tokenOut,
            maxAmountToSwap,
            amountToReceive,
            swapData
        );

        emit Bought(tokenIn, tokenOut, amountSold, amountToReceive);
    }
}
