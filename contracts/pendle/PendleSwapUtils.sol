// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PendleSwapUtils
 * @notice Library for handling Pendle PT token swaps using SDK-generated transaction data
 * @dev This library executes pre-computed transaction data from Pendle's hosted SDK
 */
library PendleSwapUtils {
    using SafeERC20 for ERC20;

    /// @notice Custom error for failed Pendle swap with no revert reason
    error PendleSwapFailed();
    /// @notice Custom error when PT token approval fails
    error PTApprovalFailed();

    /**
     * @notice Executes a generic Pendle swap operation using SDK-generated transaction data
     * @dev Pendle router treats all tokens equally - PT, underlying, or any other ERC20
     * @param tokenIn The input token being swapped
     * @param tokenOut The output token being received
     * @param amountIn Amount of input tokens to swap
     * @param router Pendle router contract address from Pendle SDK
     * @param swapData Transaction data from Pendle SDK
     * @return amountOut Actual amount of output tokens received
     */
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address router,
        bytes memory swapData
    ) internal returns (uint256 amountOut) {
        // Record output balance before swap
        uint256 outputBalanceBefore = ERC20(tokenOut).balanceOf(address(this));

        // Execute swap with approval handling
        _executeWithApproval(tokenIn, amountIn, router, swapData);

        // Calculate actual tokens received using balance difference
        uint256 outputBalanceAfter = ERC20(tokenOut).balanceOf(address(this));
        amountOut = outputBalanceAfter - outputBalanceBefore;

        return amountOut;
    }

    /**
     * @notice Shared utility for Pendle router execution with approval handling
     * @param inputToken Token to approve and potentially spend
     * @param inputAmount Amount to approve
     * @param router Pendle router contract address
     * @param swapData Transaction data from Pendle SDK
     * @return result The return data from the router call
     */
    function _executeWithApproval(
        address inputToken,
        uint256 inputAmount,
        address router,
        bytes memory swapData
    ) private returns (bytes memory result) {
        // Approve input tokens to Pendle router
        SafeERC20.forceApprove(ERC20(inputToken), router, inputAmount);

        // Check if approval was successful
        uint256 currentAllowance = ERC20(inputToken).allowance(address(this), router);
        if (currentAllowance < inputAmount) {
            revert PTApprovalFailed();
        }

        // Execute Pendle swap using shared utility
        bool success;
        (success, result) = executePendleCall(router, swapData);

        if (!success) {
            revert PendleSwapFailed();
        }

        // Reset approval to 0 after swap to avoid potential exploits
        ERC20(inputToken).approve(router, 0);

        return result;
    }

    /**
     * @notice Executes generic Pendle swap with arbitrary calldata
     * @param router Pendle router contract address
     * @param swapData Transaction data from Pendle SDK
     * @return success Whether the swap was successful
     * @return result The return data from the swap
     */
    function executePendleCall(
        address router,
        bytes memory swapData
    ) internal returns (bool success, bytes memory result) {
        // Execute Pendle router call
        (success, result) = router.call(swapData);

        if (!success && result.length > 0) {
            // Bubble up revert reason
            assembly {
                let resultLength := mload(result)
                revert(add(32, result), resultLength)
            }
        }

        return (success, result);
    }
}
