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

import { IProxy } from "../interface/api3/IProxy.sol";
import "../interface/api3/BaseAPI3Wrapper.sol";

/**
 * @title API3Wrapper
 * @dev Implementation of IAPI3Wrapper for standard API3 oracles
 */
contract API3Wrapper is BaseAPI3Wrapper {
    mapping(address => IProxy) public assetToProxy;

    error ProxyNotSet(address asset);

    constructor(address baseCurrency, uint256 _baseCurrencyUnit) BaseAPI3Wrapper(baseCurrency, _baseCurrencyUnit) {}

    function getPriceInfo(address asset) public view virtual override returns (uint256 price, bool isAlive) {
        IProxy api3Proxy = assetToProxy[asset];
        if (address(api3Proxy) == address(0)) {
            revert ProxyNotSet(asset);
        }

        (int224 value, uint32 timestamp) = api3Proxy.read();
        price = value > 0 ? uint256(uint224(value)) : 0;

        isAlive = price > 0 && timestamp + API3_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;

        price = _convertToBaseCurrencyUnit(price);
    }

    function setProxy(address asset, address proxy) external onlyRole(ORACLE_MANAGER_ROLE) {
        assetToProxy[asset] = IProxy(proxy);
    }
}
