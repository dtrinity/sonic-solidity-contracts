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

    /**
     * @dev Thrown when leftover collateral remains after exact input swap
     * @param asset The collateral asset address
     * @param leftoverAmount The amount of leftover collateral
     */
    error LeftoverCollateralAfterSwap(address asset, uint256 leftoverAmount);

    /* Structs intentionally omitted to avoid duplication with PTSwapUtils */
}
