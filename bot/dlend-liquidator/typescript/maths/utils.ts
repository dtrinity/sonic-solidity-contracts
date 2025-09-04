/**
 * Calculate the number of decimals of a price unit.
 *
 * @param priceUnit - The price unit (e.g. 1e18, 1e6...)
 * @returns - The number of decimals (e.g. 18, 6...)
 */
export function getDecimals(priceUnit: bigint): number {
  // Cannot use log10 directly as it will cause overflow for large numbers
  // using using Math.log10()
  return priceUnit.toString().length - 1;
}
