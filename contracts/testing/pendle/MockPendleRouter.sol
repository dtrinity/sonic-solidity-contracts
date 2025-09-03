// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockPendleRouter
 * @notice Mock contract that simulates Pendle router behavior for testing
 * @dev This mock allows configuring swap behaviors and tracks calls made
 */
contract MockPendleRouter {
    /// @notice Event emitted when a swap is executed
    event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    /// @notice Struct to define swap behavior for a token pair
    struct SwapBehavior {
        uint256 amountOut; // Amount to return for any swap
        bool shouldRevert; // Whether to revert the swap
        bool isConfigured; // Whether this pair is configured
    }

    /// @notice Mapping from tokenIn => tokenOut => behavior
    mapping(address => mapping(address => SwapBehavior)) public swapBehaviors;

    /// @notice Track number of swaps executed for testing
    uint256 public swapCount;

    /// @notice Last swap data for verification
    struct LastSwap {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        bytes callData;
    }

    LastSwap public lastSwap;

    /**
     * @notice Configure the behavior for a token pair swap
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountOut Amount of output tokens to return
     * @param shouldRevert Whether the swap should revert
     */
    function setSwapBehavior(address tokenIn, address tokenOut, uint256 amountOut, bool shouldRevert) external {
        swapBehaviors[tokenIn][tokenOut] = SwapBehavior({
            amountOut: amountOut,
            shouldRevert: shouldRevert,
            isConfigured: true
        });
    }

    /**
     * @notice Receive function for handling plain ETH transfers
     */
    receive() external payable {
        // Allow contract to receive ETH
    }

    /**
     * @notice Mock function that accepts any function call and executes configured behavior
     * @dev This function accepts any calldata and interprets it as a swap request
     * @return result Encoded return value (amountOut)
     */
    fallback(bytes calldata data) external payable returns (bytes memory result) {
        // Store the call data for verification in tests
        lastSwap.callData = data;
        swapCount++;

        // For any fallback call, just return success
        // The actual token transfers will be handled by the logic that tracks balances
        return abi.encode(true);
    }

    /**
     * @notice Execute a swap with explicitly provided parameters
     * @dev This is called when we want to explicitly test swap behavior
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input tokens
     * @return amountOut Amount of output tokens
     */
    function executeSwap(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut) {
        SwapBehavior memory behavior = swapBehaviors[tokenIn][tokenOut];

        require(behavior.isConfigured, "Swap not configured");

        if (behavior.shouldRevert) {
            revert("MockPendleRouter: Configured to revert");
        }

        // Pull input tokens from caller
        if (amountIn > 0) {
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        }

        // Send output tokens to caller
        amountOut = behavior.amountOut;
        if (amountOut > 0) {
            IERC20(tokenOut).transfer(msg.sender, amountOut);
        }

        // Store swap data
        lastSwap = LastSwap({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountOut: amountOut,
            callData: msg.data
        });

        swapCount++;
        emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut);

        return amountOut;
    }

    /**
     * @notice Reset swap count for testing
     */
    function resetSwapCount() external {
        swapCount = 0;
    }

    /**
     * @notice Emergency function to withdraw tokens
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawToken(address token, uint256 amount) external {
        IERC20(token).transfer(msg.sender, amount);
    }
}
