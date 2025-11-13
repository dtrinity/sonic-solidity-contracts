// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_\/_/  \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    /\_\   \ \_\ \_\  \ \_\  \ \_\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/    \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
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

import "../interface/chainlink/BaseChainlinkWrapper.sol";
import "./ThresholdingUtils.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import { IPriceFeed } from "../interface/chainlink/IPriceFeed.sol";
import { IRateProvider } from "../interface/IRateProvider.sol";
import { IRateProviderSafe } from "../interface/IRateProviderSafe.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding
 * @notice Composes a Chainlink price feed with a generic rate provider and a USD Chainlink feed,
 *         with optional thresholding on each leg. Resulting price is scaled to BASE_CURRENCY_UNIT.
 *
 * Example for wstkscUSD -> USD:
 *  - feed1: Chainlink EACAggregatorProxy for wstkscUSD -> stkscUSD (8 decimals typical)
 *  - rateProvider: AccountantWithFixedRate (stkscUSD -> scUSD) returning a rate with `rateProviderUnit` decimals
 *  - feed3: Chainlink EACAggregatorProxy for USDC/USD (scUSD -> USD) (8 decimals typical)
 *  - price(asset) = CL(wstkscUSD/stkscUSD in base) * RP(stkscUSD/scUSD in base) * CL(USDC/USD in base) / BASE_CURRENCY_UNIT^2
 */
contract ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding is BaseChainlinkWrapper, ThresholdingUtils {
    struct CompositeFeed {
        address feed1; // Chainlink AggregatorV3-like feed (IPriceFeed) - e.g., wstkscUSD -> stkscUSD
        address rateProvider; // IRateProvider - e.g., stkscUSD -> scUSD
        address feed3; // Chainlink AggregatorV3-like feed (IPriceFeed) - e.g., USDC/USD (scUSD -> USD)
        uint256 rateProviderUnit; // Calculated from asset decimals during setup
        uint8 feed1Decimals; // Cached decimals reported by feed1
        uint256 feed1Unit; // 10 ** feed1Decimals, cached to avoid recomputation
        uint8 feed3Decimals; // Cached decimals reported by feed3
        uint256 feed3Unit; // 10 ** feed3Decimals, cached to avoid recomputation
        ThresholdConfig primaryThreshold; // Optional thresholding for feed1 (in BASE_CURRENCY_UNIT)
        ThresholdConfig secondaryThreshold; // Optional thresholding for rate provider leg (in BASE_CURRENCY_UNIT)
        ThresholdConfig tertiaryThreshold; // Optional thresholding for feed3 (in BASE_CURRENCY_UNIT)
    }

    mapping(address => CompositeFeed) public compositeFeeds;

    /* Events */
    event CompositeFeedAdded(
        address indexed asset,
        address feed1,
        address rateProvider,
        address feed3,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    );
    event CompositeFeedRemoved(address indexed asset);
    event CompositeFeedUpdated(
        address indexed asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    );

    /* Errors */
    error InvalidRateProviderUnit(address asset, uint8 decimals);
    error InvalidFeedDecimals(address feed, uint8 decimals);
    error FeedPriceNotPositive(address feed);
    error FeedDecimalsChanged(address asset, address feed, uint8 expected, uint8 actual);
    error RateProviderReturnedZero(address asset, address rateProvider);

    constructor(address baseCurrency, uint256 _baseCurrencyUnit) BaseChainlinkWrapper(baseCurrency, _baseCurrencyUnit) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    function addCompositeFeed(
        address asset,
        address feed1,
        address rateProvider,
        address feed3,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        // Calculate rateProviderUnit from asset decimals and store for gas efficiency
        uint8 assetDecimals = IERC20Metadata(asset).decimals();
        if (assetDecimals == 0 || assetDecimals > 36) {
            revert InvalidRateProviderUnit(asset, assetDecimals);
        }

        uint8 feed1Decimals = IPriceFeed(feed1).decimals();
        if (feed1Decimals == 0 || feed1Decimals > 36) {
            revert InvalidFeedDecimals(feed1, feed1Decimals);
        }

        uint8 feed3Decimals = IPriceFeed(feed3).decimals();
        if (feed3Decimals == 0 || feed3Decimals > 36) {
            revert InvalidFeedDecimals(feed3, feed3Decimals);
        }

        (, int256 answer1, , , ) = IPriceFeed(feed1).latestRoundData();
        if (answer1 <= 0) {
            revert FeedPriceNotPositive(feed1);
        }

        (, int256 answer3, , , ) = IPriceFeed(feed3).latestRoundData();
        if (answer3 <= 0) {
            revert FeedPriceNotPositive(feed3);
        }

        if (IRateProviderSafe(rateProvider).getRateSafe() == 0) {
            revert RateProviderReturnedZero(asset, rateProvider);
        }

        CompositeFeed storage existingFeed = compositeFeeds[asset];
        existingFeed.feed1 = feed1;
        existingFeed.rateProvider = rateProvider;
        existingFeed.feed3 = feed3;
        existingFeed.rateProviderUnit = 10 ** uint256(assetDecimals);
        existingFeed.feed1Decimals = feed1Decimals;
        existingFeed.feed1Unit = 10 ** uint256(feed1Decimals);
        existingFeed.feed3Decimals = feed3Decimals;
        existingFeed.feed3Unit = 10 ** uint256(feed3Decimals);
        existingFeed.primaryThreshold = ThresholdConfig({
            lowerThresholdInBase: lowerThresholdInBase1,
            fixedPriceInBase: fixedPriceInBase1
        });
        existingFeed.secondaryThreshold = ThresholdConfig({
            lowerThresholdInBase: lowerThresholdInBase2,
            fixedPriceInBase: fixedPriceInBase2
        });
        existingFeed.tertiaryThreshold = ThresholdConfig({
            lowerThresholdInBase: lowerThresholdInBase3,
            fixedPriceInBase: fixedPriceInBase3
        });
        emit CompositeFeedAdded(
            asset,
            feed1,
            rateProvider,
            feed3,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2,
            lowerThresholdInBase3,
            fixedPriceInBase3
        );
    }

    function removeCompositeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete compositeFeeds[asset];
        emit CompositeFeedRemoved(asset);
    }

    function updateCompositeFeed(
        address asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        CompositeFeed storage feed = compositeFeeds[asset];
        if (feed.feed1 == address(0) || feed.rateProvider == address(0) || feed.feed3 == address(0)) {
            revert FeedNotSet(asset);
        }
        uint8 latestDecimals1 = IPriceFeed(feed.feed1).decimals();
        if (latestDecimals1 != feed.feed1Decimals) {
            revert FeedDecimalsChanged(asset, feed.feed1, feed.feed1Decimals, latestDecimals1);
        }
        uint8 latestDecimals3 = IPriceFeed(feed.feed3).decimals();
        if (latestDecimals3 != feed.feed3Decimals) {
            revert FeedDecimalsChanged(asset, feed.feed3, feed.feed3Decimals, latestDecimals3);
        }
        // Recalculate rateProviderUnit from asset decimals for consistency
        uint8 assetDecimals = IERC20Metadata(asset).decimals();
        if (assetDecimals == 0 || assetDecimals > 36) {
            revert InvalidRateProviderUnit(asset, assetDecimals);
        }
        feed.rateProviderUnit = 10 ** assetDecimals;

        feed.primaryThreshold.lowerThresholdInBase = lowerThresholdInBase1;
        feed.primaryThreshold.fixedPriceInBase = fixedPriceInBase1;
        feed.secondaryThreshold.lowerThresholdInBase = lowerThresholdInBase2;
        feed.secondaryThreshold.fixedPriceInBase = fixedPriceInBase2;
        feed.tertiaryThreshold.lowerThresholdInBase = lowerThresholdInBase3;
        feed.tertiaryThreshold.fixedPriceInBase = fixedPriceInBase3;
        emit CompositeFeedUpdated(
            asset,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2,
            lowerThresholdInBase3,
            fixedPriceInBase3
        );
    }

    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        CompositeFeed memory feed = compositeFeeds[asset];
        if (feed.feed1 == address(0) || feed.rateProvider == address(0) || feed.feed3 == address(0)) {
            revert FeedNotSet(asset);
        }

        // Chainlink leg 1 (e.g., wstkscUSD -> stkscUSD)
        (, int256 answer1, , uint256 updatedAt1, ) = IPriceFeed(feed.feed1).latestRoundData();
        uint256 chainlinkPrice1 = answer1 > 0 ? uint256(answer1) : 0;
        uint256 priceInBase1 = Math.mulDiv(chainlinkPrice1, BASE_CURRENCY_UNIT, feed.feed1Unit);

        // Rate provider leg (e.g., stkscUSD -> scUSD) with stored rateProviderUnit
        uint256 feed2 = IRateProviderSafe(feed.rateProvider).getRateSafe();
        uint256 priceInBase2 = Math.mulDiv(feed2, BASE_CURRENCY_UNIT, feed.rateProviderUnit);

        // Chainlink leg 3 (e.g., USDC/USD - scUSD -> USD)
        (, int256 answer3, , uint256 updatedAt3, ) = IPriceFeed(feed.feed3).latestRoundData();
        uint256 chainlinkPrice3 = answer3 > 0 ? uint256(answer3) : 0;
        uint256 priceInBase3 = Math.mulDiv(chainlinkPrice3, BASE_CURRENCY_UNIT, feed.feed3Unit);

        // Apply optional thresholding (in BASE_CURRENCY_UNIT) per leg
        if (feed.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, feed.primaryThreshold);
        }
        if (feed.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, feed.secondaryThreshold);
        }
        if (feed.tertiaryThreshold.lowerThresholdInBase > 0) {
            priceInBase3 = _applyThreshold(priceInBase3, feed.tertiaryThreshold);
        }

        // Compose all three prices: (price1 * price2 * price3) / BASE_CURRENCY_UNIT^2
        // First compose price1 and price2, then multiply by price3
        uint256 intermediatePrice = Math.mulDiv(priceInBase1, priceInBase2, BASE_CURRENCY_UNIT);
        price = Math.mulDiv(intermediatePrice, priceInBase3, BASE_CURRENCY_UNIT);

        // Liveness: Chainlink heartbeats + rate > 0
        isAlive =
            price > 0 &&
            updatedAt1 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp &&
            updatedAt3 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp &&
            feed2 > 0;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 p, bool alive) = getPriceInfo(asset);
        if (!alive) revert PriceIsStale();
        return p;
    }
}

