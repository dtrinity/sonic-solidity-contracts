// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interface/chainlink/BaseChainlinkWrapper.sol";
import { IPriceFeed } from "../interface/chainlink/IPriceFeed.sol";
import "./ThresholdingUtils.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title ChainlinkWrapperWithThresholding
 * @notice Chainlink-compatible oracle wrapper with optional thresholding.
 * @dev Supports both a single-feed path and a two-feed composite path. This avoids
 *      deploying decimal-converter feeds when Chainlink-compatible sources report
 *      non-8-decimal answers.
 */
contract ChainlinkWrapperWithThresholding is BaseChainlinkWrapper, ThresholdingUtils {
    struct FeedConfig {
        address feed;
        uint8 feedDecimals;
        uint256 feedUnit;
        ThresholdConfig threshold;
    }

    struct CompositeFeed {
        address feed1;
        address feed2;
        uint8 feed1Decimals;
        uint256 feed1Unit;
        uint8 feed2Decimals;
        uint256 feed2Unit;
        ThresholdConfig primaryThreshold;
        ThresholdConfig secondaryThreshold;
    }

    mapping(address => FeedConfig) public assetToFeed;
    mapping(address => CompositeFeed) public compositeFeeds;

    event FeedSet(address indexed asset, address feed);
    event FeedRemoved(address indexed asset);
    event ThresholdConfigSet(address indexed asset, uint256 lowerThresholdInBase, uint256 fixedPriceInBase);
    event ThresholdConfigRemoved(address indexed asset);
    event CompositeFeedAdded(
        address indexed asset,
        address feed1,
        address feed2,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    );
    event CompositeFeedRemoved(address indexed asset);
    event CompositeFeedUpdated(
        address indexed asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    );

    error InvalidFeedDecimals(address feed, uint8 decimals);
    error FeedPriceNotPositive(address feed);
    error FeedDecimalsChanged(address asset, address feed, uint8 expected, uint8 actual);

    constructor(address baseCurrency, uint256 baseCurrencyUnit) BaseChainlinkWrapper(baseCurrency, baseCurrencyUnit) {}

    function setFeed(address asset, address feed) external onlyRole(ORACLE_MANAGER_ROLE) {
        (uint8 feedDecimals, uint256 feedUnit) = _validateFeed(feed);
        FeedConfig storage config = assetToFeed[asset];
        config.feed = feed;
        config.feedDecimals = feedDecimals;
        config.feedUnit = feedUnit;
        delete compositeFeeds[asset];
        emit FeedSet(asset, feed);
    }

    function removeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete assetToFeed[asset];
        delete compositeFeeds[asset];
        emit FeedRemoved(asset);
    }

    function setThresholdConfig(
        address asset,
        uint256 lowerThresholdInBase,
        uint256 fixedPriceInBase
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        FeedConfig storage config = assetToFeed[asset];
        if (config.feed == address(0)) {
            revert FeedNotSet(asset);
        }
        _checkCachedDecimals(asset, config.feed, config.feedDecimals);
        config.threshold = ThresholdConfig({
            lowerThresholdInBase: lowerThresholdInBase,
            fixedPriceInBase: fixedPriceInBase
        });
        emit ThresholdConfigSet(asset, lowerThresholdInBase, fixedPriceInBase);
    }

    function removeThresholdConfig(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete assetToFeed[asset].threshold;
        emit ThresholdConfigRemoved(asset);
    }

    function addCompositeFeed(
        address asset,
        address feed1,
        address feed2,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        (uint8 feed1Decimals, uint256 feed1Unit) = _validateFeed(feed1);
        (uint8 feed2Decimals, uint256 feed2Unit) = _validateFeed(feed2);

        compositeFeeds[asset] = CompositeFeed({
            feed1: feed1,
            feed2: feed2,
            feed1Decimals: feed1Decimals,
            feed1Unit: feed1Unit,
            feed2Decimals: feed2Decimals,
            feed2Unit: feed2Unit,
            primaryThreshold: ThresholdConfig({
                lowerThresholdInBase: lowerThresholdInBase1,
                fixedPriceInBase: fixedPriceInBase1
            }),
            secondaryThreshold: ThresholdConfig({
                lowerThresholdInBase: lowerThresholdInBase2,
                fixedPriceInBase: fixedPriceInBase2
            })
        });
        delete assetToFeed[asset];

        emit CompositeFeedAdded(
            asset,
            feed1,
            feed2,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2
        );
    }

    function removeCompositeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete assetToFeed[asset];
        delete compositeFeeds[asset];
        emit CompositeFeedRemoved(asset);
    }

    function updateCompositeFeed(
        address asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        CompositeFeed storage feed = compositeFeeds[asset];
        if (feed.feed1 == address(0) || feed.feed2 == address(0)) {
            revert FeedNotSet(asset);
        }
        _checkCachedDecimals(asset, feed.feed1, feed.feed1Decimals);
        _checkCachedDecimals(asset, feed.feed2, feed.feed2Decimals);

        feed.primaryThreshold.lowerThresholdInBase = lowerThresholdInBase1;
        feed.primaryThreshold.fixedPriceInBase = fixedPriceInBase1;
        feed.secondaryThreshold.lowerThresholdInBase = lowerThresholdInBase2;
        feed.secondaryThreshold.fixedPriceInBase = fixedPriceInBase2;
        emit CompositeFeedUpdated(
            asset,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2
        );
    }

    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        CompositeFeed memory compositeFeed = compositeFeeds[asset];
        if (compositeFeed.feed1 != address(0) || compositeFeed.feed2 != address(0)) {
            if (compositeFeed.feed1 == address(0) || compositeFeed.feed2 == address(0)) {
                revert FeedNotSet(asset);
            }
            return _getCompositePriceInfo(asset, compositeFeed);
        }

        FeedConfig memory feed = assetToFeed[asset];
        if (feed.feed == address(0)) {
            revert FeedNotSet(asset);
        }
        return _getSinglePriceInfo(asset, feed);
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 p, bool alive) = getPriceInfo(asset);
        if (!alive) revert PriceIsStale();
        return p;
    }

    function _getSinglePriceInfo(
        address asset,
        FeedConfig memory feed
    ) private view returns (uint256 price, bool isAlive) {
        _checkCachedDecimals(asset, feed.feed, feed.feedDecimals);

        (, int256 answer, , uint256 updatedAt, ) = IPriceFeed(feed.feed).latestRoundData();
        if (answer <= 0) {
            return (0, false);
        }

        price = Math.mulDiv(uint256(answer), BASE_CURRENCY_UNIT, feed.feedUnit);
        if (feed.threshold.lowerThresholdInBase > 0) {
            price = _applyThreshold(price, feed.threshold);
        }

        isAlive = price > 0 && updatedAt + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;
    }

    function _getCompositePriceInfo(
        address asset,
        CompositeFeed memory feed
    ) private view returns (uint256 price, bool isAlive) {
        _checkCachedDecimals(asset, feed.feed1, feed.feed1Decimals);
        _checkCachedDecimals(asset, feed.feed2, feed.feed2Decimals);

        (, int256 answer1, , uint256 updatedAt1, ) = IPriceFeed(feed.feed1).latestRoundData();
        (, int256 answer2, , uint256 updatedAt2, ) = IPriceFeed(feed.feed2).latestRoundData();

        if (answer1 <= 0 || answer2 <= 0) {
            return (0, false);
        }

        uint256 priceInBase1 = Math.mulDiv(uint256(answer1), BASE_CURRENCY_UNIT, feed.feed1Unit);
        uint256 priceInBase2 = Math.mulDiv(uint256(answer2), BASE_CURRENCY_UNIT, feed.feed2Unit);

        if (feed.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, feed.primaryThreshold);
        }
        if (feed.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, feed.secondaryThreshold);
        }

        price = Math.mulDiv(priceInBase1, priceInBase2, BASE_CURRENCY_UNIT);
        isAlive =
            price > 0 &&
            updatedAt1 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp &&
            updatedAt2 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;
    }

    function _validateFeed(address feed) private view returns (uint8 feedDecimals, uint256 feedUnit) {
        feedDecimals = IPriceFeed(feed).decimals();
        if (feedDecimals == 0 || feedDecimals > 36) {
            revert InvalidFeedDecimals(feed, feedDecimals);
        }

        (, int256 answer, , , ) = IPriceFeed(feed).latestRoundData();
        if (answer <= 0) {
            revert FeedPriceNotPositive(feed);
        }

        feedUnit = 10 ** uint256(feedDecimals);
    }

    function _checkCachedDecimals(address asset, address feed, uint8 expectedDecimals) private view {
        uint8 latestDecimals = IPriceFeed(feed).decimals();
        if (latestDecimals != expectedDecimals) {
            revert FeedDecimalsChanged(asset, feed, expectedDecimals, latestDecimals);
        }
    }
}
