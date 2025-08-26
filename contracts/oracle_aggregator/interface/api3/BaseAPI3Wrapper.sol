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
 * @title BaseAPI3Wrapper
 * @dev Abstract contract that implements the IOracleWrapper interface for API3 oracles
 * Provides common functionality for all API3 oracle wrappers
 */
abstract contract BaseAPI3Wrapper is IOracleWrapper, AccessControl {
    /* Core state */

    uint256 public constant API3_BASE_CURRENCY_UNIT = 10 ** 18;
    uint256 public constant API3_HEARTBEAT = 24 hours;
    address private immutable _baseCurrency;
    uint256 public immutable BASE_CURRENCY_UNIT;
    uint256 public heartbeatStaleTimeLimit = 30 minutes;

    /* Roles */

    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    /* Errors */

    error PriceIsStale();

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
     * @return Returns the base currency address.
     */
    function BASE_CURRENCY() external view override returns (address) {
        return _baseCurrency;
    }

    function getPriceInfo(address asset) public view virtual override returns (uint256 price, bool isAlive);

    function getAssetPrice(address asset) external view virtual override returns (uint256) {
        (uint256 price, bool isAlive) = getPriceInfo(asset);
        if (!isAlive) {
            revert PriceIsStale();
        }
        return price;
    }

    function _convertToBaseCurrencyUnit(uint256 price) internal view returns (uint256) {
        return (price * BASE_CURRENCY_UNIT) / API3_BASE_CURRENCY_UNIT;
    }

    function setHeartbeatStaleTimeLimit(uint256 _newHeartbeatStaleTimeLimit) external onlyRole(ORACLE_MANAGER_ROLE) {
        heartbeatStaleTimeLimit = _newHeartbeatStaleTimeLimit;
    }
}
