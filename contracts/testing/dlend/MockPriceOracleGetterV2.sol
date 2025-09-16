// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/vaults/dloop/core/venue/dlend/interface/IPriceOracleGetter.sol";

/**
 * @title MockPriceOracleGetterV2
 * @notice Enhanced mock price oracle for V2 adapter testing
 * @dev Allows zero prices for testing oracle validation logic
 */
contract MockPriceOracleGetterV2 is IPriceOracleGetter {
    mapping(address => uint256) public prices;
    mapping(address => bool) public isPriceSet;

    function setPrice(address asset, uint256 price) external {
        prices[asset] = price;
        isPriceSet[asset] = true;
    }

    function BASE_CURRENCY() external pure override returns (address) {
        return address(0);
    }

    function BASE_CURRENCY_UNIT() external pure override returns (uint256) {
        return 1e8; // 8 decimals for USD base
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        require(isPriceSet[asset], "price not set");
        return prices[asset]; // Can return 0 if explicitly set to 0
    }

    function clearPrice(address asset) external {
        delete prices[asset];
        delete isPriceSet[asset];
    }
}
