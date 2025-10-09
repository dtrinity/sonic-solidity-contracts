// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Pausable } from "contracts/common/Pausable.sol";

/**
 * @title TestPausable
 * @notice Test contract for Pausable functionality
 * @dev Simple contract that inherits Pausable for testing purposes
 */
contract TestPausable is Pausable {
    /**
     * @notice Event emitted when operation is performed
     */
    event OperationPerformed(address indexed caller, uint256 value);

    /**
     * @notice Counter to track operations
     */
    uint256 public operationCount;

    /**
     * @notice Constructor sets the owner
     */
    constructor() {
        // Ownable constructor is called implicitly
    }

    /**
     * @notice Test function that can only be called when not paused
     * @dev This simulates a critical operation that should be pausable
     */
    function performOperation(uint256 value) external whenNotPaused {
        operationCount++;
        emit OperationPerformed(msg.sender, value);
    }

    /**
     * @notice Test function that can only be called when paused
     * @dev This simulates an emergency-only operation
     */
    function emergencyOperation() external view whenPaused returns (bool) {
        return true;
    }

    /**
     * @notice Test function with no pause modifier
     * @dev This should work regardless of pause state
     */
    function alwaysWorkingFunction() external pure returns (bool) {
        return true;
    }
}
