// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

/**
 * @title ISwapTypes
 * @notice Interface defining swap strategy types used across V2 adapters
 * @dev Centralizes swap type definitions for consistency across contracts
 */
interface ISwapTypes {
    /**
     * @notice Enumeration of supported swap strategies
     * @dev Used by PTSwapUtils.determineSwapType() to route swap execution
     */
    enum SwapType {
        REGULAR_SWAP, // 0: Regular ERC20 → ERC20 (Odos only)
        PT_TO_REGULAR, // 1: PT → underlying → ERC20 (Pendle + Odos)
        REGULAR_TO_PT, // 2: ERC20 → ERC20 → PT (Odos + Pendle)
        PT_TO_PT // 3: PT → PT (Pendle only)
    }
}
