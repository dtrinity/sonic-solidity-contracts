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

import "../IOracleWrapper.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title BaseChainlinkWrapper
 * @dev Abstract contract that implements the IOracleWrapper interface for Chainlink-style oracles
 * Provides common functionality for all Chainlink-compatible oracle wrappers
 */
abstract contract BaseChainlinkWrapper is IOracleWrapper, AccessControl {
    /* Core state */

    uint256 public constant CHAINLINK_BASE_CURRENCY_UNIT = 10 ** 8; // Chainlink uses 8 decimals
    uint256 public constant CHAINLINK_HEARTBEAT = 24 hours;
    address private immutable _baseCurrency;
    uint256 public immutable BASE_CURRENCY_UNIT;
    uint256 public heartbeatStaleTimeLimit = 30 minutes;

    /* Roles */

    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    /* Errors */

    error PriceIsStale();
    error InvalidPrice();
    error FeedNotSet(address asset);

    /**
     * @dev Constructor that sets the base currency and base currency unit
     * @param baseCurrency The address of the base currency (zero address for USD)
     * @param _baseCurrencyUnit The decimal precision of the base currency (e.g., 1e8 for USD)
     */
    constructor(address baseCurrency, uint256 _baseCurrencyUnit) {
        _baseCurrency = baseCurrency;
        BASE_CURRENCY_UNIT = _baseCurrencyUnit;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    /**
     * @notice Returns the base currency address
     * @return Returns the base currency address
     */
    function BASE_CURRENCY() external view override returns (address) {
        return _baseCurrency;
    }

    /**
     * @notice Gets the price information for an asset
     * @param asset The address of the asset to get the price for
     * @return price The price of the asset in base currency units
     * @return isAlive Whether the price feed is considered active/valid
     */
    function getPriceInfo(address asset) public view virtual override returns (uint256 price, bool isAlive);

    /**
     * @notice Gets the current price of an asset
     * @param asset The address of the asset to get the price for
     * @return The current price of the asset
     */
    function getAssetPrice(address asset) external view virtual override returns (uint256) {
        (uint256 price, bool isAlive) = getPriceInfo(asset);
        if (!isAlive) {
            revert PriceIsStale();
        }
        return price;
    }

    /**
     * @dev Converts a price from Chainlink decimals to base currency decimals
     * @param price The price in Chainlink decimals
     * @return The price in base currency decimals
     */
    function _convertToBaseCurrencyUnit(uint256 price) internal view returns (uint256) {
        return (price * BASE_CURRENCY_UNIT) / CHAINLINK_BASE_CURRENCY_UNIT;
    }

    /**
     * @notice Sets the heartbeat stale time limit
     * @param _newHeartbeatStaleTimeLimit The new heartbeat stale time limit
     */
    function setHeartbeatStaleTimeLimit(uint256 _newHeartbeatStaleTimeLimit) external onlyRole(ORACLE_MANAGER_ROLE) {
        heartbeatStaleTimeLimit = _newHeartbeatStaleTimeLimit;
    }
}
