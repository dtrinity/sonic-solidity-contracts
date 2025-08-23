// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "../../pendle/PendleSwapUtils.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PendleSwapPOC
 * @notice Proof of Concept contract to test Pendle SDK integration
 * @dev This contract demonstrates how to execute Pendle swaps using off-chain computed transaction data
 *
 * User Flow:
 * 1. User approves this contract to spend their PT tokens: ptToken.approve(contractAddress, amount)
 * 2. User calls executePendleSwap() with Pendle SDK generated transaction data (receiver = this contract)
 * 3. Contract pulls PT tokens from user, executes the swap via Pendle SDK
 * 4. Contract receives underlying tokens and transfers them back to the user
 *
 * Helper functions:
 * - getUserBalance(): Check user's PT token balance
 * - checkAllowance(): Check how much the contract is approved to spend
 */
contract PendleSwapPOC {
    using SafeERC20 for ERC20;
    using PendleSwapUtils for *;

    /// @notice Event emitted when a Pendle swap is executed successfully
    event PendleSwapExecuted(
        address indexed user,
        address indexed ptToken,
        address indexed underlyingToken,
        uint256 ptAmountIn,
        uint256 amountSpent,
        address target
    );

    /// @notice Event emitted when funds are received
    event FundsReceived(address indexed token, uint256 amount);

    /**
     * @notice Execute a PT token swap using Pendle SDK transaction data
     * @dev This function pulls PT tokens from the user, executes the swap, and transfers
     *      the underlying tokens back to the user.
     * @param ptToken The PT token to swap
     * @param underlyingToken The underlying token that will be received from the swap
     * @param ptAmount Amount of PT tokens to swap
     * @param router Pendle router contract address from Pendle SDK
     * @param swapData Transaction data from Pendle SDK
     * @return amountSpent Actual amount spent from the Pendle swap result
     */
    function executePendleSwap(
        address ptToken,
        address underlyingToken,
        uint256 ptAmount,
        address router,
        bytes calldata swapData
    ) external returns (uint256 amountSpent) {
        // Pull PT tokens from user
        ERC20(ptToken).safeTransferFrom(msg.sender, address(this), ptAmount);

        // Record underlying token balance before swap
        uint256 underlyingBalanceBefore = ERC20(underlyingToken).balanceOf(address(this));

        // Execute the swap using PendleSwapUtils
        amountSpent = PendleSwapUtils.executePendleSwap(ptToken, ptAmount, router, swapData);

        // Calculate underlying tokens received
        uint256 underlyingBalanceAfter = ERC20(underlyingToken).balanceOf(address(this));
        uint256 underlyingReceived = underlyingBalanceAfter - underlyingBalanceBefore;

        // Transfer underlying tokens back to user
        if (underlyingReceived > 0) {
            ERC20(underlyingToken).safeTransfer(msg.sender, underlyingReceived);
        }

        emit PendleSwapExecuted(msg.sender, ptToken, underlyingToken, ptAmount, amountSpent, router);

        return amountSpent;
    }

    /**
     * @notice Check how many PT tokens the user has approved for this contract
     * @param ptToken The PT token to check
     * @param user The user address to check
     * @return allowance Current allowance amount
     */
    function checkAllowance(address ptToken, address user) external view returns (uint256 allowance) {
        return ERC20(ptToken).allowance(user, address(this));
    }

    /**
     * @notice Check PT token balance of a user
     * @param ptToken The PT token to check
     * @param user The user address to check
     * @return balance User's current PT token balance
     */
    function getUserBalance(address ptToken, address user) external view returns (uint256 balance) {
        return ERC20(ptToken).balanceOf(user);
    }

    /**
     * @notice Withdraw tokens from this contract (for cleanup)
     * @param token Token to withdraw
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawTokens(address token, address to, uint256 amount) external {
        ERC20(token).safeTransfer(to, amount);
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
        }
    }
}
