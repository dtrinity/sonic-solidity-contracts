// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IDPoolRouter
 * @notice Interface for the dPOOL router that handles asset conversion routing
 * @dev Converts base asset <=> LP tokens via adapters with slippage protection
 */
interface IDPoolRouter {
    /**
     * @notice Converts base asset to LP tokens and deposits to collateral vault
     * @dev Only callable by DPoolToken contract
     * @param baseAssetAmount Amount of base asset to convert
     * @param receiver Address that will receive the vault shares (for event tracking)
     * @param minLPAmount Minimum LP tokens expected (slippage protection)
     */
    function deposit(
        uint256 baseAssetAmount,
        address receiver,
        uint256 minLPAmount
    ) external;

    /**
     * @notice Withdraws LP tokens from collateral vault and converts to base asset
     * @dev Only callable by DPoolToken contract
     * @param baseAssetAmount Amount of base asset to withdraw
     * @param receiver Address to receive the base asset
     * @param owner Address that owns the vault shares
     * @param maxSlippage Maximum allowed slippage in basis points
     */
    function withdraw(
        uint256 baseAssetAmount,
        address receiver,
        address owner,
        uint256 maxSlippage
    ) external;

    /**
     * @notice Adds support for a new LP token adapter
     * @dev Only callable by governance
     * @param lpToken Address of the LP token
     * @param adapterAddress Address of the adapter contract
     */
    function addLPAdapter(
        address lpToken,
        address adapterAddress
    ) external;

    /**
     * @notice Removes support for an LP token adapter
     * @dev Only callable by governance
     * @param lpToken Address of the LP token
     */
    function removeLPAdapter(address lpToken) external;

    /**
     * @notice Sets the default LP token for new deposits
     * @dev Only callable by governance
     * @param lpToken Address of the LP token to use as default
     */
    function setDefaultDepositLP(address lpToken) external;

    /**
     * @notice Sets the maximum allowed slippage for conversions
     * @dev Only callable by governance
     * @param newMaxSlippageBps Maximum slippage in basis points
     */
    function setMaxSlippageBps(uint256 newMaxSlippageBps) external;

    /**
     * @notice Returns the DPoolToken address
     * @return poolToken Address of the pool token
     */
    function poolToken() external view returns (address poolToken);

    /**
     * @notice Returns the collateral vault address
     * @return collateralVault Address of the collateral vault
     */
    function collateralVault() external view returns (address collateralVault);

    /**
     * @notice Returns the base asset address
     * @return baseAsset Address of the base asset
     */
    function baseAsset() external view returns (address baseAsset);

    /**
     * @notice Returns the adapter address for a given LP token
     * @param lpToken Address of the LP token
     * @return adapter Address of the adapter contract
     */
    function lpAdapters(address lpToken) external view returns (address adapter);

    /**
     * @notice Returns the default LP token for deposits
     * @return defaultLP Address of the default LP token
     */
    function defaultDepositLP() external view returns (address defaultLP);

    /**
     * @notice Returns the maximum allowed slippage
     * @return maxSlippage Maximum slippage in basis points
     */
    function maxSlippageBps() external view returns (uint256 maxSlippage);

    // Events
    event LPAdapterAdded(address indexed lpToken, address indexed adapter);
    event LPAdapterRemoved(address indexed lpToken);
    event DefaultDepositLPUpdated(address indexed oldLP, address indexed newLP);
    event MaxSlippageUpdated(uint256 oldSlippage, uint256 newSlippage);
    event Deposit(address indexed user, address indexed receiver, uint256 baseAssetAmount, uint256 lpAmount);
    event Withdraw(address indexed user, address indexed receiver, address indexed owner, uint256 baseAssetAmount, uint256 lpAmount);
} 