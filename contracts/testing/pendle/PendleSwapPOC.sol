// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "../../pendle/PendleSwapUtils.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

/**
 * @title PendleSwapPOC
 * @notice Proof of Concept contract to test Pendle SDK integration
 * @dev This contract demonstrates how to execute Pendle swaps using off-chain computed transaction data
 */
contract PendleSwapPOC {
    using SafeERC20 for ERC20;
    using PendleSwapUtils for *;

    /// @notice Event emitted when a Pendle swap is executed successfully
    event PendleSwapExecuted(
        address indexed ptToken,
        address indexed underlyingToken,
        uint256 ptAmountIn,
        uint256 underlyingAmountOut,
        uint256 expectedAmount,
        address target
    );

    /// @notice Event emitted when funds are received
    event FundsReceived(address indexed token, uint256 amount);

    /**
     * @notice Execute a PT token swap using Pendle SDK transaction data
     * @param ptToken The PT token to swap
     * @param underlyingToken The expected underlying token to receive
     * @param ptAmount Amount of PT tokens to swap
     * @param expectedUnderlyingOut Expected underlying amount from Pendle SDK
     * @param target Target contract address from Pendle SDK
     * @param swapData Transaction data from Pendle SDK
     * @param slippageToleranceBps Slippage tolerance in basis points (e.g., 500 = 5%)
     * @return actualOut Actual amount of underlying tokens received
     */
    function executePendleSwap(
        address ptToken,
        address underlyingToken,
        uint256 ptAmount,
        uint256 expectedUnderlyingOut,
        address target,
        bytes calldata swapData,
        uint256 slippageToleranceBps
    ) external returns (uint256 actualOut) {
        console.log("=== PendleSwapPOC: Executing PT Swap ===");
        console.log("PT Token:", ptToken);
        console.log("Amount to swap:", ptAmount);
        console.log("Expected output:", expectedUnderlyingOut);
        console.log("Target contract:", target);
        console.log("Slippage tolerance (bps):", slippageToleranceBps);

        // Check we have enough PT tokens
        uint256 balance = ERC20(ptToken).balanceOf(address(this));
        require(balance >= ptAmount, "Insufficient PT token balance");
        console.log("PT token balance:", balance);

        // Execute the swap using PendleSwapUtils
        actualOut = PendleSwapUtils.executePendleSwap(
            ptToken,
            underlyingToken,
            ptAmount,
            expectedUnderlyingOut,
            target,
            swapData,
            slippageToleranceBps
        );

        emit PendleSwapExecuted(
            ptToken,
            underlyingToken,
            ptAmount,
            actualOut,
            expectedUnderlyingOut,
            target
        );

        console.log("=== Swap completed successfully ===");
        console.log("Actual underlying received:", actualOut);
        return actualOut;
    }

    /**
     * @notice Fund this contract with PT tokens for testing
     * @param ptToken The PT token address
     * @param amount Amount to fund
     */
    function fundContract(address ptToken, uint256 amount) external {
        ERC20(ptToken).safeTransferFrom(msg.sender, address(this), amount);
        emit FundsReceived(ptToken, amount);
        console.log("Contract funded with", amount, "PT tokens");
    }

    /**
     * @notice Check token balance of this contract
     * @param token Token address to check
     * @return balance Current balance
     */
    function getBalance(address token) external view returns (uint256 balance) {
        return ERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Withdraw tokens from this contract (for cleanup)
     * @param token Token to withdraw
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawTokens(address token, address to, uint256 amount) external {
        ERC20(token).safeTransfer(to, amount);
        console.log("Withdrawn", amount, "tokens to", to);
    }

    /**
     * @notice Emergency function to withdraw all tokens
     * @param token Token to withdraw
     * @param to Recipient address
     */
    function emergencyWithdraw(address token, address to) external {
        uint256 balance = ERC20(token).balanceOf(address(this));
        if (balance > 0) {
            ERC20(token).safeTransfer(to, balance);
            console.log("Emergency withdrawn", balance, "tokens to", to);
        }
    }
} 