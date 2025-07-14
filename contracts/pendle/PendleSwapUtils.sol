// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

/**
 * @title PendleSwapUtils
 * @notice Library for handling Pendle PT token swaps using SDK-generated transaction data
 * @dev This library executes pre-computed transaction data from Pendle's hosted SDK
 */
library PendleSwapUtils {
    using SafeERC20 for ERC20;

    /// @notice Custom error for failed Pendle swap with no revert reason
    error PendleSwapFailed();
    /// @notice Custom error when actual output amount is less than expected (accounting for slippage tolerance)
    error InsufficientPendleOutput(uint256 expected, uint256 actual, uint256 tolerance);
    /// @notice Custom error when PT token approval fails
    error PTApprovalFailed();

    /**
     * @notice Executes a Pendle PT swap operation using SDK-generated transaction data
     * @param ptToken The PT token being swapped
     * @param underlyingToken The underlying token being received
     * @param ptAmount Amount of PT tokens to swap
     * @param expectedUnderlyingOut Expected amount of underlying tokens from SDK
     * @param router Pendle router contract address from Pendle SDK
     * @param swapData Transaction data from Pendle SDK
     * @param slippageToleranceBps Slippage tolerance in basis points (e.g., 500 = 5%)
     * @return actualUnderlyingOut Actual amount of underlying tokens received
     */
    function executePendleSwap(
        address ptToken,
        address underlyingToken,
        uint256 ptAmount,
        uint256 expectedUnderlyingOut,
        address router,
        bytes memory swapData,
        uint256 slippageToleranceBps
    ) internal returns (uint256 actualUnderlyingOut) {
        console.log("PendleSwapUtils: Executing PT swap");
        console.log("PT Token:", ptToken);
        console.log("Underlying Token:", underlyingToken);
        console.log("PT Amount:", ptAmount);
        console.log("Expected Underlying Out:", expectedUnderlyingOut);

        // Approve PT tokens to target contract
        ERC20(ptToken).forceApprove(router, ptAmount);
        
        // Check if approval was successful
        if (ERC20(ptToken).allowance(address(this), router) < ptAmount) {
            revert PTApprovalFailed();
        }

        // Record underlying token balance before swap
        uint256 underlyingBalanceBefore = ERC20(underlyingToken).balanceOf(address(this));
        console.log("Underlying balance before:", underlyingBalanceBefore);

        // Execute Pendle SDK transaction
        (bool success, bytes memory result) = router.call(swapData);
        if (!success) {
            console.log("Pendle swap failed");
            // Decode the revert reason if present
            if (result.length > 0) {
                assembly {
                    let resultLength := mload(result)
                    revert(add(32, result), resultLength)
                }
            }
            revert PendleSwapFailed();
        }

        // Calculate actual underlying tokens received
        uint256 underlyingBalanceAfter = ERC20(underlyingToken).balanceOf(address(this));
        actualUnderlyingOut = underlyingBalanceAfter - underlyingBalanceBefore;
        
        console.log("Underlying balance after:", underlyingBalanceAfter);
        console.log("Actual underlying received:", actualUnderlyingOut);

        // Calculate minimum acceptable amount based on slippage tolerance
        uint256 minAcceptableOut = (expectedUnderlyingOut * (10000 - slippageToleranceBps)) / 10000;
        
        console.log("Min acceptable out:", minAcceptableOut);
        console.log("Slippage tolerance (bps):", slippageToleranceBps);

        // Verify we received sufficient underlying tokens
        if (actualUnderlyingOut < minAcceptableOut) {
            revert InsufficientPendleOutput(expectedUnderlyingOut, actualUnderlyingOut, slippageToleranceBps);
        }

        console.log("Pendle swap successful");
        return actualUnderlyingOut;
    }


} 