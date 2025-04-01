import { ethers } from "ethers";

import { IInterestRateStrategyParams } from "./types";

/* Some intuition:
 * The borrow APR at 0% utilization rate is baseVariableBorrowRate
 * The borrow APR at optimal utilization rate is baseVariableBorrowRate + variableRateSlope1
 * The borrow APR at 100% utilization rate is baseVariableBorrowRate + variableRateSlope1 + variableRateSlope2
 */

export const rateStrategyHighLiquidityVolatile: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityVolatile",
  optimalUsageRatio: ethers.parseUnits("0.5", 27).toString(), // This is the "kink" in the curve
  baseVariableBorrowRate: "0",
  variableRateSlope1: ethers.parseUnits("0.03", 27).toString(), // This is the borrow APR at the kink
  variableRateSlope2: ethers.parseUnits("1.97", 27).toString(), // This is the borrow APR added on from kink to 100%
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};

export const rateStrategyMediumLiquidityVolatile: IInterestRateStrategyParams =
  {
    name: "rateStrategyMediumLiquidityVolatile",
    optimalUsageRatio: ethers.parseUnits("0.4", 27).toString(),
    baseVariableBorrowRate: "0",
    variableRateSlope1: ethers.parseUnits("0.03", 27).toString(),
    variableRateSlope2: ethers.parseUnits("1.97", 27).toString(),
    stableRateSlope1: ethers.parseUnits("0", 27).toString(),
    stableRateSlope2: ethers.parseUnits("0", 27).toString(),
    baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
    stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
    optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
  };

export const rateStrategyHighLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyHighLiquidityStable",
  optimalUsageRatio: ethers.parseUnits("0.9", 27).toString(),
  baseVariableBorrowRate: ethers.parseUnits("0", 27).toString(),
  variableRateSlope1: ethers.parseUnits("0.06", 27).toString(),
  variableRateSlope2: ethers.parseUnits("0.54", 27).toString(),
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};

export const rateStrategyMediumLiquidityStable: IInterestRateStrategyParams = {
  name: "rateStrategyMediumLiquidityStable",
  optimalUsageRatio: ethers.parseUnits("0.8", 27).toString(),
  baseVariableBorrowRate: ethers.parseUnits("0", 27).toString(),
  variableRateSlope1: ethers.parseUnits("0.06", 27).toString(),
  variableRateSlope2: ethers.parseUnits("0.54", 27).toString(),
  stableRateSlope1: ethers.parseUnits("0", 27).toString(),
  stableRateSlope2: ethers.parseUnits("0", 27).toString(),
  baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
  stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
  optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
};
