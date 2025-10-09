// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../dlend/periphery/adapters/odos/SwapExecutor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SwapExecutorHarness
 * @notice Test harness to expose SwapExecutor library functions for testing
 */
contract SwapExecutorHarness {
    using SwapExecutor for *;

    /// @notice Expose executeSwapExactInput function
    function executeSwapExactInput(SwapExecutor.ExactInputParams memory params) external returns (uint256) {
        return SwapExecutor.executeSwapExactInput(params);
    }

    /// @notice Expose executeSwapExactOutput function
    function executeSwapExactOutput(SwapExecutor.ExactOutputParams memory params) external returns (uint256) {
        return SwapExecutor.executeSwapExactOutput(params);
    }

    /// @notice Helper function to check token balance
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
