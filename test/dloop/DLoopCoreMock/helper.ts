import { ONE_HUNDRED_PERCENT_BPS } from "../../../typescript/common/bps_constants";

/**
 * Get the current leverage in basis points
 *
 * @param currentTotalCollateralInBase - the current total collateral in base currency
 * @param currentTotalDebtInBase - the current total debt in base currency
 * @returns the current leverage in basis points
 */
export function getCurrentLeverageBps(
  currentTotalCollateralInBase: bigint,
  currentTotalDebtInBase: bigint,
): bigint {
  return (
    (currentTotalCollateralInBase * BigInt(ONE_HUNDRED_PERCENT_BPS)) /
    (currentTotalCollateralInBase - currentTotalDebtInBase)
  );
}

/**
 * Get the new leverage after the collateral token and debt token are changed
 *
 * @param currentTotalCollateralInBase - the current total collateral in base currency
 * @param currentTotalDebtInBase - the current total debt in base currency
 * @param collateralTokenDeltaInBase - the delta of the collateral token in base currency
 * @param debtTokenDeltaInBase - the delta of the debt token in base currency
 * @returns the new leverage in basis points
 */
export function getNewLeverageBps(
  currentTotalCollateralInBase: bigint,
  currentTotalDebtInBase: bigint,
  collateralTokenDeltaInBase: bigint,
  debtTokenDeltaInBase: bigint,
): bigint {
  return (
    ((currentTotalCollateralInBase + collateralTokenDeltaInBase) *
      BigInt(ONE_HUNDRED_PERCENT_BPS)) /
    (currentTotalCollateralInBase +
      collateralTokenDeltaInBase -
      currentTotalDebtInBase -
      debtTokenDeltaInBase)
  );
}

/**
 * Get the corresponding total debt in base currency for a given total collateral in base currency and leverage in basis points
 *
 * @param totalCollateralInBase - the total collateral in base currency
 * @param leverageBps - the leverage in basis points
 * @returns the corresponding total debt in base currency
 */
export function getCorrespondingTotalDebtInBase(
  totalCollateralInBase: bigint,
  leverageBps: bigint,
): bigint {
  // C / (C-D) = T
  // => C = T * (C-D)
  // => C = T*C - T*D
  // => T*D = T*C - C
  // => D = (T*C - C) / T
  //
  // We have T' = T * ONE_HUNDRED_PERCENT_BPS <=> T = T' / ONE_HUNDRED_PERCENT_BPS
  // => D = (T'*C / ONE_HUNDRED_PERCENT_BPS - C) / (T' / ONE_HUNDRED_PERCENT_BPS)
  // => D = (T'*C - C * ONE_HUNDRED_PERCENT_BPS) / T'
  return (
    (totalCollateralInBase * leverageBps -
      totalCollateralInBase * BigInt(ONE_HUNDRED_PERCENT_BPS)) /
    leverageBps
  );
}
