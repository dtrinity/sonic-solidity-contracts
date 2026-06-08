// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ThresholdingUtils.sol";
import { IOracleWrapper } from "../interface/IOracleWrapper.sol";
import { IPriceFeed } from "../interface/chainlink/IPriceFeed.sol";
import { IRateProviderSafe } from "../interface/IRateProviderSafe.sol";
import { IERC4626 } from "contracts/vaults/atoken_wrapper/interfaces/IERC4626.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title ERC4626RateProviderThirdFeedWrapperWithThresholding
 * @notice Composes:
 * 1. ERC4626 share -> underlying asset conversion
 * 2. rate-provider conversion for the underlying -> intermediate asset
 * 3. third-feed conversion for the intermediate asset -> base currency
 *
 * This is the deployed Sonic pattern for pricing wstkscUSD in USD:
 * wstkscUSD -> stkscUSD -> scUSD -> USD.
 */
contract ERC4626RateProviderThirdFeedWrapperWithThresholding is IOracleWrapper, AccessControl, ThresholdingUtils {
    address private immutable _baseCurrency;
    uint256 public immutable BASE_CURRENCY_UNIT;

    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");

    uint256 public constant CHAINLINK_HEARTBEAT = 24 hours;
    uint256 public heartbeatStaleTimeLimit = 30 minutes;

    struct ThreeFeedConfig {
        address erc4626Vault;
        address rateProvider;
        address thirdFeed;
        uint256 rateProviderUnit;
        uint256 thirdFeedUnit;
        ThresholdConfig primaryThreshold;
        ThresholdConfig secondaryThreshold;
        ThresholdConfig tertiaryThreshold;
    }

    mapping(address => ThreeFeedConfig) public feeds;

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
    event HeartbeatStaleTimeLimitUpdated(uint256 oldLimit, uint256 newLimit);

    error FeedNotSet(address asset);
    error PriceIsStale();
    error InvalidDecimals(address target, uint8 decimals);
    error FeedPriceNotPositive(address feed);
    error RateProviderReturnedZero(address asset, address rateProvider);

    constructor(address baseCurrency, uint256 baseCurrencyUnit) {
        _baseCurrency = baseCurrency;
        BASE_CURRENCY_UNIT = baseCurrencyUnit;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_MANAGER_ROLE, msg.sender);
    }

    function BASE_CURRENCY() external view returns (address) {
        return _baseCurrency;
    }

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

    function removeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete feeds[asset];
        emit FeedRemoved(asset);
    }

    function setHeartbeatStaleTimeLimit(uint256 newHeartbeatStaleTimeLimit) external onlyRole(ORACLE_MANAGER_ROLE) {
        uint256 oldLimit = heartbeatStaleTimeLimit;
        heartbeatStaleTimeLimit = newHeartbeatStaleTimeLimit;
        emit HeartbeatStaleTimeLimitUpdated(oldLimit, newHeartbeatStaleTimeLimit);
    }

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

        (uint256 rateProviderUnit, uint256 thirdFeedUnit) = _validateFeedInputs(
            asset,
            cfg.erc4626Vault,
            cfg.rateProvider,
            cfg.thirdFeed
        );
        cfg.rateProviderUnit = rateProviderUnit;
        cfg.thirdFeedUnit = thirdFeedUnit;
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

    function getPriceInfo(address asset) public view override returns (uint256 price, bool isAlive) {
        ThreeFeedConfig memory cfg = feeds[asset];
        if (cfg.erc4626Vault == address(0) || cfg.rateProvider == address(0) || cfg.thirdFeed == address(0)) {
            revert FeedNotSet(asset);
        }

        uint256 priceInBase1 = _getERC4626Price(cfg.erc4626Vault);
        uint256 priceInBase2 = _getRateProviderPrice(cfg.rateProvider, cfg.rateProviderUnit);
        (uint256 priceInBase3, bool thirdFeedAlive) = _getThirdFeedPrice(cfg.thirdFeed, cfg.thirdFeedUnit);

        if (cfg.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, cfg.primaryThreshold);
        }
        if (cfg.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, cfg.secondaryThreshold);
        }
        if (cfg.tertiaryThreshold.lowerThresholdInBase > 0) {
            priceInBase3 = _applyThreshold(priceInBase3, cfg.tertiaryThreshold);
        }

        uint256 intermediatePrice = Math.mulDiv(priceInBase1, priceInBase2, BASE_CURRENCY_UNIT);
        price = Math.mulDiv(intermediatePrice, priceInBase3, BASE_CURRENCY_UNIT);
        isAlive = price > 0 && thirdFeedAlive;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 p, bool alive) = getPriceInfo(asset);
        if (!alive) revert PriceIsStale();
        return p;
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

        (uint256 rateProviderUnit, uint256 thirdFeedUnit) = _validateFeedInputs(
            asset,
            erc4626Vault,
            rateProvider,
            thirdFeed
        );

        config.erc4626Vault = erc4626Vault;
        config.rateProvider = rateProvider;
        config.thirdFeed = thirdFeed;
        config.rateProviderUnit = rateProviderUnit;
        config.thirdFeedUnit = thirdFeedUnit;
        config.primaryThreshold.lowerThresholdInBase = lowerThresholdInBase1;
        config.primaryThreshold.fixedPriceInBase = fixedPriceInBase1;
        config.secondaryThreshold.lowerThresholdInBase = lowerThresholdInBase2;
        config.secondaryThreshold.fixedPriceInBase = fixedPriceInBase2;
        config.tertiaryThreshold.lowerThresholdInBase = lowerThresholdInBase3;
        config.tertiaryThreshold.fixedPriceInBase = fixedPriceInBase3;
    }

    function _validateFeedInputs(
        address asset,
        address erc4626Vault,
        address rateProvider,
        address thirdFeed
    ) private view returns (uint256 rateProviderUnit, uint256 thirdFeedUnit) {
        uint8 assetDecimals = IERC20Metadata(asset).decimals();
        _validateDecimals(asset, assetDecimals);

        uint8 shareDecimals = IERC20Metadata(erc4626Vault).decimals();
        _validateDecimals(erc4626Vault, shareDecimals);

        address underlying = IERC4626(erc4626Vault).asset();
        uint8 underlyingDecimals = IERC20Metadata(underlying).decimals();
        _validateDecimals(underlying, underlyingDecimals);

        uint8 thirdFeedDecimals = IPriceFeed(thirdFeed).decimals();
        _validateDecimals(thirdFeed, thirdFeedDecimals);

        (, int256 answer, , , ) = IPriceFeed(thirdFeed).latestRoundData();
        if (answer <= 0) {
            revert FeedPriceNotPositive(thirdFeed);
        }

        if (IRateProviderSafe(rateProvider).getRateSafe() == 0) {
            revert RateProviderReturnedZero(asset, rateProvider);
        }

        return (10 ** uint256(assetDecimals), 10 ** uint256(thirdFeedDecimals));
    }

    function _validateDecimals(address target, uint8 decimals_) private pure {
        if (decimals_ == 0 || decimals_ > 36) {
            revert InvalidDecimals(target, decimals_);
        }
    }

    function _getERC4626Price(address vaultAddress) private view returns (uint256) {
        IERC4626 vault = IERC4626(vaultAddress);
        uint256 sharesUnit = 10 ** IERC20Metadata(vaultAddress).decimals();
        uint256 assetsPerOneShare = vault.convertToAssets(sharesUnit);
        uint256 underlyingDecimals = IERC20Metadata(vault.asset()).decimals();

        return Math.mulDiv(assetsPerOneShare, BASE_CURRENCY_UNIT, 10 ** underlyingDecimals);
    }

    function _getRateProviderPrice(address rateProvider, uint256 rateProviderUnit) private view returns (uint256) {
        uint256 rate = IRateProviderSafe(rateProvider).getRateSafe();
        return Math.mulDiv(rate, BASE_CURRENCY_UNIT, rateProviderUnit);
    }

    function _getThirdFeedPrice(
        address thirdFeed,
        uint256 thirdFeedUnit
    ) private view returns (uint256 price, bool isAlive) {
        (, int256 answer, , uint256 updatedAt, ) = IPriceFeed(thirdFeed).latestRoundData();
        if (answer <= 0) {
            return (0, false);
        }

        uint256 positiveAnswer = uint256(answer);
        price = Math.mulDiv(positiveAnswer, BASE_CURRENCY_UNIT, thirdFeedUnit);

        bool notStale = updatedAt + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;
        isAlive = positiveAnswer > 0 && notStale;
    }
}
