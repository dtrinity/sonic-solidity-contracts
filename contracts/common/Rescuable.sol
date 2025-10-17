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

import { ERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title Rescuable
 * @dev A helper contract for rescuing tokens accidentally sent to the contract
 *      - The derived contract must implement the isRescuableToken() function
 */
abstract contract Rescuable {
    error CannotRescueRestrictedToken(address token);

    using SafeERC20 for ERC20;

    /* Virtual Methods - Required to be implemented by derived contracts */

    /**
     * @dev Checks if the token is a restricted rescue token
     * @param token Address of the token to check
     * @return bool True if the token is a restricted rescue token, false otherwise
     */
    function isRescuableToken(address token) public view virtual returns (bool);

    /* Rescue Functions */

    /**
     * @dev Rescues tokens accidentally sent to the contract
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     * @param amount Amount of tokens to rescue
     */
    function _rescueToken(address token, address receiver, uint256 amount) internal {
        if (isRescuableToken(token)) {
            revert CannotRescueRestrictedToken(token);
        }

        // Rescue the token
        ERC20(token).safeTransfer(receiver, amount);
    }

    // Rescue native token
    function _rescueNative(address receiver, uint256 amount) internal {
        // Transfer the native token to the receiver
        Address.sendValue(payable(receiver), amount);
    }
}
