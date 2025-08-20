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
import {BaseOdosSellAdapter} from "./BaseOdosSellAdapter.sol";
import {IBaseOdosAdapterV2} from "./interfaces/IBaseOdosAdapterV2.sol";
import {OdosSwapUtils} from "contracts/odos/OdosSwapUtils.sol";
import {PTSwapUtils} from "./PTSwapUtils.sol";
import {ISwapTypes} from "./interfaces/ISwapTypes.sol";

/**
 * @title BaseOdosSellAdapterV2
 * @notice Implements the logic for selling tokens on Odos with PT token support
 * @dev Extends BaseOdosSellAdapter with PT token functionality
 */
abstract contract BaseOdosSellAdapterV2 is
    BaseOdosSellAdapter,
    IBaseOdosAdapterV2
{
    /// @notice The address of the Pendle Router
    address public immutable pendleRouter;

    // Uses InvalidPTSwapData() from IBaseOdosAdapterV2

    /**
     * @dev Constructor
     * @param addressesProvider The address of the Aave PoolAddressesProvider contract
     * @param pool The address of the Aave Pool contract
     * @param _swapRouter The address of the Odos Router
     * @param _pendleRouter The address of the Pendle Router
     */
    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _swapRouter,
        address _pendleRouter
    ) BaseOdosSellAdapter(addressesProvider, pool, _swapRouter) {
        pendleRouter = _pendleRouter;
    }

    /**
     * @dev Override _sellOnOdos to support PT tokens
     * @dev Routes to PT-aware logic or calls parent implementation
     */
    function _sellOnOdos(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 amountToSwap,
        uint256 minAmountToReceive,
        bytes memory swapData
    ) internal override returns (uint256 amountReceived) {
        address tokenIn = address(assetToSwapFrom);
        address tokenOut = address(assetToSwapTo);

        // Check swap type using PTSwapUtils
        ISwapTypes.SwapType swapType = PTSwapUtils.determineSwapType(
            tokenIn,
            tokenOut
        );

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular swap - call parent implementation
            return
                super._sellOnOdos(
                    assetToSwapFrom,
                    assetToSwapTo,
                    amountToSwap,
                    minAmountToReceive,
                    swapData
                );
        }

        // PT token involved - use composed swap logic
        uint256 balanceBeforeAssetFrom = assetToSwapFrom.balanceOf(
            address(this)
        );
        if (balanceBeforeAssetFrom < amountToSwap) {
            revert InsufficientBalanceBeforeSwap(
                balanceBeforeAssetFrom,
                amountToSwap
            );
        }

        // Execute PT-aware swap using PTSwapUtils
        amountReceived = _executeSwapExactInput(
            tokenIn,
            tokenOut,
            amountToSwap,
            minAmountToReceive,
            swapData
        );

        emit Bought(tokenIn, tokenOut, amountToSwap, amountReceived);
        return amountReceived;
    }

    /**
     * @dev Executes exact input swap with PT token support
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param exactInputAmount The exact amount of input tokens to spend
     * @param minOutputAmount The minimum amount of output tokens required
     * @param swapData The swap data (either regular Odos or PTSwapDataV2)
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeSwapExactInput(
        address inputToken,
        address outputToken,
        uint256 exactInputAmount,
        uint256 minOutputAmount,
        bytes memory swapData
    ) internal virtual returns (uint256 actualOutputAmount) {
        // Use PTSwapUtils to determine swap strategy and execute
        ISwapTypes.SwapType swapType = PTSwapUtils.determineSwapType(
            inputToken,
            outputToken
        );

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular swap - swapData should be raw Odos calldata
            return
                _executeOdosExactInput(
                    inputToken,
                    outputToken,
                    exactInputAmount,
                    minOutputAmount,
                    swapData
                );
        }

        // PT token involved - decode PTSwapDataV2 and use PTSwapUtils
        PTSwapUtils.PTSwapDataV2 memory ptSwapData = abi.decode(
            swapData,
            (PTSwapUtils.PTSwapDataV2)
        );

        if (!PTSwapUtils.validatePTSwapData(ptSwapData)) {
            revert InvalidPTSwapData();
        }

        if (swapType == ISwapTypes.SwapType.PT_TO_REGULAR) {
            // PT -> regular token
            return
                PTSwapUtils.executePTToTargetSwap(
                    inputToken,
                    outputToken,
                    exactInputAmount,
                    minOutputAmount,
                    pendleRouter,
                    swapRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.REGULAR_TO_PT) {
            // Regular token -> PT
            return
                PTSwapUtils.executeSourceToPTSwap(
                    inputToken,
                    outputToken,
                    exactInputAmount,
                    minOutputAmount,
                    pendleRouter,
                    swapRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.PT_TO_PT) {
            // PT -> PT (hybrid Odos + Pendle swap)
            return
                PTSwapUtils.executePTToPTSwap(
                    inputToken,
                    outputToken,
                    exactInputAmount,
                    minOutputAmount,
                    pendleRouter,
                    swapRouter,
                    ptSwapData
                );
        } else {
            revert InvalidPTSwapData(); // Should never reach here
        }
    }

    /**
     * @dev Executes exact input Odos swap
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param exactInputAmount The exact amount of input tokens to spend
     * @param minOutputAmount The minimum amount of output tokens required
     * @param swapData The Odos swap data
     * @return actualOutputAmount The actual amount of output tokens received
     */
    function _executeOdosExactInput(
        address inputToken,
        address outputToken,
        uint256 exactInputAmount,
        uint256 minOutputAmount,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Execute Odos swap using OdosSwapUtils
        actualOutputAmount = OdosSwapUtils.executeSwapOperation(
            swapRouter,
            inputToken,
            outputToken,
            exactInputAmount,
            minOutputAmount,
            swapData
        );

        return actualOutputAmount;
    }
}
