// SPDX-License-Identifier: AGPL-3.0
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { Ownable } from "contracts/dlend/core/dependencies/openzeppelin/contracts/Ownable.sol";

/**
 * @title Pausable
 * @notice Provides emergency pause functionality for contracts
 * @dev Allows the owner to pause/unpause contract operations as a security mechanism
 * - When paused, functions with whenNotPaused modifier will revert
 * - Only the owner can pause or unpause the contract
 * - This is a security feature to stop operations during attacks or emergencies
 */
abstract contract Pausable is Ownable {
    /// @notice Indicates whether the contract is paused
    bool private _paused;

    /**
     * @notice Emitted when the contract is paused
     * @param account The address that triggered the pause
     */
    event Paused(address account);

    /**
     * @notice Emitted when the contract is unpaused
     * @param account The address that triggered the unpause
     */
    event Unpaused(address account);

    /**
     * @notice Thrown when trying to execute a paused function while contract is paused
     */
    error EnforcedPause();

    /**
     * @notice Thrown when trying to pause an already paused contract
     */
    error ExpectedPause();

    /**
     * @notice Initializes the contract in unpaused state
     */
    constructor() {
        _paused = false;
    }

    /**
     * @notice Returns true if the contract is paused, and false otherwise
     */
    function paused() public view virtual returns (bool) {
        return _paused;
    }

    /**
     * @notice Modifier to make a function callable only when the contract is not paused
     * @dev Reverts with EnforcedPause if contract is paused
     */
    modifier whenNotPaused() {
        if (_paused) {
            revert EnforcedPause();
        }
        _;
    }

    /**
     * @notice Modifier to make a function callable only when the contract is paused
     * @dev Reverts with ExpectedPause if contract is not paused
     */
    modifier whenPaused() {
        if (!_paused) {
            revert ExpectedPause();
        }
        _;
    }

    /**
     * @notice Pauses the contract
     * @dev Only callable by the owner when contract is not paused
     * - Emits Paused event
     */
    function pause() external onlyOwner whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Unpauses the contract
     * @dev Only callable by the owner when contract is paused
     * - Emits Unpaused event
     */
    function unpause() external onlyOwner whenPaused {
        _paused = false;
        emit Unpaused(msg.sender);
    }
}
