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
import { ERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title RescuableVault
 * @dev A helper contract for rescuing tokens accidentally sent to the contract
 *      - The derived contract must implement the getRestrictedRescueTokens() function
 */
abstract contract RescuableVault is Ownable, ReentrancyGuard {
    using SafeERC20 for ERC20;

    /* Virtual Methods - Required to be implemented by derived contracts */

    /**
     * @dev Gets the restricted rescue tokens
     * @return address[] Restricted rescue tokens
     */
    function getRestrictedRescueTokens() public view virtual returns (address[] memory);

    /* Rescue Functions */

    /**
     * @dev Rescues tokens accidentally sent to the contract (except for the collateral token and debt token)
     * @param token Address of the token to rescue
     * @param receiver Address to receive the rescued tokens
     * @param amount Amount of tokens to rescue
     */
    function rescueToken(address token, address receiver, uint256 amount) public onlyOwner nonReentrant {
        // The vault does not hold any debt token and collateral token, so it is not necessary to restrict the rescue of debt token and collateral token
        // We can just rescue any ERC-20 token

        address[] memory restrictedRescueTokens = getRestrictedRescueTokens();

        // Check if the token is restricted
        for (uint256 i = 0; i < restrictedRescueTokens.length; i++) {
            if (token == restrictedRescueTokens[i]) {
                revert("Cannot rescue restricted token");
            }
        }

        // Rescue the token
        ERC20(token).safeTransfer(receiver, amount);
    }
}
