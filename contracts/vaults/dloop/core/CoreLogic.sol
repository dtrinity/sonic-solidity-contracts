// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * This library contains the stateless implementation of the DLoopCore logic
 */
library CoreLogic {
    error CollateralLessThanDebt(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    );
    error InvalidLeverage(uint256 leverageBps);

    /**
     * @dev Gets the current leverage in basis points
     * @param totalCollateralBase The total collateral in base currency
     * @param totalDebtBase The total debt in base currency
     * @return uint256 The current leverage in basis points
     */
    function getCurrentLeverageBps(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    ) public pure returns (uint256) {
        if (totalCollateralBase < totalDebtBase) {
            revert CollateralLessThanDebt(totalCollateralBase, totalDebtBase);
        }
        if (totalCollateralBase == 0) {
            return 0;
        }
        if (totalCollateralBase == totalDebtBase) {
            return type(uint256).max; // infinite leverage
        }
        // The leverage will be 1 if totalDebtBase is 0 (no more debt)
        uint256 leverageBps = ((totalCollateralBase *
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
            (totalCollateralBase - totalDebtBase));
        if (leverageBps < BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert InvalidLeverage(leverageBps);
        }
        return leverageBps;
    }

    /**
     * @dev Gets the current subsidy in basis points
     * @param currentLeverageBps The current leverage in basis points
     * @param targetLeverageBps The target leverage in basis points
     * @param maxSubsidyBps The maximum subsidy in basis points
     * @return uint256 The current subsidy in basis points
     */
    function getCurrentSubsidyBps(
        uint256 currentLeverageBps,
        uint256 targetLeverageBps,
        uint256 maxSubsidyBps
    ) public pure returns (uint256) {
        uint256 subsidyBps;
        if (currentLeverageBps > targetLeverageBps) {
            subsidyBps =
                ((currentLeverageBps - targetLeverageBps) *
                    BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
                targetLeverageBps;
        } else {
            subsidyBps =
                ((targetLeverageBps - currentLeverageBps) *
                    BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) /
                targetLeverageBps;
        }
        if (subsidyBps > maxSubsidyBps) {
            return maxSubsidyBps;
        }
        return subsidyBps;
    }

    /**
     * @dev Converts an amount in base currency to the actual amount in the token
     * @param amountInBase Amount in base currency
     * @param tokenDecimals The decimals of the token
     * @param tokenPriceInBase The price of the token in base currency
     * @return amountInToken Amount in the token
     */
    function convertFromBaseCurrencyToToken(
        uint256 amountInBase,
        uint256 tokenDecimals,
        uint256 tokenPriceInBase
    ) public pure returns (uint256) {
        // The price decimals is cancelled out in the division (as the amount and price are in the same unit)
        return Math.mulDiv(amountInBase, 10 ** tokenDecimals, tokenPriceInBase);
    }

    /**
     * @dev Converts an amount in the token to the actual amount in base currency
     * @param amountInToken Amount in the token
     * @param tokenDecimals The decimals of the token
     * @param tokenPriceInBase The price of the token in base currency
     * @return amountInBase Amount in base currency
     */
    function convertFromTokenAmountToBaseCurrency(
        uint256 amountInToken,
        uint256 tokenDecimals,
        uint256 tokenPriceInBase
    ) public pure returns (uint256) {
        // The token decimals is cancelled out in the division (as the amount and price are in the same unit)
        return
            Math.mulDiv(amountInToken, tokenPriceInBase, 10 ** tokenDecimals);
    }

    /**
     * @dev Returns whether the current leverage is too imbalanced
     * @param currentLeverageBps The current leverage in basis points
     * @param lowerBoundTargetLeverageBps The lower bound of the target leverage in basis points
     * @param upperBoundTargetLeverageBps The upper bound of the target leverage in basis points
     * @return bool True if leverage is too imbalanced, false otherwise
     */
    function isTooImbalanced(
        uint256 currentLeverageBps,
        uint256 lowerBoundTargetLeverageBps,
        uint256 upperBoundTargetLeverageBps
    ) public pure returns (bool) {
        // If there is no deposit yet, we don't need to rebalance, thus it is not too imbalanced
        return
            currentLeverageBps != 0 &&
            (currentLeverageBps < lowerBoundTargetLeverageBps ||
                currentLeverageBps > upperBoundTargetLeverageBps);
    }

    /**
     * @dev Calculates the unleveraged amount of the assets with the current leverage
     * @param leveragedAssets Amount of leveraged assets
     * @param leverageBps The leverage in basis points
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssetsWithLeverage(
        uint256 leveragedAssets,
        uint256 leverageBps
    ) public pure returns (uint256) {
        return
            Math.mulDiv(
                leveragedAssets,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                leverageBps
            );
    }

    /**
     * @dev Calculates the leveraged amount of the assets with the target leverage
     * @param assets Amount of assets
     * @param leverageBps The leverage in basis points
     * @return leveragedAssets Amount of leveraged assets
     */
    function getLeveragedAssetsWithLeverage(
        uint256 assets,
        uint256 leverageBps
    ) public pure returns (uint256) {
        return
            Math.mulDiv(
                assets,
                leverageBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }
}
