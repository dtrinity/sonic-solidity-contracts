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

import "../interface/chainlink/IAggregatorV3Interface.sol";

/**
 * @title ChainlinkDecimalConverter
 * @notice Converts between Chainlink price feeds with different decimal precisions
 * @dev Implements AggregatorV3Interface to mimic being a Chainlink price feed
 */
contract ChainlinkDecimalConverter is AggregatorV3Interface {
    /// @notice Original Chainlink price feed
    AggregatorV3Interface public immutable sourceFeed;

    /// @notice Original decimals from the source feed
    uint8 public immutable sourceDecimals;

    /// @notice Target decimals for price conversion
    uint8 public immutable override decimals;

    /// @notice Scaling factor to convert between source and target decimals
    int256 private immutable scalingFactor;

    /**
     * @notice Error thrown when target decimals exceed source decimals
     */
    error InvalidDecimalsUpscaleNotSupported();

    /**
     * @notice Constructor to initialize the decimal converter
     * @param _sourceFeed Address of the source Chainlink price feed
     * @param _targetDecimals Target decimal precision (must be less than or equal to source decimals)
     */
    constructor(address _sourceFeed, uint8 _targetDecimals) {
        sourceFeed = AggregatorV3Interface(_sourceFeed);
        sourceDecimals = sourceFeed.decimals();
        decimals = _targetDecimals;

        // We only support downscaling (reducing precision), not upscaling
        if (_targetDecimals > sourceDecimals) {
            revert InvalidDecimalsUpscaleNotSupported();
        }

        // Calculate the scaling factor to convert from source to target decimals
        uint8 decimalDifference = sourceDecimals - _targetDecimals;
        scalingFactor = int256(10 ** decimalDifference);
    }

    /**
     * @notice Returns the description of the original feed
     * @return Description string
     */
    function description() external view override returns (string memory) {
        return sourceFeed.description();
    }

    /**
     * @notice Returns the version of the original feed
     * @return Version number
     */
    function version() external view override returns (uint256) {
        return sourceFeed.version();
    }

    /**
     * @notice Gets data for a specific round
     * @param _roundId The round ID to retrieve data for
     * @return roundId The round ID
     * @return answer The price with adjusted decimals
     * @return startedAt The timestamp when the round started
     * @return updatedAt The timestamp when the round was updated
     * @return answeredInRound The round in which the answer was computed
     */
    function getRoundData(
        uint80 _roundId
    )
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = sourceFeed.getRoundData(_roundId);
        answer = answer / scalingFactor;
    }

    /**
     * @notice Gets data for the latest round
     * @return roundId The round ID
     * @return answer The price with adjusted decimals
     * @return startedAt The timestamp when the round started
     * @return updatedAt The timestamp when the round was updated
     * @return answeredInRound The round in which the answer was computed
     */
    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (roundId, answer, startedAt, updatedAt, answeredInRound) = sourceFeed.latestRoundData();
        answer = answer / scalingFactor;
    }
}
