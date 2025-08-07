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

import {IERC20WithPermit} from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";

import {IBaseOdosAdapter} from "./IBaseOdosAdapter.sol";

/**
 * @title IBaseOdosAdapterV2
 * @notice Interface for the BaseOdosAdapterV2 with PT token support
 */
interface IBaseOdosAdapterV2 is IBaseOdosAdapter {
    /* Events */
    /**
     * @dev Emitted when a PT swap is executed
     * @param ptToken The PT token address
     * @param underlyingToken The underlying token address
     * @param ptAmount The amount of PT tokens swapped
     * @param underlyingReceived The amount of underlying tokens received
     */
    event PTSwapExecuted(
        address indexed ptToken,
        address indexed underlyingToken,
        uint256 ptAmount,
        uint256 underlyingReceived
    );

    /**
     * @dev Emitted when a composed PT+Odos swap is executed
     * @param inputToken The input token address
     * @param outputToken The final output token address
     * @param inputAmount The amount of input tokens
     * @param finalOutputAmount The final amount of output tokens received
     */
    event ComposedSwapExecuted(
        address indexed inputToken,
        address indexed outputToken,
        uint256 inputAmount,
        uint256 finalOutputAmount
    );

    /* Custom Errors */
    /**
     * @dev Thrown when PT swap data is invalid
     */
    error InvalidPTSwapData();

    /**
     * @dev Thrown when Pendle swap fails
     * @param reason The failure reason
     */
    error PendleSwapFailed(string reason);

    /**
     * @dev Thrown when Odos swap fails
     * @param reason The failure reason
     */
    error OdosSwapFailed(string reason);

    /**
     * @dev Thrown when insufficient output is received after composed swap
     * @param expected The expected amount
     * @param actual The actual amount received
     */
    error InsufficientOutputAfterComposedSwap(uint256 expected, uint256 actual);

    /* Structs */
    /**
     * @dev Struct to hold PT swap data for composed swaps
     * @param isComposed True if this is a composed PT+Odos swap
     * @param underlyingAsset The underlying asset from PT swap (for composed swaps)
     * @param pendleCalldata The Pendle swap calldata (for composed swaps)
     * @param odosCalldata The Odos swap calldata (can be empty for direct swaps)
     */
    struct PTSwapDataV2 {
        bool isComposed;
        address underlyingAsset;
        bytes pendleCalldata;
        bytes odosCalldata;
    }
}
