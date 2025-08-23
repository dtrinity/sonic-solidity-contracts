// SPDX-License-Identifier: BUSL-1.1
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

import { IPool } from "../../interfaces/IPool.sol";
import { IDelegationToken } from "../../interfaces/IDelegationToken.sol";
import { AToken } from "./AToken.sol";

/**
 * @title DelegationAwareAToken
 * @author Aave
 * @notice AToken enabled to delegate voting power of the underlying asset to a different address
 * @dev The underlying asset needs to be compatible with the COMP delegation interface
 */
contract DelegationAwareAToken is AToken {
    /**
     * @dev Emitted when underlying voting power is delegated
     * @param delegatee The address of the delegatee
     */
    event DelegateUnderlyingTo(address indexed delegatee);

    /**
     * @dev Constructor.
     * @param pool The address of the Pool contract
     */
    constructor(IPool pool) AToken(pool) {
        // Intentionally left blank
    }

    /**
     * @notice Delegates voting power of the underlying asset to a `delegatee` address
     * @param delegatee The address that will receive the delegation
     */
    function delegateUnderlyingTo(address delegatee) external onlyPoolAdmin {
        IDelegationToken(_underlyingAsset).delegate(delegatee);
        emit DelegateUnderlyingTo(delegatee);
    }
}
