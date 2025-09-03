// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DLoopCoreLogic } from "contracts/vaults/dloop/core/DLoopCoreLogic.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";

contract DLoopCoreLogicHarness {
    uint256 public constant TARGET_LEVERAGE_BPS = 3 * BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

    // State logic
    function getCurrentLeverageBpsPublic(
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    ) external pure returns (uint256) {
        return DLoopCoreLogic.getCurrentLeverageBps(totalCollateralBase, totalDebtBase);
    }

    function getCurrentSubsidyBpsPublic(
        uint256 currentLeverageBps,
        uint256 targetLeverageBps,
        uint256 maxSubsidyBps,
        uint256 minDeviationBps
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getCurrentSubsidyBps(currentLeverageBps, targetLeverageBps, maxSubsidyBps, minDeviationBps);
    }

    function isTooImbalancedPublic(
        uint256 currentLeverageBps,
        uint256 lowerBoundTargetLeverageBps,
        uint256 upperBoundTargetLeverageBps
    ) external pure returns (bool) {
        return
            DLoopCoreLogic.isTooImbalanced(
                currentLeverageBps,
                lowerBoundTargetLeverageBps,
                upperBoundTargetLeverageBps
            );
    }

    // Conversion logic
    function convertFromBaseCurrencyToTokenPublic(
        uint256 amountInBase,
        uint256 tokenDecimals,
        uint256 tokenPriceInBase
    ) external pure returns (uint256) {
        return DLoopCoreLogic.convertFromBaseCurrencyToToken(amountInBase, tokenDecimals, tokenPriceInBase);
    }

    function convertFromTokenAmountToBaseCurrencyPublic(
        uint256 amountInToken,
        uint256 tokenDecimals,
        uint256 tokenPriceInBase
    ) external pure returns (uint256) {
        return DLoopCoreLogic.convertFromTokenAmountToBaseCurrency(amountInToken, tokenDecimals, tokenPriceInBase);
    }

    // Leverage scaling
    function getUnleveragedAssetsWithLeveragePublic(
        uint256 leveragedAssets,
        uint256 leverageBps
    ) external pure returns (uint256) {
        return DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, leverageBps);
    }

    function getLeveragedAssetsWithLeveragePublic(uint256 assets, uint256 leverageBps) external pure returns (uint256) {
        return DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, leverageBps);
    }

    // Maintain leverage
    function getRepayAmountThatKeepCurrentLeveragePublic(
        uint256 targetWithdrawAmount,
        uint256 leverageBpsBeforeRepayDebt,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getRepayAmountThatKeepCurrentLeverage(
                targetWithdrawAmount,
                leverageBpsBeforeRepayDebt,
                collateralTokenDecimals,
                collateralTokenPriceInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
    }

    function getBorrowAmountThatKeepCurrentLeveragePublic(
        uint256 suppliedCollateralAmount,
        uint256 leverageBpsBeforeSupply,
        uint256 targetLeverageBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getBorrowAmountThatKeepCurrentLeverage(
                suppliedCollateralAmount,
                leverageBpsBeforeSupply,
                targetLeverageBps,
                collateralTokenDecimals,
                collateralTokenPriceInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
    }

    // Increase leverage
    function getCollateralTokenDepositAmountToReachTargetLeveragePublic(
        uint256 expectedTargetLeverageBps,
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 subsidyBps
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getCollateralTokenDepositAmountToReachTargetLeverage(
                expectedTargetLeverageBps,
                totalCollateralBase,
                totalDebtBase,
                subsidyBps
            );
    }

    function getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
        uint256 inputCollateralDepositAmountInBase,
        uint256 subsidyBps
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getDebtBorrowAmountInBaseToIncreaseLeverage(inputCollateralDepositAmountInBase, subsidyBps);
    }

    function getDebtBorrowTokenAmountToIncreaseLeveragePublic(
        uint256 inputCollateralDepositTokenAmount,
        uint256 subsidyBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getDebtBorrowTokenAmountToIncreaseLeverage(
                inputCollateralDepositTokenAmount,
                subsidyBps,
                collateralTokenDecimals,
                collateralTokenPriceInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
    }

    // Decrease leverage
    function getDebtRepayAmountInBaseToReachTargetLeveragePublic(
        uint256 expectedTargetLeverageBps,
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 subsidyBps
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getDebtRepayAmountInBaseToReachTargetLeverage(
                expectedTargetLeverageBps,
                totalCollateralBase,
                totalDebtBase,
                subsidyBps
            );
    }

    function getCollateralWithdrawAmountInBaseToDecreaseLeveragePublic(
        uint256 inputDebtRepayAmountInBase,
        uint256 subsidyBps
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getCollateralWithdrawAmountInBaseToDecreaseLeverage(inputDebtRepayAmountInBase, subsidyBps);
    }

    function getCollateralWithdrawTokenAmountToDecreaseLeveragePublic(
        uint256 inputDebtRepayTokenAmount,
        uint256 subsidyBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) external pure returns (uint256) {
        return
            DLoopCoreLogic.getCollateralWithdrawTokenAmountToDecreaseLeverage(
                inputDebtRepayTokenAmount,
                subsidyBps,
                collateralTokenDecimals,
                collateralTokenPriceInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
    }

    // Quote rebalance
    function quoteRebalanceAmountToReachTargetLeveragePublic(
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 currentLeverageBps,
        uint256 targetLeverageBps,
        uint256 subsidyBps,
        uint256 collateralTokenDecimals,
        uint256 collateralTokenPriceInBase,
        uint256 debtTokenDecimals,
        uint256 debtTokenPriceInBase
    ) external pure returns (uint256 inputTokenAmount, uint256 estimatedOutputTokenAmount, int8 direction) {
        if (totalCollateralBase == 0) {
            return (0, 0, 0);
        }

        if (currentLeverageBps < targetLeverageBps) {
            uint256 inputCollateralAmountInBase = DLoopCoreLogic.getCollateralTokenDepositAmountToReachTargetLeverage(
                targetLeverageBps,
                totalCollateralBase,
                totalDebtBase,
                subsidyBps
            );
            inputTokenAmount = DLoopCoreLogic.convertFromBaseCurrencyToToken(
                inputCollateralAmountInBase,
                collateralTokenDecimals,
                collateralTokenPriceInBase
            );
            uint256 estimatedDebtAmountInBase = DLoopCoreLogic.getDebtBorrowAmountInBaseToIncreaseLeverage(
                inputCollateralAmountInBase,
                subsidyBps
            );
            estimatedOutputTokenAmount = DLoopCoreLogic.convertFromBaseCurrencyToToken(
                estimatedDebtAmountInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
            direction = 1;
            return (inputTokenAmount, estimatedOutputTokenAmount, direction);
        } else if (currentLeverageBps > targetLeverageBps) {
            uint256 inputDebtAmountInBase = DLoopCoreLogic.getDebtRepayAmountInBaseToReachTargetLeverage(
                targetLeverageBps,
                totalCollateralBase,
                totalDebtBase,
                subsidyBps
            );
            inputTokenAmount = DLoopCoreLogic.convertFromBaseCurrencyToToken(
                inputDebtAmountInBase,
                debtTokenDecimals,
                debtTokenPriceInBase
            );
            uint256 estimatedCollateralAmountInBase = DLoopCoreLogic
                .getCollateralWithdrawAmountInBaseToDecreaseLeverage(inputDebtAmountInBase, subsidyBps);
            estimatedOutputTokenAmount = DLoopCoreLogic.convertFromBaseCurrencyToToken(
                estimatedCollateralAmountInBase,
                collateralTokenDecimals,
                collateralTokenPriceInBase
            );
            direction = -1;
            return (inputTokenAmount, estimatedOutputTokenAmount, direction);
        }

        return (0, 0, 0);
    }

    // Fees
    function getGrossAmountRequiredForNetPublic(
        uint256 netAmount,
        uint256 withdrawalFeeBps
    ) external pure returns (uint256) {
        return DLoopCoreLogic.getGrossAmountRequiredForNet(netAmount, withdrawalFeeBps);
    }

    function getNetAmountAfterFeePublic(uint256 grossAmount, uint256 withdrawalFeeBps) external pure returns (uint256) {
        return DLoopCoreLogic.getNetAmountAfterFee(grossAmount, withdrawalFeeBps);
    }

    // Missing functions from mock tests - implemented using existing logic
    function getTargetLeveragedAssetsPublic(uint256 assets) external pure returns (uint256) {
        return DLoopCoreLogic.getLeveragedAssetsWithLeverage(assets, TARGET_LEVERAGE_BPS);
    }

    function getCurrentLeveragedAssetsPublic(
        uint256 inputAssets,
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    ) external pure returns (uint256) {
        uint256 currentLeverageBps = DLoopCoreLogic.getCurrentLeverageBps(totalCollateralBase, totalDebtBase);
        return DLoopCoreLogic.getLeveragedAssetsWithLeverage(inputAssets, currentLeverageBps);
    }

    function getUnleveragedAssetsWithTargetLeveragePublic(uint256 leveragedAssets) external pure returns (uint256) {
        return DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, 3000000); // 3x leverage (target) = 300 * 10000
    }

    function getUnleveragedAssetsWithCurrentLeveragePublic(
        uint256 leveragedAssets,
        uint256 totalCollateralBase,
        uint256 totalDebtBase
    ) external pure returns (uint256) {
        uint256 currentLeverageBps = DLoopCoreLogic.getCurrentLeverageBps(totalCollateralBase, totalDebtBase);
        return DLoopCoreLogic.getUnleveragedAssetsWithLeverage(leveragedAssets, currentLeverageBps);
    }
}
