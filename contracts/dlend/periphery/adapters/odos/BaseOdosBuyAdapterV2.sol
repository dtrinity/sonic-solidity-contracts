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

import {IERC20Detailed} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import {IPoolAddressesProvider} from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import {IOdosRouterV2} from "contracts/odos/interface/IOdosRouterV2.sol";
import {BaseOdosBuyAdapter} from "./BaseOdosBuyAdapter.sol";
import {IBaseOdosAdapterV2} from "./interfaces/IBaseOdosAdapterV2.sol";
import {OdosSwapUtils} from "contracts/odos/OdosSwapUtils.sol";
import {PTSwapUtils} from "./PTSwapUtils.sol";
import {ISwapTypes} from "./interfaces/ISwapTypes.sol";

/**
 * @title BaseOdosBuyAdapterV2
 * @notice Implements the logic for buying tokens on Odos with PT token support
 * @dev Extends BaseOdosBuyAdapter with PT token functionality
 */
abstract contract BaseOdosBuyAdapterV2 is BaseOdosBuyAdapter, IBaseOdosAdapterV2 {
    /// @notice The address of the Pendle Router
    address public immutable pendleRouter;

    /// @notice Error for invalid swap data
    error InvalidSwapData();

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter,
        address _pendleRouter
    ) BaseOdosBuyAdapter(addressesProvider, pool, _swapRouter) {
        pendleRouter = _pendleRouter;
    }



    /**
     * @dev Override _buyOnOdos to support PT tokens
     * @dev Routes to PT-aware logic or calls parent implementation
     */
    function _buyOnOdos(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 maxAmountToSwap,
        uint256 amountToReceive,
        bytes memory swapData
    ) internal override returns (uint256 amountSold) {
        address tokenIn = address(assetToSwapFrom);
        address tokenOut = address(assetToSwapTo);
        
        // Check swap type using PTSwapUtils
        ISwapTypes.SwapType swapType = PTSwapUtils.determineSwapType(tokenIn, tokenOut);

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular swap - call parent implementation
            return super._buyOnOdos(assetToSwapFrom, assetToSwapTo, maxAmountToSwap, amountToReceive, swapData);
        }

        // PT token involved - use composed swap logic
        uint256 balanceBeforeAssetFrom = assetToSwapFrom.balanceOf(address(this));
        if (balanceBeforeAssetFrom < maxAmountToSwap) {
            revert InsufficientBalanceBeforeSwap(
                balanceBeforeAssetFrom,
                maxAmountToSwap
            );
        }

        // Execute PT-aware swap using PTSwapUtils
        uint256 actualAmountOut = _executeSwapExactOutput(
            tokenIn,
            tokenOut,
            maxAmountToSwap,
            amountToReceive,
            swapData
        );

        // Calculate the actual amount sold based on balance difference
        amountSold = balanceBeforeAssetFrom - assetToSwapFrom.balanceOf(address(this));

        emit Bought(tokenIn, tokenOut, amountSold, actualAmountOut);
        return amountSold;
    }

    /**
     * @dev Executes exact output swap with PT token support
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param maxInputAmount The maximum amount of input tokens to spend
     * @param exactOutputAmount The exact amount of output tokens required
     * @param swapData The swap data (either regular Odos or PTSwapDataV2)
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeSwapExactOutput(
        address inputToken,
        address outputToken,
        uint256 maxInputAmount,
        uint256 exactOutputAmount,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Use PTSwapUtils to determine swap strategy and execute
        ISwapTypes.SwapType swapType = PTSwapUtils.determineSwapType(inputToken, outputToken);

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular swap - swapData should be raw Odos calldata
            return _executeOdosExactOutput(
                inputToken,
                outputToken,
                maxInputAmount,
                exactOutputAmount,
                swapData
            );
        }

        // PT token involved - decode PTSwapDataV2 and use PTSwapUtils
        PTSwapUtils.PTSwapDataV2 memory ptSwapData = abi.decode(swapData, (PTSwapUtils.PTSwapDataV2));
        
        if (!PTSwapUtils.validatePTSwapData(ptSwapData)) {
            revert InvalidSwapData();
        }

        if (swapType == ISwapTypes.SwapType.PT_TO_REGULAR) {
            // PT -> regular token
            return PTSwapUtils.executePTToTargetSwap(
                inputToken,
                outputToken,
                maxInputAmount,
                exactOutputAmount,
                pendleRouter,
                swapRouter,
                ptSwapData
            );
        } else if (swapType == ISwapTypes.SwapType.REGULAR_TO_PT) {
            // Regular token -> PT
            return PTSwapUtils.executeSourceToPTSwap(
                inputToken,
                outputToken,
                maxInputAmount,
                exactOutputAmount,
                pendleRouter,
                swapRouter,
                ptSwapData
            );
        } else if (swapType == ISwapTypes.SwapType.PT_TO_PT) {
            // PT -> PT (direct Pendle swap)
            return PTSwapUtils.executePTToPTSwap(
                inputToken,
                outputToken,
                maxInputAmount,
                exactOutputAmount,
                pendleRouter,
                ptSwapData
            );
        } else {
            revert InvalidSwapData(); // Should never reach here
        }
    }

    /**
     * @dev Executes exact output Odos swap
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param maxInputAmount The maximum amount of input tokens to spend
     * @param exactOutputAmount The exact amount of output tokens required
     * @param swapData The Odos swap data
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeOdosExactOutput(
        address inputToken,
        address outputToken,
        uint256 maxInputAmount,
        uint256 exactOutputAmount,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Execute Odos swap using OdosSwapUtils
        actualOutputAmount = OdosSwapUtils.executeSwapOperation(
            swapRouter,
            inputToken,
            outputToken,
            maxInputAmount,
            exactOutputAmount,
            swapData
        );

        return actualOutputAmount;
    }
}
