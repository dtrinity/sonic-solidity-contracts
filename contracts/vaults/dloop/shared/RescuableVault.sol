// SPDX-License-Identifier: MIT
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

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Rescuable } from "contracts/common/Rescuable.sol";

/**
 * @title RescuableVault
 * @dev A helper contract for rescuing tokens accidentally sent to the contract
 *      - The derived contract must implement the isRestrictedRescueToken() function from Rescuable
 */
abstract contract RescuableVault is Ownable, ReentrancyGuard, Rescuable {
    /* Rescue Functions */

    /**
     * @dev Rescues tokens accidentally sent to the contract (except for the collateral token and debt token)
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     * @param amount Amount of tokens to rescue
     */
    function rescueToken(address token, address receiver, uint256 amount) public onlyOwner nonReentrant {
        // Expose the internal rescue token function of Rescuable
        _rescueToken(token, receiver, amount);
    }

    // Rescue ETH
    function rescueNative(address receiver, uint256 amount) public onlyOwner nonReentrant {
        // Expose the internal rescue native function of Rescuable
        _rescueNative(receiver, amount);
    }
}
