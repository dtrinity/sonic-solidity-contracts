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
import "../wrapper/ThresholdingUtils.sol";

/**
 * @title ChainlinkCompositeWrapper
 * @notice Composes prices from two Chainlink price feeds with thresholding
 * @dev Implements AggregatorV3Interface to mimic being a Chainlink price feed
 *      Uses the same composition logic as RedstoneChainlinkCompositeWrapperWithThresholding
 */
contract ChainlinkCompositeWrapper is AggregatorV3Interface, ThresholdingUtils {
    /// @notice First source Chainlink price feed
    AggregatorV3Interface public immutable sourceFeed1;

    /// @notice Second source Chainlink price feed
    AggregatorV3Interface public immutable sourceFeed2;

    /// @notice Target decimals for composite price (same as base currency unit decimals)
    uint8 public immutable override decimals;

    /// @notice Base currency unit for price normalization (same as Redstone wrapper)
    uint256 public immutable baseCurrencyUnit;

    /// @notice Primary threshold configuration for sourceFeed1
    ThresholdConfig public primaryThreshold;

    /// @notice Secondary threshold configuration for sourceFeed2
    ThresholdConfig public secondaryThreshold;

    /// @notice Chainlink heartbeat period (24 hours)
    uint256 public constant CHAINLINK_HEARTBEAT = 86400;

    /// @notice Heartbeat stale time limit (additional buffer)
    uint256 public constant heartbeatStaleTimeLimit = 3600; // 1 hour

    /**
     * @notice Error thrown when price is stale
     */
    error PriceIsStale();

    /**
     * @notice Constructor to initialize the composite wrapper
     * @param _sourceFeed1 Address of the first source Chainlink price feed
     * @param _sourceFeed2 Address of the second source Chainlink price feed
     * @param _targetDecimals Target decimal precision for composite price
     * @param _baseCurrencyUnit Base currency unit for price normalization
     * @param _primaryThreshold Primary threshold configuration for feed1
     * @param _secondaryThreshold Secondary threshold configuration for feed2
     */
    constructor(
        address _sourceFeed1,
        address _sourceFeed2,
        uint8 _targetDecimals,
        uint256 _baseCurrencyUnit,
        ThresholdConfig memory _primaryThreshold,
        ThresholdConfig memory _secondaryThreshold
    ) {
        sourceFeed1 = AggregatorV3Interface(_sourceFeed1);
        sourceFeed2 = AggregatorV3Interface(_sourceFeed2);
        decimals = _targetDecimals;
        baseCurrencyUnit = _baseCurrencyUnit;
        primaryThreshold = _primaryThreshold;
        secondaryThreshold = _secondaryThreshold;
    }

    /**
     * @notice Returns the description of the composite feed
     * @return Description string
     */
    function description() external view override returns (string memory) {
        return
            string(
                abi.encodePacked(
                    sourceFeed1.description(),
                    " x ",
                    sourceFeed2.description(),
                    " (Composite)"
                )
            );
    }

    /**
     * @notice Returns the version of the original feed
     * @return Version number
     */
    function version() external pure override returns (uint256) {
        return 1;
    }

    /**
     * @notice Gets data for a specific round
     * @param _roundId The round ID to retrieve data for
     * @return roundId The round ID
     * @return answer The composite price with target decimals
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
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        // Get data from both feeds for the same round
        (
            ,
            // roundId1,
            int256 answer1,
            uint256 startedAt1,
            uint256 updatedAt1,
            uint80 answeredInRound1
        ) = sourceFeed1.getRoundData(_roundId);

        (
            ,
            // roundId2,
            int256 answer2,
            uint256 startedAt2,
            uint256 updatedAt2,

        ) = // answeredInRound2
            sourceFeed2.getRoundData(_roundId);

        // Use the latest timestamp from both feeds
        uint256 latestUpdatedAt = updatedAt1 > updatedAt2
            ? updatedAt1
            : updatedAt2;
        uint256 latestStartedAt = startedAt1 > startedAt2
            ? startedAt1
            : startedAt2;

        // Calculate composite price using the same logic as Redstone wrapper
        uint256 compositePrice = _calculateCompositePrice(answer1, answer2);

        return (
            _roundId,
            int256(compositePrice),
            latestStartedAt,
            latestUpdatedAt,
            answeredInRound1 // Use the first feed's answeredInRound
        );
    }

    /**
     * @notice Gets data for the latest round
     * @return roundId The round ID
     * @return answer The composite price with target decimals
     * @return startedAt The timestamp when the round started
     * @return updatedAt The timestamp when the round was updated
     * @return answeredInRound The round in which the answer was computed
     */
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
        // Get latest data from both feeds
        (
            uint80 roundId1,
            int256 answer1,
            uint256 startedAt1,
            uint256 updatedAt1,
            uint80 answeredInRound1
        ) = sourceFeed1.latestRoundData();

        (
            ,
            // roundId2,
            int256 answer2,
            uint256 startedAt2,
            uint256 updatedAt2,

        ) = // answeredInRound2
            sourceFeed2.latestRoundData();

        // Check if prices are stale
        if (
            updatedAt1 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit <=
            block.timestamp ||
            updatedAt2 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit <=
            block.timestamp
        ) {
            revert PriceIsStale();
        }

        // Use the latest timestamp from both feeds
        uint256 latestUpdatedAt = updatedAt1 > updatedAt2
            ? updatedAt1
            : updatedAt2;
        uint256 latestStartedAt = startedAt1 > startedAt2
            ? startedAt1
            : startedAt2;

        // Calculate composite price using the same logic as Redstone wrapper
        uint256 compositePrice = _calculateCompositePrice(answer1, answer2);

        return (
            roundId1, // Use the first feed's round ID
            int256(compositePrice),
            latestStartedAt,
            latestUpdatedAt,
            answeredInRound1 // Use the first feed's answeredInRound
        );
    }

    /**
     * @notice Calculate composite price using the same logic as Redstone wrapper
     * @param answer1 Price from first feed
     * @param answer2 Price from second feed
     * @return Composite price in target decimals
     */
    function _calculateCompositePrice(
        int256 answer1,
        int256 answer2
    ) internal view returns (uint256) {
        // Convert negative answers to 0 (same as Redstone wrapper)
        uint256 chainlinkPrice1 = answer1 > 0 ? uint256(answer1) : 0;
        uint256 chainlinkPrice2 = answer2 > 0 ? uint256(answer2) : 0;

        // Convert both prices to base currency unit first
        uint256 priceInBase1 = _convertToBaseCurrencyUnit(
            chainlinkPrice1,
            sourceFeed1.decimals()
        );
        uint256 priceInBase2 = _convertToBaseCurrencyUnit(
            chainlinkPrice2,
            sourceFeed2.decimals()
        );

        // Apply thresholding to prices in base currency unit if specified
        if (primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, primaryThreshold);
        }
        if (secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, secondaryThreshold);
        }

        // Calculate composite price: (price1 * price2) / baseCurrencyUnit
        return (priceInBase1 * priceInBase2) / baseCurrencyUnit;
    }

    /**
     * @notice Convert price to base currency unit (same logic as Redstone wrapper)
     * @param price Price in source decimals
     * @param sourceDecimals Decimal precision of the source price
     * @return Price in base currency unit
     */
    function _convertToBaseCurrencyUnit(
        uint256 price,
        uint8 sourceDecimals
    ) internal view returns (uint256) {
        if (sourceDecimals > decimals) {
            // Scale down to target decimals
            return price / (10 ** (sourceDecimals - decimals));
        } else if (sourceDecimals < decimals) {
            // Scale up to target decimals
            return price * (10 ** (decimals - sourceDecimals));
        }
        return price;
    }
}
