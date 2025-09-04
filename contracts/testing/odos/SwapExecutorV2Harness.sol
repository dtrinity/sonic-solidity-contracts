// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../dlend/periphery/adapters/odos/SwapExecutorV2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SwapExecutorV2Harness
 * @notice Test harness to expose SwapExecutorV2 library functions for testing
 */
contract SwapExecutorV2Harness {
    using SwapExecutorV2 for *;

    /// @notice Expose executeSwapExactInput function
    function executeSwapExactInput(SwapExecutorV2.ExactInputParams memory params) external returns (uint256) {
        return SwapExecutorV2.executeSwapExactInput(params);
    }

    /// @notice Expose executeSwapExactOutput function
    function executeSwapExactOutput(SwapExecutorV2.ExactOutputParams memory params) external returns (uint256) {
        return SwapExecutorV2.executeSwapExactOutput(params);
    }

    /// @notice Helper function to check token balance
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
