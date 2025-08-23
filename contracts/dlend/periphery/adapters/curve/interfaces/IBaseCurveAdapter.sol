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

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { IERC20WithPermit } from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";

/**
 * @title IBaseCurveAdapter
 * @notice Defines the basic interface of Curve adapter
 * @dev Implement this interface to provide functionality of swapping one asset to another asset
 **/
interface IBaseCurveAdapter {
    /* Structs */
    struct PermitInput {
        IERC20WithPermit aToken; // the asset to give allowance for
        uint256 value; // the amount of asset for the allowance
        uint256 deadline; // expiration unix timestamp
        uint8 v; // sig v
        bytes32 r; // sig r
        bytes32 s; // sig s
    }

    /* Events */
    /**
     * @dev Emitted after a sell of an asset is made
     * @param fromAsset The address of the asset sold
     * @param toAsset The address of the asset received in exchange
     * @param fromAmount The amount of asset sold
     * @param receivedAmount The amount received from the sell
     */
    event Swapped(address indexed fromAsset, address indexed toAsset, uint256 fromAmount, uint256 receivedAmount);

    /**
     * @dev Emitted after a buy of an asset is made
     * @param fromAsset The address of the asset provided in exchange
     * @param toAsset The address of the asset bought
     * @param amountSold The amount of asset provided for the buy
     * @param receivedAmount The amount of asset bought
     */
    event Bought(address indexed fromAsset, address indexed toAsset, uint256 amountSold, uint256 receivedAmount);

    /* Custom Errors */
    error InsufficientBalanceBeforeSwap(uint256 balance, uint256 required);
    error InsufficientOutputAmount(uint256 received, uint256 required);
    error CallerMustBePool(address caller, address pool);
    error InitiatorMustBeThis(address initiator, address expectedInitiator);

    /**
     * @notice Emergency rescue for token stucked on this contract, as failsafe mechanism
     * @dev Funds should never remain in this contract more time than during transactions
     * @dev Only callable by the owner
     * @param token The address of the stucked token to rescue
     */
    function rescueTokens(IERC20 token) external;
}
