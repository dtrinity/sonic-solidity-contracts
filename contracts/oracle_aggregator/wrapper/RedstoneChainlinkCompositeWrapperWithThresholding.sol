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

import "../interface/chainlink/BaseChainlinkWrapper.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import { IPriceFeed } from "../interface/chainlink/IPriceFeed.sol";
import "./ThresholdingUtils.sol";

/**
 * @title RedstoneChainlinkCompositeWrapperWithThresholding
 * @dev Implementation of BaseChainlinkWrapper for composite Redstone oracles with thresholding
 */
contract RedstoneChainlinkCompositeWrapperWithThresholding is BaseChainlinkWrapper, ThresholdingUtils {
    /* Core state */

    struct CompositeFeed {
        address feed1;
        address feed2;
        ThresholdConfig primaryThreshold; // Primary price source threshold config
        ThresholdConfig secondaryThreshold; // Secondary price source threshold config
    }

    mapping(address => CompositeFeed) public compositeFeeds;

    /* Events */

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

    constructor(address baseCurrency, uint256 _baseCurrencyUnit) BaseChainlinkWrapper(baseCurrency, _baseCurrencyUnit) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
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
        compositeFeeds[asset] = CompositeFeed({
            feed1: feed1,
            feed2: feed2,
            primaryThreshold: ThresholdConfig({
                lowerThresholdInBase: lowerThresholdInBase1,
                fixedPriceInBase: fixedPriceInBase1
            }),
            secondaryThreshold: ThresholdConfig({
                lowerThresholdInBase: lowerThresholdInBase2,
                fixedPriceInBase: fixedPriceInBase2
            })
        });
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
        CompositeFeed memory feed = compositeFeeds[asset];
        if (feed.feed1 == address(0) || feed.feed2 == address(0)) {
            revert FeedNotSet(asset);
        }

        (, int256 answer1, , uint256 updatedAt1, ) = IPriceFeed(feed.feed1).latestRoundData();

        (, int256 answer2, , uint256 updatedAt2, ) = IPriceFeed(feed.feed2).latestRoundData();

        uint256 chainlinkPrice1 = answer1 > 0 ? uint256(answer1) : 0;
        uint256 chainlinkPrice2 = answer2 > 0 ? uint256(answer2) : 0;

        // Convert both prices to BASE_CURRENCY_UNIT first
        uint256 priceInBase1 = _convertToBaseCurrencyUnit(chainlinkPrice1);
        uint256 priceInBase2 = _convertToBaseCurrencyUnit(chainlinkPrice2);

        // Apply thresholding to prices in BASE_CURRENCY_UNIT if specified
        if (feed.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, feed.primaryThreshold);
        }
        if (feed.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, feed.secondaryThreshold);
        }

        price = (priceInBase1 * priceInBase2) / BASE_CURRENCY_UNIT;
        isAlive =
            price > 0 &&
            updatedAt1 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp &&
            updatedAt2 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 price, bool isAlive) = getPriceInfo(asset);
        if (!isAlive) {
            revert PriceIsStale();
        }
        return price;
    }
}
