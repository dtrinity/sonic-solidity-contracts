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

import "../interface/IOracleWrapper.sol";

contract HardPegOracleWrapper is IOracleWrapper {
    uint256 public immutable pricePeg;
    address public immutable BASE_CURRENCY;

    uint256 public BASE_CURRENCY_UNIT;

    constructor(address _baseCurrency, uint256 _baseCurrencyUnit, uint256 _pricePeg) {
        BASE_CURRENCY = _baseCurrency;
        BASE_CURRENCY_UNIT = _baseCurrencyUnit;
        pricePeg = _pricePeg;
    }

    /**
     * @dev Get the price info of an asset
     */
    function getPriceInfo(
        address // asset
    ) external view returns (uint256 price, bool isAlive) {
        return (pricePeg, true);
    }

    /**
     * @dev Get the price of an asset
     */
    function getAssetPrice(
        address // asset
    ) external view override returns (uint256) {
        return pricePeg;
    }
}
