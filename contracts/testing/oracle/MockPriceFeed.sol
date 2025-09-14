// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../oracle_aggregator/interface/chainlink/IPriceFeed.sol";

/**
 * @title MockPriceFeed
 * @dev Mock price feed for testing purposes
 */
contract MockPriceFeed is IPriceFeed {
    uint256 private _price;
    uint8 private _decimals;
    uint80 private _roundId;
    uint256 private _updatedAt;

    constructor(uint256 /* unit */, uint256 initialPrice) {
        _decimals = 8; // Default to 8 decimals like Chainlink
        _price = initialPrice;
        _roundId = 1;
        _updatedAt = block.timestamp;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, int256(_price), _updatedAt, _updatedAt, _roundId);
    }

    function setPrice(uint256 newPrice) external {
        _price = newPrice;
        _roundId++;
        _updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 timestamp) external {
        _updatedAt = timestamp;
    }

    function latestAnswer() external view returns (uint256) {
        return _price;
    }

    function getPrice() external view returns (uint256) {
        return _price;
    }
}
