// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface for Odos swap router
interface IOdosRouter {
    /// @notice Execute a swap with the given calldata
    /// @param data Encoded swap data (paths, amounts, recipient, etc.)
    /// @return amountOut The amount of output token received
    function execute(bytes calldata data) external payable returns (uint256 amountOut);

    /// @notice Get a quote for a swap
    /// @param data Encoded quote data
    /// @return amountOut Expected output amount
    function quote(bytes calldata data) external view returns (uint256 amountOut);
}
