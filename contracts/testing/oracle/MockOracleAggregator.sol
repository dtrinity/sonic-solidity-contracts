// SPDX-License-Identifier: GPL-2.0-or-later
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

import { IOracleWrapper } from "../../oracle_aggregator/interface/IOracleWrapper.sol";

contract MockOracleAggregator is IOracleWrapper {
    address public immutable BASE_CURRENCY;
    uint256 public immutable BASE_CURRENCY_UNIT;

    mapping(address => uint256) public prices;
    mapping(address => bool) public isAlive;

    constructor(address _baseCurrency, uint256 _baseCurrencyUnit) {
        BASE_CURRENCY = _baseCurrency;
        BASE_CURRENCY_UNIT = _baseCurrencyUnit;
    }

    function setAssetPrice(address _asset, uint256 _price) external {
        if (_asset == BASE_CURRENCY) {
            revert("Cannot set price for base currency");
        }

        prices[_asset] = _price;
        isAlive[_asset] = true;
    }

    function setAssetAlive(address _asset, bool _isAlive) external {
        isAlive[_asset] = _isAlive;
    }

    function getAssetPrice(address _asset) external view override returns (uint256) {
        if (_asset == BASE_CURRENCY) {
            return BASE_CURRENCY_UNIT;
        }

        uint256 _price = prices[_asset];
        require(isAlive[_asset], "Price feed is not alive");

        return _price;
    }

    function getPriceInfo(address _asset) external view override returns (uint256 price, bool _isAlive) {
        if (_asset == BASE_CURRENCY) {
            return (BASE_CURRENCY_UNIT, true);
        }

        price = prices[_asset];
        _isAlive = isAlive[_asset];

        return (price, _isAlive);
    }
}
