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

import "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title IDPoolPeriphery
 * @author dTRINITY Protocol
 * @notice Interface for dPOOL periphery contracts that handle asset conversions
 * @dev Periphery contracts convert between pool assets and LP tokens with slippage protection
 */
interface IDPoolPeriphery is IAccessControl {
    // --- Events ---

    /**
     * @notice Emitted when an asset is deposited and converted to vault shares
     * @param user User who deposited
     * @param asset Asset deposited
     * @param assetAmount Amount of asset deposited
     * @param lpAmount Amount of LP tokens minted from asset
     * @param shares Amount of vault shares received
     */
    event AssetDeposited(
        address indexed user,
        address indexed asset,
        uint256 assetAmount,
        uint256 lpAmount,
        uint256 shares
    );

    /**
     * @notice Emitted when vault shares are withdrawn and converted to asset
     * @param user User who withdrew
     * @param asset Asset received
     * @param shares Amount of vault shares burned
     * @param lpAmount Amount of LP tokens withdrawn from vault
     * @param assetAmount Amount of asset received
     */
    event AssetWithdrawn(
        address indexed user,
        address indexed asset,
        uint256 shares,
        uint256 lpAmount,
        uint256 assetAmount
    );

    /**
     * @notice Emitted when maximum slippage is updated
     * @param newMaxSlippage New maximum slippage in basis points
     */
    event MaxSlippageUpdated(uint256 newMaxSlippage);

    /**
     * @notice Emitted when an asset is added to whitelist
     * @param asset Asset added to whitelist
     */
    event AssetWhitelisted(address indexed asset);

    /**
     * @notice Emitted when an asset is removed from whitelist
     * @param asset Asset removed from whitelist
     */
    event AssetRemovedFromWhitelist(address indexed asset);

    // --- Errors ---

    /**
     * @notice Thrown when slippage exceeds maximum allowed
     */
    error ExcessiveSlippage();

    /**
     * @notice Thrown when asset is not whitelisted
     */
    error AssetNotWhitelisted();

    /**
     * @notice Thrown when insufficient output amount
     */
    error InsufficientOutput();

    /**
     * @notice Thrown when invalid asset index
     */
    error InvalidAssetIndex();

    // --- Core Functions ---

    /**
     * @notice Deposit asset, convert to LP, and deposit to vault
     * @param asset Address of asset to deposit
     * @param amount Amount of asset to deposit
     * @param receiver Address to receive vault shares
     * @param minShares Minimum vault shares to receive
     * @param maxSlippage Maximum slippage in basis points
     * @return shares Amount of vault shares received
     */
    function depositAsset(
        address asset,
        uint256 amount,
        address receiver,
        uint256 minShares,
        uint256 maxSlippage
    ) external returns (uint256 shares);

    /**
     * @notice Withdraw from vault and convert LP to asset
     * @param shares Amount of vault shares to burn
     * @param asset Address of asset to receive
     * @param receiver Address to receive asset
     * @param owner Owner of the vault shares
     * @param minAmount Minimum asset amount to receive
     * @param maxSlippage Maximum slippage in basis points
     * @return assetAmount Amount of asset received
     */
    function withdrawToAsset(
        uint256 shares,
        address asset,
        address receiver,
        address owner,
        uint256 minAmount,
        uint256 maxSlippage
    ) external returns (uint256 assetAmount);

    // --- Preview Functions ---

    /**
     * @notice Preview vault shares for asset deposit
     * @param asset Address of asset to deposit
     * @param amount Amount of asset to deposit
     * @return shares Amount of vault shares that would be received
     */
    function previewDepositAsset(address asset, uint256 amount) external view returns (uint256 shares);

    /**
     * @notice Preview asset amount for share withdrawal
     * @param shares Amount of vault shares to withdraw
     * @param asset Address of asset to receive
     * @return assetAmount Amount of asset that would be received
     */
    function previewWithdrawToAsset(uint256 shares, address asset) external view returns (uint256 assetAmount);

    // --- View Functions ---

    /**
     * @notice Get vault address
     * @return Address of the associated vault
     */
    function vault() external view returns (address);

    /**
     * @notice Get DEX pool address
     * @return Address of the DEX pool
     */
    function pool() external view returns (address);

    /**
     * @notice Get maximum allowed slippage
     * @return Maximum slippage in basis points
     */
    function maxSlippageBps() external view returns (uint256);

    /**
     * @notice Check if asset is whitelisted
     * @param asset Address of asset to check
     * @return True if asset is whitelisted
     */
    function isAssetWhitelisted(address asset) external view returns (bool);

    /**
     * @notice Get all whitelisted assets
     * @return Array of whitelisted asset addresses
     */
    function getSupportedAssets() external view returns (address[] memory);

    // --- Admin Functions ---

    /**
     * @notice Add asset to whitelist (admin only)
     * @param asset Address of asset to whitelist
     */
    function addWhitelistedAsset(address asset) external;

    /**
     * @notice Remove asset from whitelist (admin only)
     * @param asset Address of asset to remove
     */
    function removeWhitelistedAsset(address asset) external;

    /**
     * @notice Set maximum slippage (admin only)
     * @param newMaxSlippage New maximum slippage in basis points
     */
    function setMaxSlippage(uint256 newMaxSlippage) external;
} 