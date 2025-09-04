import {
  rateStrategyDUSD,
  rateStrategyHighLiquidityStable,
  rateStrategyHighLiquidityVolatile,
  rateStrategyMediumLiquidityStable,
  rateStrategyMediumLiquidityVolatile,
} from "./interest-rate-strategies";
import { eContractid, IReserveParams } from "./types";

// Explainer: https://docs.aave.com/developers/guides/governance-guide/asset-listing
const baseDStableConfig: IReserveParams = {
  strategy: rateStrategyHighLiquidityStable,
  // CAUTION: If LTV is > 0, people may loop and dillute other borrowers
  baseLTVAsCollateral: "0", // 0 Don't allow dStable as collateral to prevent subsidy syphoning
  liquidationThreshold: "9000", // 9000 bps = 90%, must be non-zero to allow reserve updates
  liquidationBonus: "10500", // 10500 bps = 105%, amount over 100% is the fee portion
  liquidationProtocolFee: "7000", // 7000 bps = 70%
  borrowingEnabled: true,
  stableBorrowRateEnabled: false, // No stable rates due to vulnerability
  flashLoanEnabled: true,
  reserveDecimals: "18",
  aTokenImpl: eContractid.AToken,
  reserveFactor: "1000", // 1000 bps = 10%
  supplyCap: "0", // these are decimal units, not raw on-chain integer values
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

export const strategyDUSD: IReserveParams = {
  ...baseDStableConfig,
  strategy: rateStrategyDUSD,
  supplyCap: "2500000", // Specific to dUSD
};

export const strategyDS: IReserveParams = {
  ...baseDStableConfig,
  supplyCap: "5000000", // Specific to dS
};

export const strategyWETH: IReserveParams = {
  strategy: rateStrategyHighLiquidityVolatile,
  baseLTVAsCollateral: "8000",
  liquidationThreshold: "8500",
  liquidationBonus: "10500",
  liquidationProtocolFee: "7000", // 70%
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  flashLoanEnabled: true,
  reserveDecimals: "18",
  aTokenImpl: eContractid.AToken,
  reserveFactor: "1000",
  supplyCap: "500",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

const baseYieldBearingStablecoinConfig: IReserveParams = {
  strategy: rateStrategyMediumLiquidityStable,
  baseLTVAsCollateral: "8000",
  liquidationThreshold: "8500",
  liquidationBonus: "10500",
  liquidationProtocolFee: "7000", // 70%
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  flashLoanEnabled: true,
  reserveDecimals: "18",
  aTokenImpl: eContractid.AToken,
  reserveFactor: "1000",
  supplyCap: "0", // these are decimal units, not raw on-chain integer values
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

export const strategyStS: IReserveParams = {
  ...baseYieldBearingStablecoinConfig,
  supplyCap: "5000000", // Specific to stS
};

export const strategySfrxUSD: IReserveParams = {
  ...baseYieldBearingStablecoinConfig,
  supplyCap: "1000000", // Specific to sfrxUSD
};

export const strategyWstkscUSD: IReserveParams = {
  ...baseYieldBearingStablecoinConfig,
  supplyCap: "2500000", // Specific to wstkscUSD
};

export const strategyETHLST: IReserveParams = {
  strategy: rateStrategyMediumLiquidityVolatile,
  baseLTVAsCollateral: "8000",
  liquidationThreshold: "8500",
  liquidationBonus: "10500",
  liquidationProtocolFee: "7000", // 70%
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  flashLoanEnabled: true,
  reserveDecimals: "18",
  aTokenImpl: eContractid.AToken,
  reserveFactor: "1000",
  supplyCap: "300",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

export const strategyscETH: IReserveParams = {
  ...strategyETHLST,
  supplyCap: "500",
};

export const strategywstkscETH: IReserveParams = {
  ...strategyETHLST,
  supplyCap: "200",
};

export const strategyPTaUSDC: IReserveParams = {
  ...baseYieldBearingStablecoinConfig,
  supplyCap: "1000000",
};

export const strategyPTwstkscUSD: IReserveParams = {
  ...baseYieldBearingStablecoinConfig,
  supplyCap: "1000000",
};

export const strategywOS: IReserveParams = {
  ...baseYieldBearingStablecoinConfig,
  supplyCap: "500000",
};
