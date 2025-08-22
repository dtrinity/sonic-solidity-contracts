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
import {IPriceFeed} from "../interface/chainlink/IPriceFeed.sol";
import {IRateProvider} from "../interface/IRateProvider.sol";
import {IRateProviderSafe} from "../interface/IRateProviderSafe.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// Rate provider interface moved to interface/IRateProvider.sol

/**
 * @title ChainlinkRateProviderCompositeWrapperWithThresholding
 * @notice Composes a Chainlink price feed with a generic rate provider, with optional thresholding
 *         on each leg. Resulting price is scaled to BASE_CURRENCY_UNIT.
 *
 * Example for wstkscUSD -> scUSD:
 *  - feed1: Chainlink EACAggregatorProxy for wstkscUSD -> stkscUSD (8 decimals typical)
 *  - rateProvider: AccountantWithFixedRate (stkscUSD -> scUSD) returning a rate with `rateProviderUnit` decimals
 *  - price(asset) = CL(wstkscUSD/stkscUSD in base) * RP(stkscUSD/scUSD in base) / BASE_CURRENCY_UNIT
 */
contract ChainlinkSafeRateProviderCompositeWrapperWithThresholding is
    BaseChainlinkWrapper,
    ThresholdingUtils
{
    struct CompositeFeed {
        address feed1; // Chainlink AggregatorV3-like feed (IPriceFeed)
        address rateProvider; // IRateProvider
        uint256 rateProviderUnit; // Calculated from asset decimals during setup
        ThresholdConfig primaryThreshold; // Optional thresholding for feed1 (in BASE_CURRENCY_UNIT)
        ThresholdConfig secondaryThreshold; // Optional thresholding for rate provider leg (in BASE_CURRENCY_UNIT)
    }

    mapping(address => CompositeFeed) public compositeFeeds;

    /* Events */
    event CompositeFeedAdded(
        address indexed asset,
        address feed1,
        address rateProvider,
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

    /* Errors */
    error InvalidUnit();

    constructor(address baseCurrency, uint256 _baseCurrencyUnit)
        BaseChainlinkWrapper(baseCurrency, _baseCurrencyUnit)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    function addCompositeFeed(
        address asset,
        address feed1,
        address rateProvider,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        // Calculate rateProviderUnit from asset decimals and store for gas efficiency
        uint256 assetDecimals = IERC20Metadata(asset).decimals();
        uint256 rateProviderUnit = 10 ** assetDecimals;
        
        compositeFeeds[asset] = CompositeFeed({
            feed1: feed1,
            rateProvider: rateProvider,
            rateProviderUnit: rateProviderUnit,
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
            rateProvider,
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
        if (feed.feed1 == address(0) || feed.rateProvider == address(0)) {
            revert FeedNotSet(asset);
        }
        // Recalculate rateProviderUnit from asset decimals for consistency
        uint8 assetDecimals = IERC20Metadata(asset).decimals();
        feed.rateProviderUnit = 10 ** assetDecimals;
        
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

    function getPriceInfo(address asset)
        public
        view
        override
        returns (uint256 price, bool isAlive)
    {
        CompositeFeed memory feed = compositeFeeds[asset];
        if (feed.feed1 == address(0) || feed.rateProvider == address(0)) {
            revert FeedNotSet(asset);
        }

        // Chainlink leg (e.g., wstkscUSD -> stkscUSD)
        (, int256 answer1, , uint256 updatedAt1, ) = IPriceFeed(feed.feed1).latestRoundData();
        uint256 chainlinkPrice1 = answer1 > 0 ? uint256(answer1) : 0;
        uint256 priceInBase1 = _convertToBaseCurrencyUnit(chainlinkPrice1);

        // Rate provider leg (e.g., stkscUSD -> scUSD) with stored rateProviderUnit
        uint256 feed2 = IRateProviderSafe(feed.rateProvider).getRateSafe();
        uint256 priceInBase2 = Math.mulDiv(feed2, BASE_CURRENCY_UNIT, feed.rateProviderUnit);

        // Apply optional thresholding (in BASE_CURRENCY_UNIT) per leg
        if (feed.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, feed.primaryThreshold);
        }
        if (feed.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, feed.secondaryThreshold);
        }

        // Compose, maintaining BASE_CURRENCY_UNIT
        price = Math.mulDiv(priceInBase1, priceInBase2, BASE_CURRENCY_UNIT);

        // Liveness: Chainlink heartbeat + rate > 0
        isAlive = price > 0 &&
            updatedAt1 + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp &&
            feed2 > 0;
    }

  

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 p, bool alive) = getPriceInfo(asset);
        if (!alive) revert PriceIsStale();
        return p;
    }
}


