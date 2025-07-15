// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "../../pendle/PendleSwapUtils.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PendleSwapPOC
 * @notice Proof of Concept contract to test Pendle SDK integration
 * @dev This contract demonstrates how to execute Pendle swaps using off-chain computed transaction data
 *
 * User Flow:
 * 1. User approves this contract to spend their PT tokens: ptToken.approve(contractAddress, amount)
 * 2. User calls executePendleSwap() with Pendle SDK generated transaction data
 * 3. Contract pulls PT tokens from user, executes the swap via Pendle SDK
 * 4. Underlying tokens are sent directly to receiver specified in Pendle SDK call data
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
        uint256 ptAmountIn,
        uint256 amountSpent,
        address target
    );

    /// @notice Event emitted when funds are received
    event FundsReceived(address indexed token, uint256 amount);

    /**
     * @notice Execute a PT token swap using Pendle SDK transaction data
     * @dev This function pulls PT tokens from the user and executes the swap.
     *      Underlying tokens go directly to the receiver specified in Pendle SDK call data.
     * @param ptToken The PT token to swap
     * @param ptAmount Amount of PT tokens to swap
     * @param router Pendle router contract address from Pendle SDK
     * @param swapData Transaction data from Pendle SDK
     * @return amountSpent Actual amount spent from the Pendle swap result
     */
    function executePendleSwap(
        address ptToken,
        uint256 ptAmount,
        address router,
        bytes calldata swapData
    ) external returns (uint256 amountSpent) {
        // Check user has enough PT tokens
        uint256 userBalance = ERC20(ptToken).balanceOf(msg.sender);
        require(
            userBalance >= ptAmount,
            "User has insufficient PT token balance"
        );

        // Check allowance
        uint256 allowance = ERC20(ptToken).allowance(msg.sender, address(this));
        require(allowance >= ptAmount, "Insufficient allowance for PT tokens");

        // Pull PT tokens from user
        ERC20(ptToken).safeTransferFrom(msg.sender, address(this), ptAmount);

        // Execute the swap using PendleSwapUtils
        // Note: underlying tokens go directly to receiver specified in Pendle SDK call
        amountSpent = PendleSwapUtils.executePendleSwap(
            ptToken,
            ptAmount,
            router,
            swapData
        );

        emit PendleSwapExecuted(
            msg.sender,
            ptToken,
            ptAmount,
            amountSpent,
            router
        );

        return amountSpent;
    }

    /**
     * @notice Check how many PT tokens the user has approved for this contract
     * @param ptToken The PT token to check
     * @param user The user address to check
     * @return allowance Current allowance amount
     */
    function checkAllowance(
        address ptToken,
        address user
    ) external view returns (uint256 allowance) {
        return ERC20(ptToken).allowance(user, address(this));
    }

    /**
     * @notice Check PT token balance of a user
     * @param ptToken The PT token to check
     * @param user The user address to check
     * @return balance User's current PT token balance
     */
    function getUserBalance(
        address ptToken,
        address user
    ) external view returns (uint256 balance) {
        return ERC20(ptToken).balanceOf(user);
    }

    /**
     * @notice Withdraw tokens from this contract (for cleanup)
     * @param token Token to withdraw
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawTokens(
        address token,
        address to,
        uint256 amount
    ) external {
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
