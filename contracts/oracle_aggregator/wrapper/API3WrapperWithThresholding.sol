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

import "./API3Wrapper.sol";
import "./ThresholdingUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract API3WrapperWithThresholding is API3Wrapper, ThresholdingUtils {
    /* State */
    mapping(address => ThresholdConfig) public assetThresholds;

    /* Events */
    event ThresholdConfigSet(address indexed asset, uint256 lowerThresholdInBase, uint256 fixedPriceInBase);
    event ThresholdConfigRemoved(address indexed asset);

    constructor(address baseCurrency, uint256 _baseCurrencyUnit) API3Wrapper(baseCurrency, _baseCurrencyUnit) {}

    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        (price, isAlive) = super.getPriceInfo(asset);
        if (isAlive) {
            ThresholdConfig memory config = assetThresholds[asset];
            if (config.lowerThresholdInBase > 0) {
                price = _applyThreshold(price, config);
            }
        }
    }

    function setThresholdConfig(
        address asset,
        uint256 lowerThresholdInBase,
        uint256 fixedPriceInBase
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        assetThresholds[asset] = ThresholdConfig({
            lowerThresholdInBase: lowerThresholdInBase,
            fixedPriceInBase: fixedPriceInBase
        });
        emit ThresholdConfigSet(asset, lowerThresholdInBase, fixedPriceInBase);
    }

    function removeThresholdConfig(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete assetThresholds[asset];
        emit ThresholdConfigRemoved(asset);
    }
}
