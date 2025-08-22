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
import {IERC4626} from "contracts/vaults/atoken_wrapper/interfaces/IERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ERC4626RateProviderWrapperWithThresholding
 * @notice Composes an ERC4626 vault share->assets conversion with a generic rate provider, with optional thresholding per leg.
 *         Resulting price is scaled to BASE_CURRENCY_UNIT.
 *  
 * First leg (share -> assets): uses convertToAssets, scaled into BASE_CURRENCY_UNIT using underlying token decimals (assumes underlying unit corresponds to base unit).
 * Second leg: arbitrary unit rate from a rate provider, scaled by provided rateProviderUnit into BASE_CURRENCY_UNIT.
 *
 * Example for wstkscUSD -> scUSD:
 *  - feed1: ERC4626 vault for wstkscUSD -> stkscUSD (6 decimals typical)
 *  - rateProvider: AccountantWithFixedRate (stkscUSD -> scUSD) returning a rate with `rateProviderUnit` decimals
 *  - price(asset) = ERC4626(wstkscUSD/stkscUSD in base) * RP(stkscUSD/scUSD in base) / BASE_CURRENCY_UNIT
 */
contract ERC4626SafeRateProviderWrapperWithThresholding is IOracleWrapper, AccessControl, ThresholdingUtils {
    // Base currency settings
    address private immutable _baseCurrency;
    uint256 public immutable BASE_CURRENCY_UNIT;

    // Roles
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");
    struct FeedConfig {
        address erc4626Vault; // ERC4626 vault (shares token)
        address rateProvider; // IRateProvider
        uint256 rateProviderUnit; // e.g., 1e6 if rate provider outputs 6-decimals
        ThresholdConfig primaryThreshold;   // Optional thresholding for ERC4626 leg (in BASE_CURRENCY_UNIT)
        ThresholdConfig secondaryThreshold; // Optional thresholding for rate provider leg (in BASE_CURRENCY_UNIT)
    }

    mapping(address => FeedConfig) public feeds; // asset -> config

    event FeedSet(
        address indexed asset,
        address erc4626Vault,
        address rateProvider,
        uint256 rateProviderUnit,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    );

    event FeedRemoved(address indexed asset);

    event FeedUpdated(
        address indexed asset,
        uint256 rateProviderUnit,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    );

    error InvalidUnit();
    error PriceIsStale();
    error FeedNotSet(address asset);

    constructor(address baseCurrency, uint256 _baseCurrencyUnit) {
        _baseCurrency = baseCurrency;
        BASE_CURRENCY_UNIT = _baseCurrencyUnit;
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
        uint256 rateProviderUnit,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (rateProviderUnit == 0) revert InvalidUnit();
        feeds[asset] = FeedConfig({
            erc4626Vault: erc4626Vault,
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
        emit FeedSet(
            asset,
            erc4626Vault,
            rateProvider,
            rateProviderUnit,
            lowerThresholdInBase1,
            fixedPriceInBase1,
            lowerThresholdInBase2,
            fixedPriceInBase2
        );
    }

    function removeFeed(address asset) external onlyRole(ORACLE_MANAGER_ROLE) {
        delete feeds[asset];
        emit FeedRemoved(asset);
    }

    function updateFeed(
        address asset,
        uint256 rateProviderUnit,
        uint256 lowerThresholdInBase1,
        uint256 fixedPriceInBase1,
        uint256 lowerThresholdInBase2,
        uint256 fixedPriceInBase2
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (rateProviderUnit == 0) revert InvalidUnit();
        FeedConfig storage cfg = feeds[asset];
        if (cfg.erc4626Vault == address(0) || cfg.rateProvider == address(0)) {
            revert FeedNotSet(asset);
        }
        cfg.rateProviderUnit = rateProviderUnit;
        cfg.primaryThreshold.lowerThresholdInBase = lowerThresholdInBase1;
        cfg.primaryThreshold.fixedPriceInBase = fixedPriceInBase1;
        cfg.secondaryThreshold.lowerThresholdInBase = lowerThresholdInBase2;
        cfg.secondaryThreshold.fixedPriceInBase = fixedPriceInBase2;
        emit FeedUpdated(
            asset,
            rateProviderUnit,
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
        FeedConfig memory cfg = feeds[asset];
        if (cfg.erc4626Vault == address(0) || cfg.rateProvider == address(0)) {
            revert FeedNotSet(asset);
        }

        IERC4626 vault = IERC4626(cfg.erc4626Vault);

        uint8 sharesDecimals = IERC20Metadata(cfg.erc4626Vault).decimals();
        uint256 sharesUnit = 10 ** sharesDecimals;
        uint256 assetsPerOneShare = vault.convertToAssets(sharesUnit);

        // Normalize assets to BASE_CURRENCY_UNIT using underlying decimals
        address underlying = vault.asset();
        uint8 underlyingDecimals = IERC20Metadata(underlying).decimals();
        uint256 priceInBase1 = (assetsPerOneShare * BASE_CURRENCY_UNIT) / (10 ** underlyingDecimals) ;

        // Rate provider leg with arbitrary unit
        uint256 rate = IRateProviderSafe(cfg.rateProvider).getRateSafe();
        uint256 priceInBase2 = (rate * BASE_CURRENCY_UNIT) / cfg.rateProviderUnit;

        // Apply optional thresholding (in BASE_CURRENCY_UNIT) per leg
        if (cfg.primaryThreshold.lowerThresholdInBase > 0) {
            priceInBase1 = _applyThreshold(priceInBase1, cfg.primaryThreshold);
        }
        if (cfg.secondaryThreshold.lowerThresholdInBase > 0) {
            priceInBase2 = _applyThreshold(priceInBase2, cfg.secondaryThreshold);
        }

        // Compose into BASE_CURRENCY_UNIT
        price = (priceInBase1 * priceInBase2) / BASE_CURRENCY_UNIT;

        // Liveness: price > 0 and rate > 0 (no heartbeat for ERC4626 leg)
        isAlive = price > 0 && rate > 0;
    }

    function getAssetPrice(address asset) external view override returns (uint256) {
        (uint256 p, bool alive) = getPriceInfo(asset);
        if (!alive) revert PriceIsStale();
        return p;
    }


}


