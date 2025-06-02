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

import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title IDPoolVaultLP
 * @author dTRINITY Protocol
 * @notice Interface for dPOOL vault that accepts LP tokens as the primary asset
 * @dev Each vault represents a specific LP position on a specific DEX. The vault's asset() is the LP token.
 */
interface IDPoolVaultLP is IERC4626, IAccessControl {
    // --- Events ---
    // Note: WithdrawalFeeSet and WithdrawalFeeApplied events are inherited from SupportsWithdrawalFee

    // --- Errors ---

    /**
     * @notice Thrown when zero address is provided where valid address is required
     */
    error ZeroAddress();

    /**
     * @notice Thrown when insufficient LP tokens for withdrawal
     */
    error InsufficientLPTokens();

    // Note: FeeExceedsMaxFee and InitialFeeExceedsMaxFee errors are inherited from SupportsWithdrawalFee

    // --- Vault Configuration ---

    /**
     * @notice Address of the LP token this vault accepts (same as asset())
     * @return The LP token address
     */
    function lpToken() external view returns (address);

    /**
     * @notice Address of the DEX pool for this vault
     * @return The pool address
     */
    function pool() external view returns (address);

    /**
     * @notice Current withdrawal fee in basis points
     * @return Withdrawal fee in basis points
     */
    function withdrawalFeeBps() external view returns (uint256);

    /**
     * @notice Maximum allowed withdrawal fee in basis points
     * @return Maximum withdrawal fee in basis points
     */
    function maxWithdrawalFeeBps() external view returns (uint256);

    // --- Fee Management ---

    /**
     * @notice Set withdrawal fee (only FEE_MANAGER_ROLE)
     * @param newFeeBps New withdrawal fee in basis points
     */
    function setWithdrawalFee(uint256 newFeeBps) external;

    // --- Preview Functions ---

    /**
     * @notice Preview shares received for LP token deposit
     * @param lpAmount Amount of LP tokens to deposit
     * @return shares Amount of shares that would be minted
     */
    function previewDepositLP(
        uint256 lpAmount
    ) external view returns (uint256 shares);

    /**
     * @notice Preview base asset value for a given amount of LP tokens
     * @dev This is an auxiliary function for external valuation, not used in core ERC4626 mechanics
     * @param lpAmount Amount of LP tokens
     * @return Base asset value
     */
    function previewLPValue(uint256 lpAmount) external view returns (uint256);

    // --- Roles ---

    /**
     * @notice Role identifier for fee management
     */
    function FEE_MANAGER_ROLE() external pure returns (bytes32);
}
