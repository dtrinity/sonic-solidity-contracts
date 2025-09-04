// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDStakeRouter Interface
 * @notice Defines the external functions of the DStakeRouter required by the DStakeToken
 *         for handling deposits and withdrawals.
 */
interface IDStakeRouter {
    /**
     * @notice Handles the conversion of deposited dStable asset into a chosen `vaultAsset`
     *         and informs the collateral vault.
     * @dev Called by `DStakeToken._deposit()` after the token has received the dStable asset.
     * @dev The router MUST pull `dStableAmount` from the caller (`DStakeToken`).
     * @param dStableAmount The amount of dStable asset deposited by the user into the DStakeToken.
     */
    function deposit(uint256 dStableAmount) external;

    /**
     * @notice Handles the conversion of a `vaultAsset` back into the dStable asset for withdrawal.
     * @dev Called by `DStakeToken._withdraw()`.
     * @dev The router coordinates pulling the required `vaultAsset` from the collateral vault
     *      and ensuring the converted dStable asset is sent to the `receiver`.
     * @param dStableAmount The amount of dStable asset to be withdrawn to the `receiver` (after vault fees).
     * @param receiver The address that will receive the withdrawn dStable asset.
     * @param owner The original owner initiating the withdrawal (typically the user burning shares).
     */
    function withdraw(uint256 dStableAmount, address receiver, address owner) external;
}
