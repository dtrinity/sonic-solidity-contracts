import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import hre from "hardhat";

import { getConfig } from "../../config/config";
import { batchProcessing } from "../common/batch";
import { getOraclePrice } from "../dlend_helpers/oracle";
import { getPoolContractAddress } from "../dlend_helpers/pool";
import {
  getReserveConfigurationData,
  getReservesList,
  getUserDebtBalance,
  getUserReserveInfo,
  getUserSupplyBalance,
  UserReserveInfo,
} from "../dlend_helpers/reserve";
import { getUserHealthFactor } from "../dlend_helpers/user";
import PercentMath, { pow10 } from "../maths/PercentMath";
import { TokenInfo } from "../token/info";

/**
 * Get the close factor hard fork threshold
 *
 * @returns - The close factor hard fork threshold (ie. 0.951234 means 95.1234%)
 */
export async function getCloseFactorHFThreshold(): Promise<number> {
  const config = await getConfig(hre);

  if (!config.parentDeploymentAddresses.liquidationLogic) {
    throw new Error(
      "Liquidation logic address is not found at config.parentDeploymentAddresses.liquidationLogic",
    );
  }

  const liquidationLogicContract = await hre.ethers.getContractAt(
    ["function CLOSE_FACTOR_HF_THRESHOLD() external view returns (uint256)"],
    config.parentDeploymentAddresses.liquidationLogic,
  );
  const closeFactorHFThresholdRaw =
    await liquidationLogicContract.CLOSE_FACTOR_HF_THRESHOLD();
  // The CLOSE_FACTOR_HF_THRESHOLD is a fixed-point number with 18 decimals
  // The division is to make the closeFactorHFThreshold a number with 4 decimals
  const closeFactorHFThreshold = BigNumber.from(closeFactorHFThresholdRaw)
    .div(1e14)
    .toNumber();
  return closeFactorHFThreshold / 1e4;
}

/**
 * Calculate the maximum liquidation amount
 * - Reference: https://github.com/morpho-labs/morpho-liquidation-flash/blob/175823cdaa74894085fc7c1e7ac57b7084f284ed/src/morpho/MorphoAaveAdapter.ts#L33-L75
 *
 * @param collateralTokenInfo - The collateral token info
 * @param totalUserCollateral - The total user collateral
 * @param collateralTokenPriceInUSD - The collateral token price in USD
 * @param borrowTokenInfo - The borrow token info
 * @param totalUserDebt - The total user debt
 * @param borrowTokenPriceInUSD - The borrow token price in USD
 * @param liquidationBonus - The liquidation bonus
 * @param userHealthFactor - The user health factor
 * @param closeFactorHFThreshold - The close factor health factor threshold
 * @returns The maximum liquidation amount
 */
export function getMaxLiquidationAmountCalculation(
  collateralTokenInfo: TokenInfo,
  totalUserCollateral: BigNumber,
  collateralTokenPriceInUSD: BigNumberish,
  borrowTokenInfo: TokenInfo,
  totalUserDebt: BigNumber,
  borrowTokenPriceInUSD: BigNumberish,
  liquidationBonus: BigNumber,
  userHealthFactor: number,
  closeFactorHFThreshold: number,
): {
  toLiquidateAmount: BigNumber;
} {
  if (userHealthFactor >= 1) {
    return {
      toLiquidateAmount: BigNumber.from(0),
    };
  }

  const totalUserCollateralInUSD = totalUserCollateral
    .mul(collateralTokenPriceInUSD)
    .div(pow10(collateralTokenInfo.decimals));

  let toLiquidateAmount = totalUserDebt.div(2);

  if (userHealthFactor < closeFactorHFThreshold) {
    toLiquidateAmount = totalUserDebt;
  }

  const toLiquidateAmountInUSD = toLiquidateAmount
    .mul(borrowTokenPriceInUSD)
    .div(pow10(borrowTokenInfo.decimals));

  if (
    PercentMath.percentMul(toLiquidateAmountInUSD, liquidationBonus).gt(
      totalUserCollateralInUSD,
    )
  ) {
    toLiquidateAmount = PercentMath.percentDiv(
      totalUserCollateralInUSD,
      liquidationBonus,
    )
      .mul(pow10(borrowTokenInfo.decimals))
      .div(borrowTokenPriceInUSD);
  }

  return {
    toLiquidateAmount: toLiquidateAmount,
  };
}

/**
 * Get the maximum liquidation amount of the borrower
 *
 * @param collateralTokenInfo - The collateral token info
 * @param borrowTokenInfo - The borrow token info
 * @param borrowerAddress - Address of the borrower
 * @param callerAddress - Address of the caller
 * @returns The maximum liquidation amount
 */
export async function getMaxLiquidationAmount(
  collateralTokenInfo: TokenInfo,
  borrowTokenInfo: TokenInfo,
  borrowerAddress: string,
  callerAddress: string,
): Promise<{
  toLiquidateAmount: BigNumber;
}> {
  const [
    collateralTokenPriceInUSD,
    borrowTokenPriceInUSD,
    totalUserCollateral,
    totalUserDebt,
    { liquidationBonus },
  ] = await Promise.all([
    getOraclePrice(callerAddress, collateralTokenInfo.address),
    getOraclePrice(callerAddress, borrowTokenInfo.address),
    getUserSupplyBalance(collateralTokenInfo.address, borrowerAddress),
    getUserDebtBalance(borrowTokenInfo.address, borrowerAddress),
    getReserveConfigurationData(collateralTokenInfo.address),
  ]);

  const liquidationBonusBN = BigNumber.from(liquidationBonus);
  const closeFactorHFThreshold = await getCloseFactorHFThreshold();
  const userHealthFactor = await getUserHealthFactor(borrowerAddress);

  return getMaxLiquidationAmountCalculation(
    collateralTokenInfo,
    totalUserCollateral,
    collateralTokenPriceInUSD,
    borrowTokenInfo,
    totalUserDebt,
    borrowTokenPriceInUSD,
    liquidationBonusBN,
    userHealthFactor,
    closeFactorHFThreshold,
  );
}

/**
 * Get the liquidation profit in USD
 *
 * @param borrowTokenInfo - The borrow token info
 * @param borrowTokenPriceInUSD - The borrow token price in USD
 * @param borrowTokenPriceInUSD.rawValue - The borrow token price in USD
 * @param borrowTokenPriceInUSD.decimals - The borrow token price decimals
 * @param liquidateRawAmount - The liquidate raw amount
 * @returns The liquidation profit in USD
 */
export async function getLiquidationProfitInUSD(
  borrowTokenInfo: TokenInfo,
  borrowTokenPriceInUSD: {
    rawValue: BigNumber;
    decimals: number;
  },
  liquidateRawAmount: bigint,
): Promise<number> {
  const { liquidationBonus } = await getReserveConfigurationData(
    borrowTokenInfo.address,
  );

  const liquidateAmountInUSD =
    borrowTokenPriceInUSD.rawValue.mul(liquidateRawAmount);

  let res = PercentMath.percentMul(
    liquidateAmountInUSD,
    BigNumber.from(liquidationBonus).sub(PercentMath.BASE_PERCENT),
  );
  res = res.div(pow10(borrowTokenInfo.decimals));

  return res.toNumber() / 10 ** borrowTokenPriceInUSD.decimals;
}

/**
 * Get the user liquidation parameters for Odos
 *
 * @param userAddress - Address of the user
 * @returns The user liquidation parameters
 */
export async function getUserLiquidationParams(userAddress: string): Promise<{
  userAddress: string;
  collateralToken: UserReserveInfo;
  debtToken: UserReserveInfo;
  toLiquidateAmount: BigNumber;
}> {
  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  const reserveAddresses = await getReservesList(
    await getPoolContractAddress(),
  );

  const reserveInfos: UserReserveInfo[] = await batchProcessing(
    reserveAddresses,
    config.liquidatorBotOdos.reserveBatchSize,
    (reserveAddress) => getUserReserveInfo(userAddress, reserveAddress),
    false,
  );

  const availableDebtMarkets = reserveInfos.filter((r) => r.borrowingEnabled);
  const [debtMarket] = availableDebtMarkets.sort((a, b) =>
    a.totalDebt.gt(b.totalDebt) ? -1 : 1,
  );

  const availableCollateralMarkets = reserveInfos.filter(
    (r) => r.usageAsCollateralEnabled,
  );
  const [collateralMarket] = availableCollateralMarkets
    .filter((b) => b.liquidationBonus.gt(0))
    .sort((a, b) => (a.totalSupply.gt(b.totalSupply) ? -1 : 1));

  const { deployer } = await hre.getNamedAccounts();
  const maxLiquidationAmount = await getMaxLiquidationAmount(
    collateralMarket.reserveTokenInfo,
    debtMarket.reserveTokenInfo,
    userAddress,
    deployer,
  );

  return {
    userAddress,
    collateralToken: collateralMarket,
    debtToken: debtMarket,
    toLiquidateAmount: maxLiquidationAmount.toLiquidateAmount,
  };
}
