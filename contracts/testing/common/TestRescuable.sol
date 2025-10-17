// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Rescuable } from "contracts/common/Rescuable.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title TestRescuable
 * @notice Test contract for Rescuable functionality
 * @dev Simple contract that inherits Rescuable for testing purposes
 */
contract TestRescuable is Rescuable, Ownable {
    /**
     * @notice Event emitted when tokens are received
     */
    event TokensReceived(address indexed token, uint256 amount);

    /**
     * @notice Constructor sets the owner
     */
    constructor() Ownable(msg.sender) {
        // Ownable constructor is called implicitly
    }

    /**
     * @notice Accept token transfers (for testing)
     * @dev This simulates tokens getting stuck in the contract
     */
    function receiveTokens(address token, uint256 amount) external {
        // Transfer tokens from sender to this contract
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "TestRescuable: transfer failed");
        emit TokensReceived(token, amount);
    }

    /**
     * @notice Direct transfer handler (fallback for direct sends)
     * @dev Some tokens might be sent directly without calling a function
     */
    receive() external payable {
        // Allow receiving native tokens for testing
    }

    /**
     * @notice Implementation of the virtual function from Rescuable
     * @dev For testing purposes, we consider no tokens as restricted
     * @return bool Always returns false for testing
     */
    function isRescuableToken(address /*token*/) public pure override returns (bool) {
        // For testing purposes, allow rescuing any token
        return false;
    }

    /**
     * @notice Public function to test token rescue functionality (rescues all balance)
     * @dev Calls the internal _rescueToken function with full balance
     * @param token Address of the token to rescue
     */
    function rescueTokens(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        _rescueToken(token, msg.sender, balance);
    }

    /**
     * @notice Public function to test token rescue functionality
     * @dev Calls the internal _rescueToken function
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     * @param amount Amount of tokens to rescue
     */
    function rescueToken(address token, address receiver, uint256 amount) external onlyOwner {
        _rescueToken(token, receiver, amount);
    }

    /**
     * @notice Public function to test native token rescue functionality
     * @dev Calls the internal _rescueNative function
     * @param receiver Address to receive the rescued native tokens
     * @param amount Amount of native tokens to rescue
     */
    function rescueNative(address receiver, uint256 amount) external onlyOwner {
        _rescueNative(receiver, amount);
    }
}
