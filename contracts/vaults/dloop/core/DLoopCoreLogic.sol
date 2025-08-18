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

import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Compare} from "contracts/common/Compare.sol";

/**
 * This library contains the stateless implementation of the DLoopCore logic
 */
library DLoopCoreLogic {
    error CollateralLessThanDebt(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    );
    error InvalidLeverage(uint256 leverageBps);
    error TotalCollateralBaseIsZero();
    error TotalCollateralBaseIsLessThanTotalDebtBase(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    );
    error InputCollateralTokenAmountIsZero();
    error InputDebtTokenAmountIsZero();

    /**
     * @dev Gets the current leverage in basis points
     * @param totalCollateralBase The total collateral in base currency
     * @param totalDebtBase The total debt in base currency
     * @return uint256 The current leverage in basis points
     */
    function getCurrentLeverageBps(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    ) internal pure returns (uint256) {
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
     * @param minDeviationBps The minimum deviation of leverage from the target leverage in basis points
     * @return uint256 The current subsidy in basis points
     */
    function getCurrentSubsidyBps(
        uint256 currentLeverageBps,
        uint256 targetLeverageBps,
        uint256 maxSubsidyBps,
        uint256 minDeviationBps
    ) internal pure returns (uint256) {
        uint256 subsidyBps;
        if (currentLeverageBps > targetLeverageBps) {
            uint256 deviationBps = currentLeverageBps - targetLeverageBps;
            if (deviationBps < minDeviationBps) {
                return 0;
            }
            subsidyBps = Math.mulDiv(
                deviationBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                targetLeverageBps
            );
        } else {
            uint256 deviationBps = targetLeverageBps - currentLeverageBps;
            if (deviationBps < minDeviationBps) {
                return 0;
            }
            subsidyBps = Math.mulDiv(
                deviationBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                targetLeverageBps
            );
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
    ) internal pure returns (uint256) {
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
    ) internal pure returns (uint256) {
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
    ) internal pure returns (bool) {
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
    ) internal pure returns (uint256) {
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
    ) internal pure returns (uint256) {
        return
            Math.mulDiv(
                assets,
                leverageBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }

    /**
     * @dev Gets the repay amount that keeps the current leverage
     * @param targetWithdrawAmount The target withdraw amount
     * @param leverageBpsBeforeRepayDebt The leverage in basis points before repaying debt
     * @param collateralTokenDecimals The decimals of the collateral token
     * @param collateralTokenPriceInBase The price of the collateral token in base currency
     * @param debtTokenDecimals The decimals of the debt token
     * @param debtTokenPriceInBase The price of the debt token in base currency
     * @return repayAmount The repay amount that keeps the current leverage
     */
    function getRepayAmountThatKeepCurrentLeverage(
        uint256 targetWithdrawAmount,
        uint256 leverageBpsBeforeRepayDebt,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) internal pure returns (uint256 repayAmount) {
        /* Formula definition:
         * - C1: totalCollateralBase before repay (in base currency)
         * - D1: totalDebtBase before repay (in base currency)
         * - C2: totalCollateralBase after repay (in base currency)
         * - D2: totalDebtBase after repay (in base currency)
         * - T: target leverage
         * - x: withdraw amount in base currency
         * - y: repay amount in base currency
         *
         * We have:
         *        C1 / (C1-D1) = C2 / (C2-D2)
         *        C2 = C1-x
         *        D2 = D1-y
         *        C1 / (C1-D1) = T <=> C1 = (C1-D1) * T <=> C1 = C1*T - D1*T <=> C1*T - C1 = D1*T <=> C1 = D1*T/(T-1)
         *
         * Formula expression:
         *        C1 / (C1-D1) = (C1-x) / (C1-x-D1+y)
         *    <=> C1 * (C1-x-D1+y) = (C1-x) * (C1-D1)
         *    <=> C1^2 - C1*x - C1*D1 + C1*y = C1^2 - C1*D1 - C1*x + D1*x
         *    <=> C1^2 - C1*x - C1*D1 + C1*y = C1^2 - C1*x - C1*D1 + D1*x
         *    <=> C1*y = x*D1
         *    <=> y = x*D1 / C1
         *    <=> y = x*D1 / [D1*T / (T-1)]
         *    <=> y = x * (T-1)/T
         *
         * Suppose that T' = T * ONE_HUNDRED_PERCENT_BPS, then:
         *
         *  => T = T' / ONE_HUNDRED_PERCENT_BPS
         * where T' is the target leverage in basis points unit
         *
         * We have:
         *      y = x * (T-1)/T
         *  <=> y = x * (T' / ONE_HUNDRED_PERCENT_BPS - 1) / (T' / ONE_HUNDRED_PERCENT_BPS)
         *  <=> y = x * (T' - ONE_HUNDRED_PERCENT_BPS) / T'
         */

        // Short-circuit when leverageBpsBeforeRepayDebt == 0
        if (leverageBpsBeforeRepayDebt == 0) {
            // no collateral means no debt yet, so nothing to repay
            return 0;
        }

        // Convert the target withdraw amount to base
        uint256 targetWithdrawAmountInBase = convertFromTokenAmountToBaseCurrency(
                targetWithdrawAmount,
                collateralTokenDecimals,
                collateralTokenPriceInBase
            );

        // Calculate the repay amount in base
        uint256 repayAmountInBase = Math.mulDiv(
            targetWithdrawAmountInBase,
            leverageBpsBeforeRepayDebt -
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            leverageBpsBeforeRepayDebt
        );

        return
            convertFromBaseCurrencyToToken(
                repayAmountInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
    }

    /**
     * @dev Gets the borrow amount that keeps the current leverage
     * @param suppliedCollateralAmount The actual supplied amount of collateral asset
     * @param leverageBpsBeforeSupply Leverage in basis points before supplying
     * @param targetLeverageBps The target leverage in basis points
     * @param collateralTokenDecimals The decimals of the collateral token
     * @param collateralTokenPriceInBase The price of the collateral token in base currency
     * @param debtTokenDecimals The decimals of the debt token
     * @param debtTokenPriceInBase The price of the debt token in base currency
     * @return expectedBorrowAmount The expected borrow amount that keeps the current leverage
     */
    function getBorrowAmountThatKeepCurrentLeverage(
        uint256 suppliedCollateralAmount,
        uint256 leverageBpsBeforeSupply,
        uint256 targetLeverageBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) internal pure returns (uint256 expectedBorrowAmount) {
        /* Formula definition:
         * - C1: totalCollateralBase before supply (in base currency)
         * - D1: totalDebtBase before supply (in base currency)
         * - C2: totalCollateralBase after supply (in base currency)
         * - D2: totalDebtBase after supply (in base currency)
         * - T: target leverage
         * - x: supply amount in base currency
         * - y: borrow amount in base currency
         *
         * We have:
         *      C1 / (C1-D1) = C2 / (C2-D2)
         *      C2 = C1+x
         *      D2 = D1+y
         *      C1 / (C1-D1) = T <=> C1 = (C1-D1) * T <=> C1 = C1*T - D1*T <=> C1*T - C1 = D1*T <=> C1 = D1*T/(T-1)
         *
         * Formula expression:
         *      C1 / (C1-D1) = (C1+x) / (C1+x-D1-y)
         *  <=> C1 * (C1+x-D1-y) = (C1+x) * (C1-D1)
         *  <=> C1^2 + C1*x - C1*D1 - C1*y = C1^2 - C1*D1 + C1*x - D1*x
         *  <=> C1*y = x*D1
         *  <=> y = x*D1 / C1
         *  <=> y = x * (T-1)/T
         *
         * Suppose that:
         *      T' = T * ONE_HUNDRED_PERCENT_BPS, then:
         *   => T = T' / ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - T' is the target leverage in basis points unit
         *
         * This is the formula to calculate the borrow amount that keeps the current leverage:
         *      y = x * (T-1)/T
         *  <=> y = x * (T' / ONE_HUNDRED_PERCENT_BPS - 1) / (T' / ONE_HUNDRED_PERCENT_BPS)
         *  <=> y = x * (T' - ONE_HUNDRED_PERCENT_BPS) / T'
         */

        if (leverageBpsBeforeSupply == 0) {
            // This is the case when there is no deposit yet, so we use the target leverage
            leverageBpsBeforeSupply = targetLeverageBps;
        }

        // Convert the actual supplied amount to base
        uint256 suppliedCollateralAmountInBase = convertFromTokenAmountToBaseCurrency(
                suppliedCollateralAmount,
                collateralTokenDecimals,
                collateralTokenPriceInBase
            );

        // Calculate the borrow amount in base currency that keeps the current leverage
        uint256 borrowAmountInBase = Math.mulDiv(
            suppliedCollateralAmountInBase,
            leverageBpsBeforeSupply -
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            leverageBpsBeforeSupply
        );

        return
            convertFromBaseCurrencyToToken(
                borrowAmountInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
    }

    /**
     * @dev Gets the collateral token amount to reach the target leverage
     *      - This method is only being called for increasing the leverage quote in quoteRebalanceAmountToReachTargetLeverage()
     *      - It will failed if the current leverage is above the target leverage (which requires the user to call decreaseLeverage)
     * @param expectedTargetLeverageBps The expected target leverage in basis points unit
     * @param totalCollateralBase The total collateral base
     * @param totalDebtBase The total debt base
     * @param subsidyBps The subsidy in basis points unit
     * @return requiredCollateralDepositAmountInBase The collateral deposit amount in base currency
     */
    function getCollateralTokenDepositAmountToReachTargetLeverage(
        uint256 expectedTargetLeverageBps,
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 requiredCollateralDepositAmountInBase) {
        /**
         * Find the amount of collateral to be deposited and the corresponding amount of debt token to be borrowed to rebalance
         *
         * The amount of debt token to be borrowed is a bit more than the deposited collateral to pay for the rebalancing subsidy
         * - Rebalancing caller will receive the debt token as the subsidy
         *
         * Formula definition:
         * - C: totalCollateralBase
         * - D: totalDebtBase
         * - T: target leverage
         * - k: subsidy (0.01 means 1%)
         * - x: change amount of collateral in base currency
         * - y: change amount of debt in base currency
         *
         * We have:
         *      y = x*(1+k)   (borrow a bit more debt than the deposited collateral to pay for the rebalancing subsidy)
         *
         * Because this is a deposit collateral and borrow debt process, the formula is:
         *      (C + x) / (C + x - D - y) = T
         *  <=> C + x = T * (C + x - D - y)
         *  <=> C + x = T * (C + x - D - x*(1+k))
         *  <=> C + x = T * (C + x - D - x - x*k)
         *  <=> C + x = T * (C - D - x*k)
         *  <=> C + x = T*C - T*D - T*x*k
         *  <=> x + T*x*k = T*C - T*D - C
         *  <=> x*(1 + T*k) = T*(C - D) - C
         *  <=> x = (T*(C - D) - C) / (1 + T*k)
         *
         * Suppose that:
         *      TT = T * ONE_HUNDRED_PERCENT_BPS
         *      kk = k * ONE_HUNDRED_PERCENT_BPS
         * then:
         *      T = TT / ONE_HUNDRED_PERCENT_BPS
         *      k = kk / ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - TT is the target leverage in basis points unit
         *      - kk is the subsidy in basis points unit
         *
         * We have:
         *      x = (T*(C - D) - C) / (1 + T*k)
         *  <=> x = (TT*(C - D)/ONE_HUNDRED_PERCENT_BPS - C) / (1 + TT*kk/ONE_HUNDRED_PERCENT_BPS^2)
         *  <=> x = (TT*(C - D) - C*ONE_HUNDRED_PERCENT_BPS) / (ONE_HUNDRED_PERCENT_BPS + TT*kk/ONE_HUNDRED_PERCENT_BPS)
         *  <=> x = (TT*(C - D) - C*ONE_HUNDRED_PERCENT_BPS) / denominator
         * where:
         *      denominator = ONE_HUNDRED_PERCENT_BPS + TT*kk/ONE_HUNDRED_PERCENT_BPS
         *
         * If x < 0, the transaction will be reverted due to the underflow/overflow
         *
         * If x = 0, it means the user should not rebalance, so the direction is 0
         *
         * Finally, we have y = (1+k)*x:
         *   => y = (1+k) * x
         *  <=> y = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * x
         *  <=> y = (ONE_HUNDRED_PERCENT_BPS + kk) * x / ONE_HUNDRED_PERCENT_BPS
         *
         * The value of y here is for reference (the expected amount of debt to borrow)
         */
        if (totalCollateralBase == 0) {
            revert TotalCollateralBaseIsZero();
        }
        if (totalCollateralBase < totalDebtBase) {
            revert TotalCollateralBaseIsLessThanTotalDebtBase(
                totalCollateralBase,
                totalDebtBase
            );
        }

        uint256 denominator = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
            Math.mulDiv(
                expectedTargetLeverageBps,
                subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );

        // Use ceilDiv as we want to round up required collateral deposit amount in base currency
        // to avoid getting the new leverage above the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // The logic is to deposit a bit more collateral, and borrow a bit more debt (due to rounding),
        // which will guarantee the new leverage cannot be more than the target leverage, avoid
        // unexpected post-process assertion revert.
        requiredCollateralDepositAmountInBase = Math.ceilDiv(
            expectedTargetLeverageBps *
                (totalCollateralBase - totalDebtBase) -
                totalCollateralBase *
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            denominator
        );

        return requiredCollateralDepositAmountInBase;
    }

    /**
     * @dev Gets the debt amount in base currency to be borrowed to increase the leverage
     * @param inputCollateralDepositAmountInBase The collateral deposit amount in base currency
     * @param subsidyBps The subsidy in basis points unit
     * @return outputDebtBorrowAmountInBase The debt amount in base currency to be borrowed
     */
    function getDebtBorrowAmountInBaseToIncreaseLeverage(
        uint256 inputCollateralDepositAmountInBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 outputDebtBorrowAmountInBase) {
        /**
         * The formula is:
         *      y = (1+k) * x
         *  <=> y = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * x
         *  <=> y = (ONE_HUNDRED_PERCENT_BPS + kk) * x / ONE_HUNDRED_PERCENT_BPS
         *
         * where:
         *      - y is the debt amount in base currency to be borrowed
         *      - x is the collateral amount in base currency to be deposited
         *      - kk is the subsidy in basis points unit
         *
         * For more detail, check the comment in _getCollateralTokenDepositAmountToReachTargetLeverage()
         */

        // Use rounding down with mulDiv with Rounding.Floor as we want to borrow a bit less, to avoid
        // getting the new leverage above the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // Borrow a bit less debt (rounding), given the same deposit amount of collateral token
        // means the new leverage should be lower than the actual leverage (with decimal without rounding)
        // As we calculate the estimated final leverage is reaching the target leverage,
        // if we round up, the new leverage can be more than the target leverage (given
        // the same deposit amount of collateral token), which will revert the rebalance process (due to post-process assertion)
        return
            Math.mulDiv(
                inputCollateralDepositAmountInBase,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS + subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                Math.Rounding.Floor
            );
    }

    /**
     * @dev Gets the debt token amount to be borrowed to increase the leverage, given the input collateral token amount
     * @param inputCollateralDepositTokenAmount The collateral deposit amount in token unit
     * @param subsidyBps The subsidy in basis points unit
     * @param collateralTokenDecimals The collateral token decimals
     * @param collateralTokenPriceInBase The collateral token price in base currency
     * @param debtTokenDecimals The debt token decimals
     * @param debtTokenPriceInBase The debt token price in base currency
     * @return outputDebtBorrowTokenAmount The debt token amount to be borrowed in token unit
     */
    function getDebtBorrowTokenAmountToIncreaseLeverage(
        uint256 inputCollateralDepositTokenAmount,
        uint256 subsidyBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) internal pure returns (uint256 outputDebtBorrowTokenAmount) {
        // Make sure the input collateral token amount is not zero
        if (inputCollateralDepositTokenAmount == 0) {
            revert InputCollateralTokenAmountIsZero();
        }

        // Calculate everything before transferring, supplying and borrowing to avoid
        // any potential impact from the child contract implementation

        // Calculate the amount of collateral token in base currency to deposit
        uint256 inputCollateralDepositAmountInBase = convertFromTokenAmountToBaseCurrency(
                inputCollateralDepositTokenAmount,
                collateralTokenDecimals,
                collateralTokenPriceInBase
            );

        // The amount of debt token to borrow is equal to the amount of collateral token deposited
        // plus the subsidy (bonus for the caller)
        uint256 borrowedDebtTokenInBase = getDebtBorrowAmountInBaseToIncreaseLeverage(
                inputCollateralDepositAmountInBase,
                subsidyBps
            );

        // Convert the amount of debt token in base currency to token unit
        outputDebtBorrowTokenAmount = convertFromBaseCurrencyToToken(
            borrowedDebtTokenInBase,
            debtTokenDecimals,
            debtTokenPriceInBase
        );

        return outputDebtBorrowTokenAmount;
    }

    /**
     * @dev Gets the debt amount in base currency to reach the target leverage
     *      - This method is only being called for decreasing the leverage quote in quoteRebalanceAmountToReachTargetLeverage()
     *      - It will failed if the current leverage is below the target leverage (which requires the user to call increaseLeverage)
     * @param expectedTargetLeverageBps The expected target leverage in basis points unit
     * @param totalCollateralBase The total collateral base
     * @param totalDebtBase The total debt base
     * @param subsidyBps The subsidy in basis points unit
     * @return requiredDebtRepayAmountInBase The debt amount in base currency to be repaid
     */
    function getDebtRepayAmountInBaseToReachTargetLeverage(
        uint256 expectedTargetLeverageBps,
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 requiredDebtRepayAmountInBase) {
        /**
         * Find the amount of debt to be repaid and the corresponding amount of collateral to be withdraw to rebalance
         *
         * The amount of collateral to be withdraw to rebalance which is a bit more than the repay amount of debt token
         * to pay for the rebalancing subsidy
         * - Rebalancing caller will receive the collateral token as the subsidy
         *
         * Formula definition:
         * - C: totalCollateralBase
         * - D: totalDebtBase
         * - T: target leverage
         * - k: subsidy (0.01 means 1%)
         * - x: change amount of collateral in base currency
         * - y: change amount of debt in base currency
         *
         * We have:
         *      x = y*(1+k)   (withdraw a bit more collateral than the debt to pay for the rebalancing subsidy)
         *
         * Because this is a repay debt and withdraw collateral process, the formula is:
         *      (C - x) / (C - x - D + y) = T
         *  <=> C - y*(1+k) = T * (C - y*(1+k) - D + y)
         *  <=> C - y*(1+k) = T * (C - y - y*k - D + y)
         *  <=> C - y*(1+k) = T * (C - D - y*k)
         *  <=> y*(1+k) = C - T * (C - D - y*k)
         *  <=> y*(1+k) = C - T*C + T*D + T*y*k
         *  <=> y*(1+k) - T*y*k = C - T*C + T*D
         *  <=> y*(1 + k - T*k) = C - T*C + T*D
         *  <=> y = (C - T*C + T*D) / (1 + k - T*k)
         *
         * Suppose that:
         *      TT = T * ONE_HUNDRED_PERCENT_BPS
         *      kk = k * ONE_HUNDRED_PERCENT_BPS
         * then:
         *      T = TT / ONE_HUNDRED_PERCENT_BPS
         *      k = kk / ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - TT is the target leverage in basis points unit
         *      - kk is the subsidy in basis points unit
         *
         * We have:
         *      y = (C - T*C + T*D) / (1 + k - T*k)
         *  <=> y = (C - TT*C/ONE_HUNDRED_PERCENT_BPS + TT*D/ONE_HUNDRED_PERCENT_BPS) / (1 + kk/ONE_HUNDRED_PERCENT_BPS - TT*kk/ONE_HUNDRED_PERCENT_BPS^2)
         *  <=> y = (C*ONE_HUNDRED_PERCENT_BPS - TT*C + TT*D) / (ONE_HUNDRED_PERCENT_BPS + kk - TT*kk/ONE_HUNDRED_PERCENT_BPS)
         *  <=> y = (C*ONE_HUNDRED_PERCENT_BPS - TT*C + TT*D) / denominator
         *  <=> y = (C*ONE_HUNDRED_PERCENT_BPS - TT*(C - D)) / denominator
         * where:
         *      denominator = ONE_HUNDRED_PERCENT_BPS + kk - TT*kk/ONE_HUNDRED_PERCENT_BPS
         *
         * If y < 0, the transaction will be reverted due to the underflow/overflow
         *
         * If y = 0, it means the user should not rebalance, so the direction is 0
         *
         * Finally, we have x = (1+k)*y:
         *   => x = (1+k) * y
         *  <=> x = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * y
         *  <=> x = (ONE_HUNDRED_PERCENT_BPS + kk) * y / ONE_HUNDRED_PERCENT_BPS
         *
         * The value of x here is for reference (the expected amount of collateral to withdraw)
         */
        if (totalCollateralBase == 0) {
            revert TotalCollateralBaseIsZero();
        }
        if (totalCollateralBase < totalDebtBase) {
            revert TotalCollateralBaseIsLessThanTotalDebtBase(
                totalCollateralBase,
                totalDebtBase
            );
        }

        uint256 denominator = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
            subsidyBps -
            Math.mulDiv(
                expectedTargetLeverageBps,
                subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );

        // Do not use ceilDiv as we want to round down required debt repay amount in base currency
        // to avoid getting the new leverage below the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // The logic is to repay a bit less, and withdraw a bit more collateral (due to rounding),
        // which will guarantee the new leverage cannot be less than the target leverage, avoid
        // unexpected post-process assertion revert.
        requiredDebtRepayAmountInBase =
            (totalCollateralBase *
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS -
                expectedTargetLeverageBps *
                (totalCollateralBase - totalDebtBase)) /
            denominator;

        return requiredDebtRepayAmountInBase;
    }

    /**
     * @dev Gets the collateral token amount to be withdraw to repay the debt token
     * @param inputDebtRepayAmountInBase The debt amount in base currency to be repaid
     * @param subsidyBps The subsidy in basis points unit
     * @return outputCollateralTokenAmount The collateral token amount to be withdraw
     */
    function getCollateralWithdrawAmountInBaseToDecreaseLeverage(
        uint256 inputDebtRepayAmountInBase,
        uint256 subsidyBps
    ) internal pure returns (uint256 outputCollateralTokenAmount) {
        /**
         * The formula is:
         *      x = (1+k) * y
         *  <=> x = (1 + kk/ONE_HUNDRED_PERCENT_BPS) * y
         *  <=> x = (ONE_HUNDRED_PERCENT_BPS + kk) * y / ONE_HUNDRED_PERCENT_BPS
         *
         * where:
         *      - x is the collateral amount in base currency to be withdraw
         *      - y is the debt amount in base currency to be repaid
         *      - kk is the subsidy in basis points unit
         *
         * For more detail, check the comment in _getDebtRepayAmountInBaseToReachTargetLeverage()
         */

        // Use rounding up with mulDiv with Rounding.Ceil as we want to withdraw a bit more, to avoid
        // getting the new leverage below the target leverage, which will revert the
        // rebalance process (due to post-process assertion)
        // Withdraw a bit more collateral (rounding), given the same repay amount of debt token
        // means the new leverage should be higher than the actual leverage (with decimal without rounding)
        // As we calculate the estimated final leverage is reaching the target leverage,
        // if we round down, the new leverage can be less than the target leverage (given
        // the same repay amount of debt token), which will revert the rebalance process (due to post-process assertion)
        return
            Math.mulDiv(
                inputDebtRepayAmountInBase,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS + subsidyBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                Math.Rounding.Ceil
            );
    }

    /**
     * @dev Gets the collateral token amount to be withdraw to repay the debt token
     * @param inputDebtRepayTokenAmount The debt amount in token unit to be repaid
     * @param subsidyBps The subsidy in basis points unit
     * @param collateralTokenDecimals The collateral token decimals
     * @param collateralTokenPriceInBase The collateral token price in base currency
     * @param debtTokenDecimals The debt token decimals
     * @param debtTokenPriceInBase The debt token price in base currency
     * @return outputCollateralWithdrawTokenAmount The collateral token amount to be withdraw in token unit
     */
    function getCollateralWithdrawTokenAmountToDecreaseLeverage(
        uint256 inputDebtRepayTokenAmount,
        uint256 subsidyBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) internal pure returns (uint256 outputCollateralWithdrawTokenAmount) {
        // Make sure the input debt token amount is not zero
        if (inputDebtRepayTokenAmount == 0) {
            revert InputDebtTokenAmountIsZero();
        }

        // Calculate everything before transferring, repaying and withdrawing to avoid
        // any potential impact from the child contract implementation

        // Calculate the amount of debt token in base currency to repay
        uint256 inputDebtRepayAmountInBase = convertFromTokenAmountToBaseCurrency(
                inputDebtRepayTokenAmount,
                debtTokenDecimals,
                debtTokenPriceInBase
            );

        // The amount of collateral asset to withdraw is equal to the amount of debt token repaid
        // plus the subsidy (bonus for the caller)
        uint256 withdrawCollateralTokenInBase = getCollateralWithdrawAmountInBaseToDecreaseLeverage(
                inputDebtRepayAmountInBase,
                subsidyBps
            );

        // Convert the amount of collateral token in base currency to token unit
        outputCollateralWithdrawTokenAmount = convertFromBaseCurrencyToToken(
            withdrawCollateralTokenInBase,
            collateralTokenDecimals,
            collateralTokenPriceInBase
        );

        return outputCollateralWithdrawTokenAmount;
    }

    /**
     * @dev Quotes the rebalance amount to reach the target leverage in token unit
     * @param totalCollateralBase The total collateral base
     * @param totalDebtBase The total debt base
     * @param currentLeverageBps The current leverage in basis points unit
     * @param targetLeverageBps The target leverage in basis points unit
     * @param subsidyBps The subsidy in basis points unit
     * @param collateralTokenDecimals The collateral token decimals
     * @param collateralTokenPriceInBase The collateral token price in base currency
     * @param debtTokenDecimals The debt token decimals
     * @param debtTokenPriceInBase The debt token price in base currency
     * @return inputTokenAmount The amount of token to call increaseLeverage or decreaseLeverage (in token unit)
     * @return estimatedOutputTokenAmount The estimated output token amount after the rebalance (in token unit)
     * @return direction The direction of the rebalance (1 for increase, -1 for decrease, 0 means no rebalance)
     */
    function quoteRebalanceAmountToReachTargetLeverage(
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 currentLeverageBps,
        uint256 targetLeverageBps,
        uint256 subsidyBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    )
        public
        pure
        returns (
            uint256 inputTokenAmount,
            uint256 estimatedOutputTokenAmount,
            int8 direction
        )
    {
        if (totalCollateralBase == 0) {
            // No collateral means no debt and no leverage, so no rebalance is needed
            return (0, 0, 0);
        }

        // If the current leverage is below the target leverage, the user should increase the leverage
        if (currentLeverageBps < targetLeverageBps) {
            // In this case, the input amount is the collateral amount to be deposit
            // and the output amount is the debt amount to be borrow
            uint256 inputCollateralAmountInBase = getCollateralTokenDepositAmountToReachTargetLeverage(
                    targetLeverageBps,
                    totalCollateralBase,
                    totalDebtBase,
                    subsidyBps
                );
            inputTokenAmount = convertFromBaseCurrencyToToken(
                inputCollateralAmountInBase,
                collateralTokenDecimals,
                collateralTokenPriceInBase
            );
            uint256 estimatedDebtAmountInBase = getDebtBorrowAmountInBaseToIncreaseLeverage(
                    inputCollateralAmountInBase,
                    subsidyBps
                );
            estimatedOutputTokenAmount = convertFromBaseCurrencyToToken(
                estimatedDebtAmountInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
            direction = 1;
            return (inputTokenAmount, estimatedOutputTokenAmount, direction);
        }
        // If the current leverage is above the target leverage, the user should decrease the leverage
        else if (currentLeverageBps > targetLeverageBps) {
            // In this case, the input amount is the debt amount to be repaid
            // and the output amount is the collateral amount to be withdraw
            uint256 inputDebtAmountInBase = getDebtRepayAmountInBaseToReachTargetLeverage(
                    targetLeverageBps,
                    totalCollateralBase,
                    totalDebtBase,
                    subsidyBps
                );
            inputTokenAmount = convertFromBaseCurrencyToToken(
                inputDebtAmountInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
            uint256 estimatedCollateralAmountInBase = getCollateralWithdrawAmountInBaseToDecreaseLeverage(
                    inputDebtAmountInBase,
                    subsidyBps
                );
            estimatedOutputTokenAmount = convertFromBaseCurrencyToToken(
                estimatedCollateralAmountInBase,
                collateralTokenDecimals,
                collateralTokenPriceInBase
            );
            direction = -1;
            return (inputTokenAmount, estimatedOutputTokenAmount, direction);
        }

        // If the current leverage is equal to the target leverage, the user should not rebalance
        return (0, 0, 0);
    }

    /**
     * @dev Gets the gross amount required for a given net amount
     * @param netAmount The net amount
     * @param withdrawalFeeBps The withdrawal fee in basis points
     * @return grossAmount The gross amount
     */
    function getGrossAmountRequiredForNet(
        uint256 netAmount,
        uint256 withdrawalFeeBps
    ) internal pure returns (uint256 grossAmount) {
        return
            Math.mulDiv(
                netAmount,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - withdrawalFeeBps
            );
    }

    /**
     * @dev Gets the net amount after fee for a given gross amount
     * @param grossAmount The gross amount
     * @param withdrawalFeeBps The withdrawal fee in basis points
     * @return netAmount The net amount
     */
    function getNetAmountAfterFee(
        uint256 grossAmount,
        uint256 withdrawalFeeBps
    ) internal pure returns (uint256 netAmount) {
        return
            Math.mulDiv(
                grossAmount,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - withdrawalFeeBps,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
            );
    }
}
