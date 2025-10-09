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
 * @title BaseOdosSellAdapterV2
 * @notice Implements the logic for adaptive selling with multi-protocol support
 * @dev Provides composed swapping capabilities (Odos + Pendle) and direct Odos swapping
 */
abstract contract BaseOdosSellAdapterV2 is BaseOdosSwapAdapter, OracleValidation, IBaseOdosAdapterV2 {
    /// @notice The address of the Odos Router
    IOdosRouterV2 public immutable odosRouter;

    /// @notice The address of the Pendle Router
    address public immutable pendleRouter;

    // Uses InvalidPTSwapData() from IBaseOdosAdapterV2

    /**
     * @dev Constructor
     * @param addressesProvider The address of the Aave PoolAddressesProvider contract
     * @param pool The address of the Aave Pool contract
     * @param _odosRouter The address of the Odos Router
     * @param _pendleRouter The address of the Pendle Router
     */
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
     * @dev Executes adaptive swap with intelligent multi-protocol routing
     * @dev Automatically chooses between direct Odos or composed Odos+Pendle swaps
     * @param assetToSwapFrom The asset to swap from
     * @param assetToSwapTo The asset to swap to
     * @param amountToSwap Amount of input tokens to swap
     * @param minAmountToReceive Minimum amount of output tokens required
     * @param swapData Either regular Odos calldata or encoded PTSwapDataV2
     * @return amountReceived The amount of output tokens received
     */
    function _executeAdaptiveSwap(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 amountToSwap,
        uint256 minAmountToReceive,
        bytes memory swapData
    ) internal returns (uint256 amountReceived) {
        address tokenIn = address(assetToSwapFrom);
        address tokenOut = address(assetToSwapTo);

        // Validate swap amounts against oracle prices before execution
        _validateOraclePriceExactInput(tokenIn, tokenOut, amountToSwap, minAmountToReceive);

        // Check swap type using PendleSwapLogic
        ISwapTypes.SwapType swapType = PendleSwapLogic.determineSwapType(tokenIn, tokenOut);

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular swap - use direct Odos execution with leftover validation
            uint256 inputBalanceBefore = assetToSwapFrom.balanceOf(address(this));

            // Ensure we actually hold at least the declared exact input amount
            if (inputBalanceBefore < amountToSwap) {
                revert InsufficientBalanceBeforeSwap(inputBalanceBefore, amountToSwap);
            }

            uint256 swapResult = _executeDirectOdosExactInput(
                tokenIn,
                tokenOut,
                amountToSwap,
                minAmountToReceive,
                swapData
            );

            // Note: Leftover collateral handling moved to individual adapter contracts
            // Each adapter can decide whether to re-supply excess or handle differently

            return swapResult;
        }

        // PT token involved - use composed swap logic
        uint256 ptInputBalanceBefore = assetToSwapFrom.balanceOf(address(this));
        if (ptInputBalanceBefore < amountToSwap) {
            revert InsufficientBalanceBeforeSwap(ptInputBalanceBefore, amountToSwap);
        }

        // Execute composed swap with intelligent routing
        amountReceived = _executeComposedSwapExactInput(tokenIn, tokenOut, amountToSwap, minAmountToReceive, swapData);

        // Note: Leftover collateral handling moved to individual adapter contracts

        emit Bought(tokenIn, tokenOut, amountToSwap, amountReceived);
        return amountReceived;
    }

    /**
     * @dev Executes composed swap with intelligent routing and PT token support
     * @dev Can handle: Regular↔Regular, PT↔Regular, Regular↔PT, PT↔PT swaps
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param exactInputAmount The exact amount of input tokens to spend
     * @param minOutputAmount The minimum amount of output tokens required
     * @param swapData The swap data (either regular Odos or PTSwapDataV2)
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeComposedSwapExactInput(
        address inputToken,
        address outputToken,
        uint256 exactInputAmount,
        uint256 minOutputAmount,
        bytes memory swapData
    ) internal virtual returns (uint256 actualOutputAmount) {
        return
            SwapExecutor.executeSwapExactInput(
                SwapExecutor.ExactInputParams({
                    inputToken: inputToken,
                    outputToken: outputToken,
                    exactInputAmount: exactInputAmount,
                    minOutputAmount: minOutputAmount,
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
     * @param exactInputAmount The exact amount of input tokens to spend
     * @param minOutputAmount The minimum amount of output tokens required
     * @param swapData The raw Odos swap calldata
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeDirectOdosExactInput(
        address inputToken,
        address outputToken,
        uint256 exactInputAmount,
        uint256 minOutputAmount,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Execute Odos swap using OdosSwapUtils (handles approvals internally)
        actualOutputAmount = OdosSwapUtils.executeSwapOperation(
            odosRouter,
            inputToken,
            outputToken,
            exactInputAmount,
            minOutputAmount,
            swapData
        );

        return actualOutputAmount;
    }
}
