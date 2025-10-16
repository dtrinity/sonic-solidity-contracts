// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Rescuable, Ownable } from "contracts/common/Rescuable.sol";
import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title TestRescuable
 * @notice Test contract for Rescuable functionality
 * @dev Simple contract that inherits Rescuable for testing purposes
 */
contract TestRescuable is Rescuable {
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
}
