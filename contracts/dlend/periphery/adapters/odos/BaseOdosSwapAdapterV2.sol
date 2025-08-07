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

import {IPoolAddressesProvider} from "contracts/dlend/core/interfaces/IPoolAddressesProvider.sol";
import {IBaseOdosAdapterV2} from "./interfaces/IBaseOdosAdapterV2.sol";
import {BaseOdosSwapAdapter} from "./BaseOdosSwapAdapter.sol";
import {IOdosRouterV2} from "contracts/odos/interface/IOdosRouterV2.sol";
import {OdosSwapUtils} from "contracts/odos/OdosSwapUtils.sol";
import {PTSwapUtils} from "./PTSwapUtils.sol";
import {ISwapTypes} from "./interfaces/ISwapTypes.sol";

/**
 * @title BaseOdosSwapAdapterV2
 * @notice Utility functions for adapters using Odos with PT token support
 * @dev Extends BaseOdosSwapAdapter with PT token functionality via PTSwapUtils
 */
abstract contract BaseOdosSwapAdapterV2 is
    BaseOdosSwapAdapter,
    IBaseOdosAdapterV2
{
    /// @notice The address of the Odos Router
    IOdosRouterV2 public immutable odosRouter;

    /// @notice The address of the Pendle Router
    address public immutable pendleRouter;

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

    /**
     * @dev Determines swap strategy and executes appropriate swap(s) using PTSwapUtils
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param inputAmount The amount of input tokens to swap
     * @param minOutputAmount The minimum amount of output tokens required
     * @param swapData Either regular Odos swap data or encoded PTSwapDataV2
     * @return actualOutputAmount Actual amount of output tokens received
     */
    function _executeSwap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount,
        bytes memory swapData
    ) internal returns (uint256 actualOutputAmount) {
        // Use PTSwapUtils to determine swap type
        ISwapTypes.SwapType swapType = PTSwapUtils.determineSwapType(
            inputToken,
            outputToken
        );

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular Odos swap - swapData should be raw Odos calldata
            return
                OdosSwapUtils.executeSwapOperation(
                    odosRouter,
                    inputToken,
                    outputToken,
                    inputAmount,
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
                    inputAmount,
                    minOutputAmount,
                    pendleRouter,
                    odosRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.REGULAR_TO_PT) {
            // Regular token -> PT
            return
                PTSwapUtils.executeSourceToPTSwap(
                    inputToken,
                    outputToken,
                    inputAmount,
                    minOutputAmount,
                    pendleRouter,
                    odosRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.PT_TO_PT) {
            // PT -> PT (direct Pendle swap)
            return
                PTSwapUtils.executePTToPTSwap(
                    inputToken,
                    outputToken,
                    inputAmount,
                    minOutputAmount,
                    pendleRouter,
                    ptSwapData
                );
        } else {
            revert InvalidPTSwapData(); // Should never reach here
        }
    }
}
