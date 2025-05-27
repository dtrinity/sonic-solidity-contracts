// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IDPoolLPAdapter
 * @notice Standard interface for converting base asset <=> specific LP tokens and valuing LP tokens
 * @dev Each DEX type (Curve, Uniswap, etc.) implements this interface for LP token interactions
 */
interface IDPoolLPAdapter {
    /**
     * @notice Converts base asset into LP token
     * @dev Pulls base asset from caller, sends LP tokens to collateral vault
     * @param baseAssetAmount Amount of base asset to convert
     * @param minLPAmount Minimum LP tokens expected (slippage protection)
     * @return lpToken Address of the LP token received
     * @return lpAmount Amount of LP tokens received
     */
    function convertToLP(
        uint256 baseAssetAmount,
        uint256 minLPAmount
    ) external returns (address lpToken, uint256 lpAmount);

    /**
     * @notice Converts LP token back to base asset
     * @dev Pulls LP tokens from caller, sends base asset to caller
     * @param lpAmount Amount of LP tokens to convert
     * @param minBaseAssetAmount Minimum base asset expected (slippage protection)
     * @return baseAssetAmount Amount of base asset received
     */
    function convertFromLP(
        uint256 lpAmount,
        uint256 minBaseAssetAmount
    ) external returns (uint256 baseAssetAmount);

    /**
     * @notice Preview conversion of base asset to LP tokens
     * @param baseAssetAmount Amount of base asset to convert
     * @return lpToken Address of the LP token that would be received
     * @return lpAmount Amount of LP tokens that would be received
     */
    function previewConvertToLP(
        uint256 baseAssetAmount
    ) external view returns (address lpToken, uint256 lpAmount);

    /**
     * @notice Preview conversion of LP tokens to base asset
     * @param lpAmount Amount of LP tokens to convert
     * @return baseAssetAmount Amount of base asset that would be received
     */
    function previewConvertFromLP(
        uint256 lpAmount
    ) external view returns (uint256 baseAssetAmount);

    /**
     * @notice Calculates the value of LP tokens in terms of base asset
     * @param lpToken Address of the LP token (should match this adapter's LP token)
     * @param lpAmount Amount of LP tokens to value
     * @return baseAssetValue Value of LP tokens in base asset terms
     */
    function lpValueInBaseAsset(
        address lpToken,
        uint256 lpAmount
    ) external view returns (uint256 baseAssetValue);

    /**
     * @notice Returns the specific LP token address managed by this adapter
     * @return lpToken Address of the LP token this adapter handles
     */
    function lpToken() external view returns (address lpToken);

    /**
     * @notice Returns the base asset address used for conversions
     * @return baseAsset Address of the base asset
     */
    function baseAsset() external view returns (address baseAsset);

    /**
     * @notice Returns the collateral vault address where LP tokens are sent
     * @return collateralVault Address of the collateral vault
     */
    function collateralVault() external view returns (address collateralVault);
}
