import {
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
  liquidationThreshold: "9000", // 9500 bps = 95%
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
  supplyCap: "2500000", // Specific to dUSD
};

export const strategyDS: IReserveParams = {
  ...baseDStableConfig,
  supplyCap: "5000000", // Specific to dS
};

export const strategyDStable: IReserveParams = baseDStableConfig;

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
  supplyCap: "300",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

export const strategyYieldBearingStablecoin: IReserveParams = {
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
  supplyCap: "1000000",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

// This strategy is used for testing on Fraxtal testnet and local dev
export const strategyFXSTestnet: IReserveParams = {
  strategy: rateStrategyMediumLiquidityVolatile,
  baseLTVAsCollateral: "6000",
  liquidationThreshold: "7000",
  liquidationBonus: "10500",
  liquidationProtocolFee: "7000", // 70%
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  flashLoanEnabled: true,
  reserveDecimals: "18",
  aTokenImpl: eContractid.AToken,
  reserveFactor: "1000",
  supplyCap: "250000",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

export const strategyFRAX: IReserveParams = {
  strategy: rateStrategyMediumLiquidityVolatile,
  baseLTVAsCollateral: "6000",
  liquidationThreshold: "6500",
  liquidationBonus: "10500",
  liquidationProtocolFee: "7000", // 70%
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  flashLoanEnabled: true,
  reserveDecimals: "18",
  aTokenImpl: eContractid.AToken,
  reserveFactor: "1000",
  supplyCap: "62500",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
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

export const strategyFXB20291231: IReserveParams = {
  strategy: rateStrategyMediumLiquidityVolatile,
  baseLTVAsCollateral: "6000",
  liquidationThreshold: "6500",
  liquidationBonus: "10500",
  liquidationProtocolFee: "7000", // 70%
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  flashLoanEnabled: true,
  reserveDecimals: "18",
  aTokenImpl: eContractid.AToken,
  reserveFactor: "1000",
  supplyCap: "1340000",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

export const strategyscrvUSD: IReserveParams = {
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
  supplyCap: "200000",
  borrowCap: "0",
  debtCeiling: "0",
  borrowableIsolation: false,
};

export const strategyFXB20551231: IReserveParams = {
  ...strategyFXB20291231,
  supplyCap: "2000000",
};

export const strategyFXB20251231: IReserveParams = {
  ...strategyFXB20291231,
  supplyCap: "500000",
};

export const strategysDAI: IReserveParams = {
  ...strategyYieldBearingStablecoin,
  supplyCap: "175000",
};

export const strategyUSDe: IReserveParams = {
  ...strategyYieldBearingStablecoin,
  supplyCap: "350000",
};
