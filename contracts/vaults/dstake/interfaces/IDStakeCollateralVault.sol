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
     * @notice Returns the vault asset at `index` from the internal supported list.
     */
    function supportedAssets(uint256 index) external view returns (address);

    /**
     * @notice Returns the entire list of supported vault assets. Convenient for UIs & off-chain analytics.
     */
    function getSupportedAssets() external view returns (address[] memory);

    /**
     * @notice Transfers `amount` of `vaultAsset` from this vault to the `recipient`.
     * @dev Only callable by the registered router.
     * @param vaultAsset The address of the vault asset to send.
     * @param amount The amount to send.
     * @param recipient The address to receive the asset.
     */
    function sendAsset(address vaultAsset, uint256 amount, address recipient) external;

    /**
     * @notice Sets the address of the DStakeRouter contract.
     * @dev Only callable by an address with the DEFAULT_ADMIN_ROLE.
     * @param _newRouter The address of the new router contract.
     */
    function setRouter(address _newRouter) external;

    /**
     * @notice Adds a vault asset to the supported list. Callable only by the router.
     */
    function addSupportedAsset(address vaultAsset) external;

    /**
     * @notice Removes a vault asset from the supported list. Callable only by the router.
     */
    function removeSupportedAsset(address vaultAsset) external;

    /**
     * @notice Emitted when the router address is set.
     * @param router The address of the new router.
     */
    event RouterSet(address indexed router);

    /**
     * @notice Emitted when a new vault asset is added to the supported list.
     */
    event SupportedAssetAdded(address indexed vaultAsset);

    /**
     * @notice Emitted when a vault asset is removed from the supported list.
     */
    event SupportedAssetRemoved(address indexed vaultAsset);
}
