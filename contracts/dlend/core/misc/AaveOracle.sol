// SPDX-License-Identifier: BUSL-1.1
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

import { Errors } from "../protocol/libraries/helpers/Errors.sol";
import { IACLManager } from "../interfaces/IACLManager.sol";
import { IPoolAddressesProvider } from "../interfaces/IPoolAddressesProvider.sol";
import { IPriceOracleGetter } from "../interfaces/IPriceOracleGetter.sol";
import { IAaveOracle } from "../interfaces/IAaveOracle.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title AaveOracle
 * @author Aave (modified by dTrinity)
 * @notice Contract to get asset prices from OracleAggregator while maintaining Aave interface compatibility
 * @dev This version acts as a proxy to OracleAggregator, removing the original Chainlink integration
 */
contract AaveOracle is IAaveOracle {
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IPriceOracleGetter private immutable _oracleAggregator;
    address public immutable override BASE_CURRENCY;
    uint256 public immutable override BASE_CURRENCY_UNIT;

    // Scaling factor to convert between oracle decimals and target decimals (8)
    uint256 private immutable SCALING_FACTOR;

    /**
     * @dev Only asset listing or pool admin can call functions marked by this modifier.
     */
    modifier onlyAssetListingOrPoolAdmins() {
        _onlyAssetListingOrPoolAdmins();
        _;
    }

    /**
     * @notice Constructor
     * @param provider The address of the new PoolAddressesProvider
     * @param oracleAggregator The address of the OracleAggregator to use
     */
    constructor(IPoolAddressesProvider provider, address oracleAggregator) {
        ADDRESSES_PROVIDER = provider;
        _oracleAggregator = IPriceOracleGetter(oracleAggregator);

        // Use the base currency from OracleAggregator but standardize to 8 decimals
        BASE_CURRENCY = _oracleAggregator.BASE_CURRENCY();
        BASE_CURRENCY_UNIT = 1e8;

        // Calculate scaling factor as ratio between oracle unit and our target unit
        uint256 oracleUnit = _oracleAggregator.BASE_CURRENCY_UNIT();
        require(oracleUnit >= BASE_CURRENCY_UNIT, "AaveOracle: oracle decimals too low");
        SCALING_FACTOR = oracleUnit / BASE_CURRENCY_UNIT;

        emit BaseCurrencySet(BASE_CURRENCY, BASE_CURRENCY_UNIT);
    }

    /// @inheritdoc IAaveOracle
    function setAssetSources(address[] calldata, address[] calldata) external override onlyAssetListingOrPoolAdmins {
        // No-op as we don't manage sources directly anymore
    }

    /// @inheritdoc IAaveOracle
    function setFallbackOracle(address) external override onlyAssetListingOrPoolAdmins {
        // No-op as we don't use fallback oracle anymore
    }

    /// @inheritdoc IPriceOracleGetter
    function getAssetPrice(address asset) public view override returns (uint256) {
        uint256 price = _oracleAggregator.getAssetPrice(asset);
        // Convert from oracle decimals to 8 decimals
        return price / SCALING_FACTOR;
    }

    /// @inheritdoc IAaveOracle
    function getAssetsPrices(address[] calldata assets) external view override returns (uint256[] memory) {
        uint256[] memory prices = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            prices[i] = getAssetPrice(assets[i]);
        }
        return prices;
    }

    /// @inheritdoc IAaveOracle
    function getSourceOfAsset(address) external view override returns (address) {
        return address(_oracleAggregator);
    }

    /// @inheritdoc IAaveOracle
    function getFallbackOracle() external view returns (address) {
        return address(_oracleAggregator);
    }

    function _onlyAssetListingOrPoolAdmins() internal view {
        IACLManager aclManager = IACLManager(ADDRESSES_PROVIDER.getACLManager());
        require(
            aclManager.isAssetListingAdmin(msg.sender) || aclManager.isPoolAdmin(msg.sender),
            Errors.CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN
        );
    }
}
