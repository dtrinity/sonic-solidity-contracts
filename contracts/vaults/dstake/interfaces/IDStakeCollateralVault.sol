// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDStakeCollateralVault Interface
 * @notice Defines the external functions of the DStakeCollateralVault required by other
 *         contracts in the dSTAKE system, primarily the DStakeToken.
 */
interface IDStakeCollateralVault {
    /**
     * @notice Calculates the total value of all managed `vault assets` held by the vault,
     *         denominated in the underlying dStable asset.
     * @dev This is typically called by the DStakeToken's `totalAssets()` function.
     * @return dStableValue The total value of managed assets in terms of the dStable asset.
     */
    function totalValueInDStable() external view returns (uint256 dStableValue);

    /**
     * @notice Returns the address of the underlying dStable asset the vault operates with.
     * @return The address of the dStable asset.
     */
    function dStable() external view returns (address);

    /**
     * @notice The DStakeToken contract address this vault serves.
     */
    function dStakeToken() external view returns (address);

    /**
     * @notice The DStakeRouter contract address allowed to interact.
     */
    function router() external view returns (address);

    /**
     * @notice Mapping from vault asset address to its corresponding IDStableConversionAdapter address.
     */
    function adapterForAsset(address) external view returns (address);

    /**
     * @notice List of supported vault assets.
     */
    function supportedAssets(uint256 index) external view returns (address);

    /**
     * @notice Transfers `amount` of `vaultAsset` from this vault to the `recipient`.
     * @dev Only callable by the registered router.
     * @param vaultAsset The address of the vault asset to send.
     * @param amount The amount to send.
     * @param recipient The address to receive the asset.
     */
    function sendAsset(
        address vaultAsset,
        uint256 amount,
        address recipient
    ) external;

    /**
     * @notice Sets the address of the DStakeRouter contract.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @param _newRouter The address of the new router contract.
     */
    function setRouter(address _newRouter) external;

    /**
     * @notice Adds support for a new `vaultAsset` and its associated conversion adapter.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @param vaultAsset The address of the new vault asset to support.
     * @param adapterAddress The address of the IDStableConversionAdapter for this asset.
     */
    function addAdapter(address vaultAsset, address adapterAddress) external;

    /**
     * @notice Removes support for a `vaultAsset` and its adapter.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @dev Requires the vault to hold zero balance of the asset being removed.
     * @param vaultAsset The address of the vault asset to remove support for.
     */
    function removeAdapter(address vaultAsset) external;

    /**
     * @notice Emitted when the router address is set.
     * @param router The address of the new router.
     */
    event RouterSet(address indexed router);

    /**
     * @notice Emitted when support for a new adapter is added.
     * @param vaultAsset The address of the supported vault asset.
     * @param adapter The address of the adapter for the asset.
     */
    event AdapterAdded(address indexed vaultAsset, address indexed adapter);

    /**
     * @notice Emitted when support for an adapter is removed.
     * @param vaultAsset The address of the vault asset whose adapter was removed.
     */
    event AdapterRemoved(address indexed vaultAsset);
}
