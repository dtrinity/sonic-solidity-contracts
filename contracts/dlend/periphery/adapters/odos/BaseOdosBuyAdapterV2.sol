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

import { IERC20Detailed } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20Detailed.sol";
import { IPoolAddressesProvider } from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { BaseOdosSwapAdapter } from "./BaseOdosSwapAdapter.sol";
import { IBaseOdosAdapterV2 } from "./interfaces/IBaseOdosAdapterV2.sol";
import { OdosSwapUtils } from "contracts/odos/OdosSwapUtils.sol";
import { PendleSwapLogic } from "./PendleSwapLogic.sol";
import { ISwapTypes } from "./interfaces/ISwapTypes.sol";
import { SwapExecutor } from "./SwapExecutor.sol";
import { OracleValidation } from "./OracleValidation.sol";

/**
 * @title BaseOdosBuyAdapterV2
 * @notice Implements the logic for adaptive buying with multi-protocol support
 * @dev Provides composed swapping capabilities (Odos + Pendle) and direct Odos swapping
 */
abstract contract BaseOdosBuyAdapterV2 is BaseOdosSwapAdapter, OracleValidation, IBaseOdosAdapterV2 {
    /// @notice The address of the Odos Router
    IOdosRouterV2 public immutable odosRouter;

    /// @notice The address of the Pendle Router
    address public immutable pendleRouter;

    // Uses InvalidPTSwapData() from IBaseOdosAdapterV2

    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _odosRouter,
        address _pendleRouter
    ) BaseOdosSwapAdapter(addressesProvider, pool) {
        odosRouter = _odosRouter;
        pendleRouter = _pendleRouter;
    }

    // Oracle validation logic inherited from OracleValidation contract

    /**
     * @dev Implementation of virtual function from OracleValidation
     * @return The addresses provider instance
     */
    function _getAddressesProvider() internal view override returns (IPoolAddressesProvider) {
        return ADDRESSES_PROVIDER;
    }

    /**
     * @dev Executes adaptive buy with intelligent multi-protocol routing
     * @dev Automatically chooses between direct Odos or composed Odos+Pendle swaps
     * @param assetToSwapFrom The asset to swap from
     * @param assetToSwapTo The asset to swap to
     * @param maxAmountToSwap Maximum amount of input tokens to spend
     * @param amountToReceive Exact amount of output tokens required
     * @param swapData Either regular Odos calldata or encoded PTSwapDataV2
     * @return amountSold The actual amount of input tokens spent
     */
    function _executeAdaptiveBuy(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 maxAmountToSwap,
        uint256 amountToReceive,
        bytes memory swapData
    ) internal returns (uint256 amountSold) {
        address tokenIn = address(assetToSwapFrom);
        address tokenOut = address(assetToSwapTo);

        // Validate swap amounts against oracle prices before execution
        _validateOraclePriceExactOutput(tokenIn, tokenOut, maxAmountToSwap, amountToReceive);

        // Check swap type using PendleSwapLogic
        ISwapTypes.SwapType swapType = PendleSwapLogic.determineSwapType(tokenIn, tokenOut);

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular swap - use direct Odos execution
            return _executeDirectOdosExactOutput(tokenIn, tokenOut, maxAmountToSwap, amountToReceive, swapData);
        }

        // PT token involved - use composed swap logic
        uint256 balanceBeforeAssetFrom = assetToSwapFrom.balanceOf(address(this));
        if (balanceBeforeAssetFrom < maxAmountToSwap) {
            revert InsufficientBalanceBeforeSwap(balanceBeforeAssetFrom, maxAmountToSwap);
        }

        // Execute composed swap with intelligent routing
        uint256 actualAmountOut = _executeComposedSwapExactOutput(
            tokenIn,
            tokenOut,
            maxAmountToSwap,
            amountToReceive,
            swapData
        );

        // Calculate the actual amount sold based on balance difference
        uint256 balanceAfterAssetFrom = assetToSwapFrom.balanceOf(address(this));

        // Protect against underflow: ensure balance before >= balance after
        if (balanceBeforeAssetFrom < balanceAfterAssetFrom) {
            revert InsufficientBalanceBeforeSwap(balanceBeforeAssetFrom, balanceAfterAssetFrom);
        }

        amountSold = balanceBeforeAssetFrom - balanceAfterAssetFrom;

        emit Bought(tokenIn, tokenOut, amountSold, actualAmountOut);
        return amountSold;
    }

    /**
     * @dev Executes composed swap with intelligent routing and PT token support
     * @dev Can handle: Regular↔Regular, PT↔Regular, Regular↔PT, PT↔PT swaps
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param maxInputAmount The maximum amount of input tokens to spend
     * @param exactOutputAmount The exact amount of output tokens required
     * @param swapData The swap data (either regular Odos or PTSwapDataV2)
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeComposedSwapExactOutput(
        address inputToken,
        address outputToken,
        uint256 maxInputAmount,
        uint256 exactOutputAmount,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        return
            SwapExecutor.executeSwapExactOutput(
                SwapExecutor.ExactOutputParams({
                    inputToken: inputToken,
                    outputToken: outputToken,
                    maxInputAmount: maxInputAmount,
                    exactOutputAmount: exactOutputAmount,
                    swapData: swapData,
                    pendleRouter: pendleRouter,
                    odosRouter: odosRouter
                })
            );
    }

    /**
     * @dev Executes direct Odos-only swap (no PT routing logic)
     * @dev Only handles: Regular→Regular token swaps via Odos
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param maxInputAmount The maximum amount of input tokens to spend
     * @param exactOutputAmount The exact amount of output tokens required
     * @param swapData The raw Odos swap calldata
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeDirectOdosExactOutput(
        address inputToken,
        address outputToken,
        uint256 maxInputAmount,
        uint256 exactOutputAmount,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Execute Odos swap using OdosSwapUtils (handles approvals internally)
        actualOutputAmount = OdosSwapUtils.executeSwapOperation(
            odosRouter,
            inputToken,
            outputToken,
            maxInputAmount,
            exactOutputAmount,
            swapData
        );

        return actualOutputAmount;
    }
}
