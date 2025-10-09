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

import { PendleSwapLogic } from "./PendleSwapLogic.sol";
import { OdosSwapUtils } from "contracts/odos/OdosSwapUtils.sol";
import { IOdosRouterV2 } from "contracts/odos/interface/IOdosRouterV2.sol";
import { ISwapTypes } from "./interfaces/ISwapTypes.sol";

/**
 * @title SwapExecutor
 * @notice Unified library for executing all types of swaps in Odos V2 adapters
 * @dev Encapsulates swap type determination, validation, and execution logic
 *      to eliminate code duplication across adapters
 */
library SwapExecutor {
    /// @notice Error when swap data validation fails
    error InvalidSwapData();

    /**
     * @notice Parameters for exact input swaps
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param exactInputAmount The exact amount of input tokens to spend
     * @param minOutputAmount The minimum amount of output tokens required
     * @param swapData Either regular Odos swap data or encoded PTSwapDataV2
     * @param pendleRouter The Pendle router address (for PT swaps)
     * @param odosRouter The Odos router address
     */
    struct ExactInputParams {
        address inputToken;
        address outputToken;
        uint256 exactInputAmount;
        uint256 minOutputAmount;
        bytes swapData;
        address pendleRouter;
        IOdosRouterV2 odosRouter;
    }

    /**
     * @notice Parameters for exact output swaps
     * @param inputToken The input token address
     * @param outputToken The output token address
     * @param maxInputAmount The maximum amount of input tokens to spend
     * @param exactOutputAmount The exact amount of output tokens required
     * @param swapData Either regular Odos swap data or encoded PTSwapDataV2
     * @param pendleRouter The Pendle router address (for PT swaps)
     * @param odosRouter The Odos router address
     */
    struct ExactOutputParams {
        address inputToken;
        address outputToken;
        uint256 maxInputAmount;
        uint256 exactOutputAmount;
        bytes swapData;
        address pendleRouter;
        IOdosRouterV2 odosRouter;
    }

    /**
     * @notice Executes exact input swap with automatic routing
     * @dev Determines swap type and routes to appropriate execution logic
     * @param params The exact input swap parameters
     * @return actualOutputAmount Actual amount of output tokens received
     */
    function executeSwapExactInput(ExactInputParams memory params) internal returns (uint256 actualOutputAmount) {
        // Determine swap type using PendleSwapLogic
        ISwapTypes.SwapType swapType = PendleSwapLogic.determineSwapType(params.inputToken, params.outputToken);

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular Odos swap - swapData should be raw Odos calldata
            return
                OdosSwapUtils.executeSwapOperation(
                    params.odosRouter,
                    params.inputToken,
                    params.outputToken,
                    params.exactInputAmount,
                    params.minOutputAmount,
                    params.swapData
                );
        }

        // PT token involved - decode PTSwapDataV2 and use PendleSwapLogic
        PendleSwapLogic.PTSwapDataV2 memory ptSwapData = abi.decode(params.swapData, (PendleSwapLogic.PTSwapDataV2));

        if (!PendleSwapLogic.validatePTSwapData(ptSwapData)) {
            revert InvalidSwapData();
        }

        if (swapType == ISwapTypes.SwapType.PT_TO_REGULAR) {
            // PT -> regular token
            return
                PendleSwapLogic.executePTToTargetSwap(
                    params.inputToken,
                    params.outputToken,
                    params.exactInputAmount,
                    params.minOutputAmount,
                    params.pendleRouter,
                    params.odosRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.REGULAR_TO_PT) {
            // Regular token -> PT
            return
                PendleSwapLogic.executeSourceToPTSwap(
                    params.inputToken,
                    params.outputToken,
                    params.exactInputAmount,
                    params.minOutputAmount,
                    params.pendleRouter,
                    params.odosRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.PT_TO_PT) {
            // PT -> PT (hybrid Odos + Pendle swap)
            return
                PendleSwapLogic.executePTToPTSwap(
                    params.inputToken,
                    params.outputToken,
                    params.exactInputAmount,
                    params.minOutputAmount,
                    params.pendleRouter,
                    params.odosRouter,
                    ptSwapData
                );
        } else {
            revert InvalidSwapData(); // Should never reach here
        }
    }

    /**
     * @notice Executes exact output swap with automatic routing
     * @dev Determines swap type and routes to appropriate execution logic
     * @param params The exact output swap parameters
     * @return actualInputAmount Actual amount of input tokens spent
     */
    function executeSwapExactOutput(ExactOutputParams memory params) internal returns (uint256 actualInputAmount) {
        // Determine swap type using PendleSwapLogic
        ISwapTypes.SwapType swapType = PendleSwapLogic.determineSwapType(params.inputToken, params.outputToken);

        if (swapType == ISwapTypes.SwapType.REGULAR_SWAP) {
            // Regular Odos swap - swapData should be raw Odos calldata
            return
                OdosSwapUtils.executeSwapOperation(
                    params.odosRouter,
                    params.inputToken,
                    params.outputToken,
                    params.maxInputAmount,
                    params.exactOutputAmount,
                    params.swapData
                );
        }

        // PT token involved - decode PTSwapDataV2 and use PendleSwapLogic
        PendleSwapLogic.PTSwapDataV2 memory ptSwapData = abi.decode(params.swapData, (PendleSwapLogic.PTSwapDataV2));

        if (!PendleSwapLogic.validatePTSwapData(ptSwapData)) {
            revert InvalidSwapData();
        }

        if (swapType == ISwapTypes.SwapType.PT_TO_REGULAR) {
            // PT -> regular token
            return
                PendleSwapLogic.executePTToTargetSwap(
                    params.inputToken,
                    params.outputToken,
                    params.maxInputAmount,
                    params.exactOutputAmount,
                    params.pendleRouter,
                    params.odosRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.REGULAR_TO_PT) {
            // Regular token -> PT
            return
                PendleSwapLogic.executeSourceToPTSwap(
                    params.inputToken,
                    params.outputToken,
                    params.maxInputAmount,
                    params.exactOutputAmount,
                    params.pendleRouter,
                    params.odosRouter,
                    ptSwapData
                );
        } else if (swapType == ISwapTypes.SwapType.PT_TO_PT) {
            // PT -> PT (hybrid Odos + Pendle swap)
            return
                PendleSwapLogic.executePTToPTSwap(
                    params.inputToken,
                    params.outputToken,
                    params.maxInputAmount,
                    params.exactOutputAmount,
                    params.pendleRouter,
                    params.odosRouter,
                    ptSwapData
                );
        } else {
            revert InvalidSwapData(); // Should never reach here
        }
    }
}
