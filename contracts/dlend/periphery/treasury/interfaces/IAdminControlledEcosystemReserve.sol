// SPDX-License-Identifier: GPL-3.0
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

import {IERC20} from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";

interface IAdminControlledEcosystemReserve {
    /** @notice Emitted when the funds admin changes
     * @param fundsAdmin The new funds admin
     **/
    event NewFundsAdmin(address indexed fundsAdmin);

    /** @notice Returns the mock ETH reference address
     * @return address The address
     **/
    function ETH_MOCK_ADDRESS() external pure returns (address);

    /**
     * @notice Return the funds admin, only entity to be able to interact with this contract (controller of reserve)
     * @return address The address of the funds admin
     **/
    function getFundsAdmin() external view returns (address);

    /**
     * @dev Function for the funds admin to give ERC20 allowance to other parties
     * @param token The address of the token to give allowance from
     * @param recipient Allowance's recipient
     * @param amount Allowance to approve
     **/
    function approve(IERC20 token, address recipient, uint256 amount) external;

    /**
     * @notice Function for the funds admin to transfer ERC20 tokens to other parties
     * @param token The address of the token to transfer
     * @param recipient Transfer's recipient
     * @param amount Amount to transfer
     **/
    function transfer(IERC20 token, address recipient, uint256 amount) external;
}
