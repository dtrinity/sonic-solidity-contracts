// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\"\_\  \ \_\    \ \_\  \/\_____\    *
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

import "./ThresholdingUtils.sol";
import {IOracleWrapper} from "../interface/IOracleWrapper.sol";
import {IRateProvider} from "../interface/IRateProvider.sol";
import {IRateProviderSafe} from "../interface/IRateProviderSafe.sol";
import {IPriceFeed} from "../interface/chainlink/IPriceFeed.sol";
import {IERC4626} from "contracts/vaults/atoken_wrapper/interfaces/IERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title ERC4626RateProviderThirdFeedWrapperWithThresholding
 * @notice Composes an ERC4626 vault share->assets conversion with a rate provider and a third feed,
 *         with optional thresholding per leg. Resulting price is scaled to BASE_CURRENCY_UNIT.
 *
 * Three-leg composition:
 * 1. ERC4626 leg (shares -> assets): uses convertToAssets, scaled into BASE_CURRENCY_UNIT
 * 2. Rate Provider leg (assets -> intermediate): arbitrary unit rate, scaled by rateProviderUnit
 * 3. Third Feed leg (intermediate -> base): price feed, scaled by thirdFeedUnit
 *
 * Example for wstkscUSD -> USD:
 *  - feed1: ERC4626 vault for wstkscUSD -> stkscUSD (6 decimals typical)
 *  - rateProvider: AccountantWithFixedRate (stkscUSD -> scUSD) returning a rate with `rateProviderUnit` decimals
 *  - thirdFeed: Chainlink feed (scUSD -> USD) returning a price with `thirdFeedUnit` decimals
 *  - price(asset) = ERC4626(wstkscUSD/stkscUSD) * RP(stkscUSD/scUSD) * TF(scUSD/USD) / (BASE_CURRENCY_UNIT * BASE_CURRENCY_UNIT)
 */
contract ERC4626RateProviderThirdFeedWrapperWithThresholding is
    IOracleWrapper,
    AccessControl,
    ThresholdingUtils
{
    // Base currency settings
    address private immutable _baseCurrency;
    uint256 public immutable BASE_CURRENCY_UNIT;

    // Roles
    bytes32 public constant ORACLE_MANAGER_ROLE =
        keccak256("ORACLE_MANAGER_ROLE");

    // Stale timeout configuration
    uint256 public staleTimeoutSeconds = 3600; // Default: 1 hour

    struct ThreeFeedConfig {
        address erc4626Vault; // ERC4626 vault (shares token)
        address rateProvider; // IRateProvider (assets -> intermediate)
        address thirdFeed; // IPriceFeed (intermediate -> base)
        uint256 rateProviderUnit; // Calculated from asset decimals during setup
        uint256 thirdFeedUnit; // Calculated from third feed decimals during setup
        ThresholdConfig primaryThreshold; // Optional thresholding for ERC4626 leg (in BASE_CURRENCY_UNIT)
        ThresholdConfig secondaryThreshold; // Optional thresholding for rate provider leg (in BASE_CURRENCY_UNIT)
        ThresholdConfig tertiaryThreshold; // Optional thresholding for third feed leg (in BASE_CURRENCY_UNIT)
    }

    mapping(address => ThreeFeedConfig) public feeds; // asset -> config

    event FeedSet(
        address indexed asset,
        address erc4626Vault,
        address rateProvider,
        address thirdFeed,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    );

    event FeedRemoved(address indexed asset);

    event FeedUpdated(
        address indexed asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    );

    event StaleTimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);

    error InvalidUnit();
    error PriceIsStale();
    error FeedNotSet(address asset);
    error InvalidStaleTimeout();

    constructor(address baseCurrency, uint256 _baseCurrencyUnit) {
        _baseCurrency = baseCurrency;
        BASE_CURRENCY_UNIT = _baseCurrencyUnit;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    function BASE_CURRENCY() external view returns (address) {
        return _baseCurrency;
    }

    /**
     * @notice Set a three-feed configuration for an asset
     * @param asset The asset address
     * @param erc4626Vault The ERC4626 vault address
     * @param rateProvider The rate provider address (assets -> intermediate)
     * @param thirdFeed The third feed address (intermediate -> base)
     * @param lowerThresholdInBase1 Lower threshold for ERC4626 leg
     * @param fixedPriceInBase1 Fixed price for ERC4626 leg
     * @param lowerThresholdInBase2 Lower threshold for rate provider leg
     * @param fixedPriceInBase2 Fixed price for rate provider leg
     * @param lowerThresholdInBase3 Lower threshold for third feed leg
     * @param fixedPriceInBase3 Fixed price for third feed leg
     */
    function setFeed(
        address asset,
        address erc4626Vault,
        address rateProvider,
        address thirdFeed,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        _setFeedConfig(
            asset,
            erc4626Vault,
            rateProvider,
            thirdFeed,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2,
            lowerThresholdInBase3,
            fixedPriceInBase3
        );

        emit FeedSet(
            asset,
            erc4626Vault,
            rateProvider,
            thirdFeed,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2,
            lowerThresholdInBase3,
            fixedPriceInBase3
        );
    }

    function _setFeedConfig(
        address asset,
        address erc4626Vault,
        address rateProvider,
        address thirdFeed,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    ) private {
        ThreeFeedConfig storage config = feeds[asset];
        
        // Set basic addresses
        config.erc4626Vault = erc4626Vault;
        config.rateProvider = rateProvider;
        config.thirdFeed = thirdFeed;
        
        // Calculate and set units
        config.rateProviderUnit = 10 ** IERC20Metadata(asset).decimals();
        config.thirdFeedUnit = 10 ** IPriceFeed(thirdFeed).decimals();
        
        // Set thresholds
        config.primaryThreshold.lowerThresholdInBase = lowerThresholdInBase1;
        config.primaryThreshold.fixedPriceInBase = fixedPriceInBase1;
        config.secondaryThreshold.lowerThresholdInBase = lowerThresholdInBase2;
        config.secondaryThreshold.fixedPriceInBase = fixedPriceInBase2;
        config.tertiaryThreshold.lowerThresholdInBase = lowerThresholdInBase3;
        config.tertiaryThreshold.fixedPriceInBase = fixedPriceInBase3;
    }

    function removeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete feeds[asset];
        emit FeedRemoved(asset);
    }

    /**
     * @notice Update the stale timeout for third feed liveness checks
     * @param newTimeoutSeconds New timeout in seconds (0 to disable stale checks)
     */
    function setStaleTimeout(uint256 newTimeoutSeconds) external onlyRole(ORACLE_MANAGER_ROLE) {
        // Allow 0 to disable stale checks, but require reasonable maximum (30 days)
        if (newTimeoutSeconds > 30 * 24 * 3600) {
            revert InvalidStaleTimeout();
        }
        
        uint256 oldTimeout = staleTimeoutSeconds;
        staleTimeoutSeconds = newTimeoutSeconds;
        emit StaleTimeoutUpdated(oldTimeout, newTimeoutSeconds);
    }

    /**
     * @notice Update thresholding parameters for an existing feed
     * @param asset The asset address
     * @param lowerThresholdInBase1 Lower threshold for ERC4626 leg
     * @param fixedPriceInBase1 Fixed price for ERC4626 leg
     * @param lowerThresholdInBase2 Lower threshold for rate provider leg
     * @param fixedPriceInBase2 Fixed price for rate provider leg
     * @param lowerThresholdInBase3 Lower threshold for third feed leg
     * @param fixedPriceInBase3 Fixed price for third feed leg
     */
    function updateFeed(
        address asset,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2,
        uint256 lowerThresholdInBase3,
        uint256 fixedPriceInBase3
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        ThreeFeedConfig storage cfg = feeds[asset];
        if (cfg.erc4626Vault == address(0) || cfg.rateProvider == address(0) || cfg.thirdFeed == address(0)) {
            revert FeedNotSet(asset);
        }

        // Recalculate units from decimals for consistency
        uint256 assetDecimals = IERC20Metadata(asset).decimals();
        cfg.rateProviderUnit = 10 ** assetDecimals;

        uint256 thirdFeedDecimals = IPriceFeed(cfg.thirdFeed).decimals();
        cfg.thirdFeedUnit = 10 ** thirdFeedDecimals;

        cfg.primaryThreshold.lowerThresholdInBase = lowerThresholdInBase1;
        cfg.primaryThreshold.fixedPriceInBase = fixedPriceInBase1;
        cfg.secondaryThreshold.lowerThresholdInBase = lowerThresholdInBase2;
        cfg.secondaryThreshold.fixedPriceInBase = fixedPriceInBase2;
        cfg.tertiaryThreshold.lowerThresholdInBase = lowerThresholdInBase3;
        cfg.tertiaryThreshold.fixedPriceInBase = fixedPriceInBase3;

        emit FeedUpdated(
            asset,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2,
            lowerThresholdInBase3,
            fixedPriceInBase3
        );
    }

    /**
     * @notice Get price information for an asset using three-feed composition
     * @param asset The asset address
     * @return price The composed price in BASE_CURRENCY_UNIT
     * @return isAlive Whether all feeds are alive and returning valid data
     */
    function getPriceInfo(
        address asset
    ) public view override returns (uint256 price, bool isAlive) {
        ThreeFeedConfig memory cfg = feeds[asset];
        if (cfg.erc4626Vault == address(0) || cfg.rateProvider == address(0) || cfg.thirdFeed == address(0)) {
            revert FeedNotSet(asset);
        }

        // First leg: ERC4626 vault (shares -> assets)
        uint256 priceInBase1 = _getERC4626Price(cfg.erc4626Vault);

        // Second leg: Rate provider (assets -> intermediate)
        uint256 priceInBase2 = _getRateProviderPrice(cfg.rateProvider, cfg.rateProviderUnit);

        // Third leg: Third feed (intermediate -> base)
        (uint256 priceInBase3, bool thirdFeedAlive) = _getThirdFeedPrice(cfg.thirdFeed, cfg.thirdFeedUnit);

        // Apply optional thresholding (in BASE_CURRENCY_UNIT) per leg
        if (cfg.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, cfg.primaryThreshold);
        }
        if (cfg.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, cfg.secondaryThreshold);
        }
        if (cfg.tertiaryThreshold.lowerThresholdInBase > 0) {
            priceInBase3 = _applyThreshold(priceInBase3, cfg.tertiaryThreshold);
        }

        // Three-leg composition: (leg1 * leg2 * leg3) / (BASE_UNIT * BASE_UNIT)
        uint256 intermediatePrice = Math.mulDiv(priceInBase1, priceInBase2, BASE_CURRENCY_UNIT);
        price = Math.mulDiv(intermediatePrice, priceInBase3, BASE_CURRENCY_UNIT);

        // Liveness: price > 0 and all feeds are alive
        isAlive = price > 0 && thirdFeedAlive;
    }

    function _getERC4626Price(address vaultAddress) private view returns (uint256) {
        IERC4626 vault = IERC4626(vaultAddress);
        uint256 sharesDecimals = IERC20Metadata(vaultAddress).decimals();
        uint256 sharesUnit = 10 ** sharesDecimals;
        uint256 assetsPerOneShare = vault.convertToAssets(sharesUnit);

        address underlying = vault.asset();
        uint256 underlyingDecimals = IERC20Metadata(underlying).decimals();
        return Math.mulDiv(
            assetsPerOneShare,
            BASE_CURRENCY_UNIT,
            10 ** underlyingDecimals
        );
    }

    function _getRateProviderPrice(address rateProvider, uint256 rateProviderUnit) private view returns (uint256) {
        uint256 rate = IRateProviderSafe(rateProvider).getRateSafe();
        return Math.mulDiv(
            rate,
            BASE_CURRENCY_UNIT,
            rateProviderUnit
        );
    }

    function _getThirdFeedPrice(address thirdFeed, uint256 thirdFeedUnit) private view returns (uint256 price, bool isAlive) {
        (, int256 thirdFeedAnswer, , uint256 thirdFeedUpdatedAt, ) = IPriceFeed(thirdFeed).latestRoundData();
        uint256 thirdFeedPrice = uint256(thirdFeedAnswer);
        
        price = Math.mulDiv(
            thirdFeedPrice,
            BASE_CURRENCY_UNIT,
            thirdFeedUnit
        );

        // Check if third feed is stale based on configurable timeout
        bool thirdFeedNotStale = staleTimeoutSeconds == 0 || 
            (block.timestamp - thirdFeedUpdatedAt <= staleTimeoutSeconds);
        isAlive = thirdFeedPrice > 0 && thirdFeedNotStale;
    }

    function getAssetPrice(
        address asset
    ) external view override returns (uint256) {
        (uint256 p, bool alive) = getPriceInfo(asset);
        if (!alive) revert PriceIsStale();
        return p;
    }
}
