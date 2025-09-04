// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../oracle_aggregator/interface/chainlink/IAggregatorV3Interface.sol";
import "../oracle_aggregator/interface/chainlink/IPriceFeedLegacy.sol";

/**
 * @title MockDecimalConverterAggregatorWithLegacy
 * @notice Mock implementation that supports both AggregatorV3Interface and IPriceFeedLegacy
 * @dev Implements both modern and legacy Chainlink interfaces for testing decimal conversion
 */
contract MockDecimalConverterAggregatorWithLegacy is AggregatorV3Interface, IPriceFeedLegacy {
    uint8 private _decimals;
    string private _description;
    uint256 private _version;

    struct RoundData {
        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    RoundData private _latestRoundData;

    constructor(
        uint8 decimals_,
        string memory description_,
        uint256 version_,
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        _decimals = decimals_;
        _description = description_;
        _version = version_;
        _latestRoundData = RoundData({
            roundId: roundId,
            answer: answer,
            startedAt: startedAt,
            updatedAt: updatedAt,
            answeredInRound: answeredInRound
        });
    }

    // AggregatorV3Interface functions
    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external view override returns (string memory) {
        return _description;
    }

    function version() external view override returns (uint256) {
        return _version;
    }

    function getRoundData(
        uint80 /* _roundId */
    )
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        // For simplicity, return the same data regardless of roundId
        return (
            _latestRoundData.roundId,
            _latestRoundData.answer,
            _latestRoundData.startedAt,
            _latestRoundData.updatedAt,
            _latestRoundData.answeredInRound
        );
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (
            _latestRoundData.roundId,
            _latestRoundData.answer,
            _latestRoundData.startedAt,
            _latestRoundData.updatedAt,
            _latestRoundData.answeredInRound
        );
    }

    // IPriceFeedLegacy functions
    function latestRound() external view override returns (uint80) {
        return _latestRoundData.roundId;
    }

    function latestAnswer() external view override returns (int256) {
        return _latestRoundData.answer;
    }

    // Helper function for testing to update the round data
    function updateRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        _latestRoundData = RoundData({
            roundId: roundId,
            answer: answer,
            startedAt: startedAt,
            updatedAt: updatedAt,
            answeredInRound: answeredInRound
        });
    }
}
