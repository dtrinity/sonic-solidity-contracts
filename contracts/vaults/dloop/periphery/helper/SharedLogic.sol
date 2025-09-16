// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { DLoopCoreBase } from "../../core/DLoopCoreBase.sol";
import { DLoopCoreLogic } from "../../core/DLoopCoreLogic.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SharedLogic
 * @dev Shared utility functions for dLoop periphery contracts
 */
library SharedLogic {
    using SafeERC20 for ERC20;

    /* Errors */

    error EstimatedOverallSlippageBpsCannotExceedOneHundredPercent(uint256 estimatedOverallSlippageBps);
    error EstimatedSharesLessThanMinOutputShares(uint256 currentEstimatedShares, uint256 minOutputShares);

    /* Structs */

    struct TokenBalancesBeforeAfter {
        ERC20 token;
        uint256 tokenBalanceBefore;
        uint256 tokenBalanceAfter;
    }

    /**
     * @dev Gets the leveraged assets for a given assets and dLoopCore
     * Uses current leverage if > 0, otherwise falls back to target leverage
     * @param assets Amount of assets
     * @param dLoopCore Address of the DLoopCore contract
     * @return leveragedAssets Amount of leveraged assets
     */
    function getLeveragedAssets(uint256 assets, DLoopCoreBase dLoopCore) internal view returns (uint256) {
        return
            dLoopCore.getCurrentLeverageBps() > 0
                ? DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, dLoopCore.getCurrentLeverageBps())
                : DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, dLoopCore.targetLeverageBps());
    }

    /**
     * @dev Gets the unleveraged assets for a given leveraged assets and dLoopCore
     * Uses current leverage if > 0, otherwise falls back to target leverage
     * @param leveragedAssets Amount of leveraged assets
     * @param dLoopCore Address of the DLoopCore contract
     * @return unleveragedAssets Amount of unleveraged assets
     */
    function getUnleveragedAssets(uint256 leveragedAssets, DLoopCoreBase dLoopCore) internal view returns (uint256) {
        return
            dLoopCore.getCurrentLeverageBps() > 0
                ? DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, dLoopCore.getCurrentLeverageBps())
                : DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, dLoopCore.targetLeverageBps());
    }

    /**
     * @dev Gets the leveraged collateral amount for a given assets and dLoopCore with slippage included
     * @param assets Amount of assets
     * @param minOutputShares Minimum output shares
     * @param dLoopCore Address of the DLoopCore contract
     * @return leveragedCollateralAmount Amount of leveraged collateral amount
     *         with slippage included
     */
    function getLeveragedCollateralAmountWithSlippage(
        uint256 assets,
        uint256 minOutputShares,
        DLoopCoreBase dLoopCore
    ) internal view returns (uint256) {
        // Get the leveraged assets with the current leverage
        uint256 currentLeveragedAssets = getLeveragedAssets(assets, dLoopCore);

        // Calculate the estimated overall slippage bps
        uint256 estimatedOverallSlippageBps = calculateEstimatedOverallSlippageBps(
            dLoopCore.convertToShares(currentLeveragedAssets),
            minOutputShares
        );

        // Make sure the estimated overall slippage bps does not exceed 100%
        if (estimatedOverallSlippageBps > BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert EstimatedOverallSlippageBpsCannotExceedOneHundredPercent(estimatedOverallSlippageBps);
        }

        // Calculate the leveraged collateral amount to deposit with slippage included
        // Explained with formula in _calculateEstimatedOverallSlippageBps()
        uint256 leveragedCollateralAmount = Math.mulDiv(
            currentLeveragedAssets,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - estimatedOverallSlippageBps,
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS
        );

        return leveragedCollateralAmount;
    }

    /**
     * @dev Calculates the estimated overall slippage bps
     * @param currentEstimatedShares Current estimated shares
     * @param minOutputShares Minimum output shares
     * @return estimatedOverallSlippageBps Estimated overall slippage bps
     */
    function calculateEstimatedOverallSlippageBps(
        uint256 currentEstimatedShares,
        uint256 minOutputShares
    ) internal pure returns (uint256) {
        /*
         * According to the formula in getBorrowAmountThatKeepCurrentLeverage() of DLoopCoreLogic,
         * we have:
         *      y = x * (T-1)/T
         *  and
         *      y = x * (T' - ONE_HUNDRED_PERCENT_BPS) / T'
         *  and
         *      T' = T * ONE_HUNDRED_PERCENT_BPS
         * where:
         *      - T: target leverage
         *      - T': target leverage in basis points unit
         *      - x: supply amount in base currency
         *      - y: borrow amount in base currency
         *
         * We have:
         *      x = (d + f) * (1 - s)
         *   => y = (d + f) * (1 - s) * (T-1) / T
         * where:
         *      - d is the user's deposit collateral amount (original deposit amount) in base currency
         *      - f is the flash loan amount of debt token in base currency
         *      - s is the swap slippage (0.01 means 1%)
         *
         * We want find what is the condition of f so that we can borrow the debt token
         * which is sufficient to cover up the flash loan amount. We want:
         *      y >= f
         *  <=> (d+f) * (1-s) * (T-1) / T >= f
         *  <=> (d+f) * (1-s) * (T-1) >= T*f
         *  <=> d * (1-s) * (T-1) >= T*f - f * (1-s) * (T-1)
         *  <=> d * (1-s) * (T-1) >= f * (T - (1-s) * (T-1))
         *  <=> (d * (1-s) * (T-1)) / (T - (1-s) * (T-1)) >= f    (as the denominator is greater than 0)
         *  <=> f <= (d * (1-s) * (T-1)) / (T - (1-s) * (T-1))
         *  <=> f <= (d * (1-s) * (T-1)) / (T - T + 1 + T*s - s)
         *  <=> f <= (d * (1-s) * (T-1)) / (1 + T*s - s)
         *
         * Based on the above inequation, it means we can just adjust the flashloan amount to make
         * sure the flashloan can be covered by the borrow amount.
         *
         * Thus, just need to infer the estimated slippage based on the provided min output shares
         * and the current estimated shares
         */
        if (currentEstimatedShares < minOutputShares) {
            revert EstimatedSharesLessThanMinOutputShares(currentEstimatedShares, minOutputShares);
        }
        return
            Math.mulDiv(
                currentEstimatedShares - minOutputShares,
                BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
                currentEstimatedShares
            );
    }

    /**
     * @dev Transfers any leftover tokens to the receiver
     * @param tokenBalancesBeforeAfter Token balances before and after the operation
     * @param receiver Address to receive the leftover tokens
     * @return leftoverAmount Amount of leftover tokens
     * @return success Whether the transfer was successful
     */
    function transferLeftoverTokens(
        SharedLogic.TokenBalancesBeforeAfter memory tokenBalancesBeforeAfter,
        address receiver
    ) internal returns (uint256, bool) {
        (bool success, uint256 leftoverAmount) = Math.trySub(
            tokenBalancesBeforeAfter.tokenBalanceAfter,
            tokenBalancesBeforeAfter.tokenBalanceBefore
        );
        if (success && leftoverAmount > 0) {
            tokenBalancesBeforeAfter.token.safeTransfer(receiver, leftoverAmount);
            return (leftoverAmount, success);
        }
        return (0, false);
    }
}
