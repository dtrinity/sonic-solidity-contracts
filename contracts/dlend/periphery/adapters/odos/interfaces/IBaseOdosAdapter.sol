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

import {IERC20WithPermit} from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";

/**
 * @title IBaseOdosAdapter
 * @notice Interface for the BaseOdosAdapter
 */
interface IBaseOdosAdapter {
    /* Events */
    /**
     * @dev Emitted when a token is bought on Odos
     * @param tokenIn The address of the token sold
     * @param tokenOut The address of the token bought
     * @param amountIn The amount of tokens sold
     * @param amountOut The amount of tokens bought
     */
    event Bought(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    /* Custom Errors */
    /**
     * @dev Thrown when the balance before swap is insufficient
     * @param balance The actual balance
     * @param required The required balance
     */
    error InsufficientBalanceBeforeSwap(uint256 balance, uint256 required);

    /**
     * @dev Thrown when the output amount is less than the minimum expected
     * @param actual The actual output amount
     * @param expected The minimum expected output amount
     */
    error InsufficientOutputAmount(uint256 actual, uint256 expected);

    /**
     * @dev Thrown when the caller is not the pool
     * @param caller The actual caller
     * @param pool The expected pool
     */
    error CallerMustBePool(address caller, address pool);

    /**
     * @dev Thrown when the initiator is not the expected initiator
     * @param initiator The actual initiator
     * @param expectedInitiator The expected initiator
     */
    error InitiatorMustBeThis(address initiator, address expectedInitiator);

    /**
     * @dev Struct to hold permit data
     * @param aToken The aToken contract with permit functionality
     * @param value The amount of tokens to permit
     * @param deadline The deadline for the permit
     * @param v The v parameter of the signature
     * @param r The r parameter of the signature
     * @param s The s parameter of the signature
     */
    struct PermitInput {
        IERC20WithPermit aToken;
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}
