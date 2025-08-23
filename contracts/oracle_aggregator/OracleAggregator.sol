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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interface/IOracleWrapper.sol";

/**
 * @title OracleAggregator
 * @notice Aggregates price data from multiple oracles
 * @dev Implements IPriceOracleGetter for compatibility with Aave
 */
contract OracleAggregator is AccessControl, IOracleWrapper {
    /* Core state */

    /// @notice Mapping from asset address to oracle address
    mapping(address => address) public assetOracles;

    /// @notice 1 Unit of base currency (10^priceDecimals)
    uint256 public immutable baseCurrencyUnit;

    /// @notice Address representing the base currency
    address public immutable baseCurrency;

    /* Events */

    event OracleUpdated(address indexed asset, address indexed oracle);

    /* Roles */

    /// @notice Role for managing oracles
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    /* Errors */
    error UnexpectedBaseUnit(address asset, address oracle, uint256 expectedBaseUnit, uint256 oracleBaseUnit);
    error OracleNotSet(address asset);
    error PriceNotAlive(address asset);

    /**
     * @notice Constructor to initialize the OracleAggregator
     * @param _baseCurrency Address of the base currency
     * @param _baseCurrencyUnit Number of decimal places for price values
     */
    constructor(address _baseCurrency, uint256 _baseCurrencyUnit) {
        baseCurrency = _baseCurrency;
        baseCurrencyUnit = _baseCurrencyUnit;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    /**
     * @notice Sets the oracle for a specific asset
     * @param asset Address of the asset
     * @param oracle Address of the oracle for the asset
     */
    function setOracle(address asset, address oracle) external onlyRole(ORACLE_MANAGER_ROLE) {
        uint256 oracleBaseUnit = IOracleWrapper(oracle).BASE_CURRENCY_UNIT();
        if (oracleBaseUnit != baseCurrencyUnit) {
            revert UnexpectedBaseUnit(asset, oracle, baseCurrencyUnit, oracleBaseUnit);
        }
        assetOracles[asset] = oracle;
        emit OracleUpdated(asset, oracle);
    }

    /**
     * @notice Removes the oracle for a specific asset
     * @param asset Address of the asset
     */
    function removeOracle(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        assetOracles[asset] = address(0);
        emit OracleUpdated(asset, address(0));
    }

    /**
     * @notice Returns the base currency
     * @return Address representing the base currency
     */
    function BASE_CURRENCY() external view returns (address) {
        return baseCurrency;
    }

    /**
     * @notice Returns the base currency unit
     * @return Base currency unit (10^priceDecimals)
     */
    function BASE_CURRENCY_UNIT() external view returns (uint256) {
        return baseCurrencyUnit;
    }

    /**
     * @notice Gets the price of an asset
     * @param asset Address of the asset
     * @return Price of the asset
     */
    function getAssetPrice(address asset) external view returns (uint256) {
        (uint256 price, bool isAlive) = getPriceInfo(asset);
        if (!isAlive) {
            revert PriceNotAlive(asset);
        }
        return price;
    }

    /**
     * @notice Gets the price info of an asset
     * @param asset Address of the asset
     * @return price Price of the asset
     * @return isAlive Whether the price is considered valid
     */
    function getPriceInfo(address asset) public view returns (uint256 price, bool isAlive) {
        address oracle = assetOracles[asset];
        if (oracle == address(0)) {
            revert OracleNotSet(asset);
        }
        return IOracleWrapper(oracle).getPriceInfo(asset);
    }
}
