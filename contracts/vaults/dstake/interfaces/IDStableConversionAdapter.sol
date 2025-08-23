// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDStableConversionAdapter Interface
 * @notice Interface for contracts that handle the conversion between the core dStable asset
 *         and a specific yield-bearing or convertible ERC20 token (`vault asset`), as well as
 *         valuing that `vault asset` in terms of the dStable asset.
 * @dev Implementations interact with specific protocols (lending pools, DEX LPs, wrappers, etc.).
 */
interface IDStableConversionAdapter {
    /**
     * @notice Converts a specified amount of the dStable asset into the specific `vaultAsset`
     *         managed by this adapter.
     * @dev The adapter MUST pull `dStableAmount` of the dStable asset from the caller (expected to be the Router).
     * @dev The resulting `vaultAsset` MUST be sent/deposited/minted directly to the `collateralVault` address provided during adapter setup or retrieved.
     * @param dStableAmount The amount of dStable asset to convert.
     * @return vaultAsset The address of the specific `vault asset` token managed by this adapter.
     * @return vaultAssetAmount The amount of `vaultAsset` generated from the conversion.
     */
    function convertToVaultAsset(
        uint256 dStableAmount
    ) external returns (address vaultAsset, uint256 vaultAssetAmount);

    /**
     * @notice Converts a specific amount of `vaultAsset` back into the dStable asset.
     * @dev The adapter MUST pull the required amount of `vaultAsset` from the caller (expected to be the Router).
     * @dev The resulting dStable asset MUST be sent to the caller.
     * @param vaultAssetAmount The amount of `vaultAsset` to convert.
     * @return dStableAmount The amount of dStable asset sent to the caller.
     */
    function convertFromVaultAsset(
        uint256 vaultAssetAmount
    ) external returns (uint256 dStableAmount);

    /**
     * @notice Preview the result of converting a given dStable amount to vaultAsset (without state change).
     * @param dStableAmount The amount of dStable asset to preview conversion for.
     * @return vaultAsset The address of the specific `vault asset` token managed by this adapter.
     * @return vaultAssetAmount The amount of `vaultAsset` that would be received.
     */
    function previewConvertToVaultAsset(
        uint256 dStableAmount
    ) external view returns (address vaultAsset, uint256 vaultAssetAmount);

    /**
     * @notice Preview the result of converting a given vaultAsset amount to dStable (without state change).
     * @param vaultAssetAmount The amount of `vaultAsset` to preview conversion for.
     * @return dStableAmount The amount of dStable asset that would be received.
     */
    function previewConvertFromVaultAsset(
        uint256 vaultAssetAmount
    ) external view returns (uint256 dStableAmount);

    /**
     * @notice Calculates the value of a given amount of the specific `vaultAsset` managed by this adapter
     *         in terms of the dStable asset.
     * @param vaultAsset The address of the vault asset token (should match getVaultAsset()). Included for explicitness.
     * @param vaultAssetAmount The amount of the `vaultAsset` to value.
     * @return dStableValue The equivalent value in the dStable asset.
     */
    function assetValueInDStable(
        address vaultAsset,
        uint256 vaultAssetAmount
    ) external view returns (uint256 dStableValue);

    /**
     * @notice Returns the address of the specific `vault asset` token managed by this adapter.
     * @return The address of the `vault asset`.
     */
    function vaultAsset() external view returns (address);
}
