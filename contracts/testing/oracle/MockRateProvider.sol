// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../oracle_aggregator/interface/IRateProvider.sol";
import "../../oracle_aggregator/interface/IRateProviderSafe.sol";

contract MockRateProvider is IRateProvider, IRateProviderSafe {
    uint256 public rate; // raw integer in UNIT decimals (e.g., 6 decimals -> 980150 for 0.980150)
    uint256 public immutable UNIT; // scaling factor (e.g., 1e6 for 6 decimals)

    constructor(uint256 _unit, uint256 _initialRate) {
        require(_unit > 0, "unit=0");
        UNIT = _unit;
        rate = _initialRate;
    }

    function getRate() external view override returns (uint256) {
        return rate;
    }

    function getRateSafe() external view override returns (uint256) {
        return rate;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }
}
