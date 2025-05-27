// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title IDPoolCollateralVault
 * @notice Interface for the dPOOL collateral vault that holds and manages LP tokens
 * @dev Holds various LP tokens that can be priced in the base asset
 */
interface IDPoolCollateralVault {
    /**
     * @notice Returns the total value of all LP tokens held by the vault in base asset terms
     * @dev Iterates through supported LP tokens and calculates their total value
     * @return baseAssetValue Total value in base asset terms
     */
    function getTotalAssetValue() external view returns (uint256 baseAssetValue);

    /**
     * @notice Sends LP tokens from the vault to a recipient
     * @dev Only callable by the router
     * @param lpToken Address of the LP token to send
     * @param amount Amount of LP tokens to send
     * @param recipient Address to receive the LP tokens
     */
    function sendLP(
        address lpToken,
        uint256 amount,
        address recipient
    ) external;

    /**
     * @notice Adds support for a new LP token with its corresponding adapter
     * @dev Only callable by governance
     * @param lpToken Address of the LP token
     * @param adapterAddress Address of the LP adapter contract
     */
    function addLPAdapter(
        address lpToken,
        address adapterAddress
    ) external;

    /**
     * @notice Removes support for an LP token
     * @dev Only callable by governance, requires zero balance of the LP token
     * @param lpToken Address of the LP token to remove
     */
    function removeLPAdapter(address lpToken) external;

    /**
     * @notice Updates the router address
     * @dev Only callable by governance
     * @param newRouter Address of the new router contract
     */
    function setRouter(address newRouter) external;

    /**
     * @notice Returns the base asset address used for pricing
     * @return baseAsset Address of the base asset
     */
    function asset() external view returns (address baseAsset);

    /**
     * @notice Returns the DPoolToken address
     * @return poolToken Address of the pool token
     */
    function poolToken() external view returns (address poolToken);

    /**
     * @notice Returns the router address
     * @return router Address of the current router
     */
    function router() external view returns (address router);

    /**
     * @notice Returns the adapter address for a given LP token
     * @param lpToken Address of the LP token
     * @return adapter Address of the adapter contract
     */
    function adapterForLP(address lpToken) external view returns (address adapter);

    /**
     * @notice Returns the list of supported LP tokens
     * @return lpTokens Array of supported LP token addresses
     */
    function getSupportedLPTokens() external view returns (address[] memory lpTokens);

    /**
     * @notice Returns the balance of a specific LP token held by the vault
     * @param lpToken Address of the LP token
     * @return balance Amount of LP tokens held
     */
    function getLPTokenBalance(address lpToken) external view returns (uint256 balance);

    // Events
    event LPAdapterAdded(address indexed lpToken, address indexed adapter);
    event LPAdapterRemoved(address indexed lpToken);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event LPTokensSent(address indexed lpToken, uint256 amount, address indexed recipient);
} 