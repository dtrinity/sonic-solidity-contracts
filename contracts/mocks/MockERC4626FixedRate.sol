// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title MockERC4626FixedRate
 * @dev Minimal mock exposing ERC4626-compatible methods used by the oracle wrapper.
 *      convertToAssets(shares) = shares * rate / UNIT
 */
contract MockERC4626FixedRate {
    address private immutable _asset;
    uint256 public immutable UNIT;
    uint256 public rate;

    constructor(address asset_, uint256 unit_, uint256 initialRate_) {
        _asset = asset_;
        UNIT = unit_;
        rate = initialRate_;
    }

    function setRate(uint256 newRate) external {
        rate = newRate;
    }

    function asset() external view returns (address) {
        return _asset;
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return (shares * rate) / UNIT;
    }

    function decimals() external view returns (uint8) {
        return IERC20Metadata(_asset).decimals(); // Shares decimals match underlying
    }
}


