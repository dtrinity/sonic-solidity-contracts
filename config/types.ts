import { Address } from "hardhat-deploy/types";

import { DLendConfig } from "./dlend/types";

export interface Config {
  readonly MOCK_ONLY?: MockConfig;
  readonly tokenAddresses: TokenAddresses;
  readonly walletAddresses: WalletAddresses;
  readonly oracleAggregators: {
    [key: string]: OracleAggregatorConfig;
  };
  readonly dStables: {
    [key: string]: DStableConfig;
  };
  readonly dLend: DLendConfig;
  readonly odos?: {
    readonly router: string;
  };
  readonly dStake?: {
    [key: string]: DStakeInstanceConfig; // e.g., sdUSD, sdS
  };
  readonly dPool?: {
    [key: string]: DPoolInstanceConfig; // e.g., dUSD-USDC_Curve
  };
}

// Configuration for mocking infrastructure on local and test networks
export interface MockConfig {
  readonly tokens: {
    [key: string]: {
      readonly name: string;
      readonly address?: string;
      readonly decimals: number;
      readonly initialSupply: number;
    };
  };
}

export interface DStableConfig {
  readonly collaterals: Address[];
}

export interface TokenAddresses {
  readonly wS: string;
  readonly dUSD: string;
  readonly dS: string;
  readonly [key: string]: string; // dLEND assets must be defined as well
}

export interface WalletAddresses {
  readonly governanceMultisig: string;
  readonly incentivesVault: string;
}

export interface OracleAggregatorConfig {
  readonly priceDecimals: number;
  readonly hardDStablePeg: bigint;
  readonly baseCurrency: string;
  readonly api3OracleAssets: {
    plainApi3OracleWrappers: {
      [key: string]: string;
    };
    api3OracleWrappersWithThresholding: {
      [key: string]: {
        proxy: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    compositeApi3OracleWrappersWithThresholding: {
      [key: string]: {
        feedAsset: string;
        proxy1: string;
        proxy2: string;
        lowerThresholdInBase1: bigint;
        fixedPriceInBase1: bigint;
        lowerThresholdInBase2: bigint;
        fixedPriceInBase2: bigint;
      };
    };
  };
  readonly redstoneOracleAssets: {
    plainRedstoneOracleWrappers: {
      [key: string]: string;
    };
    redstoneOracleWrappersWithThresholding: {
      [key: string]: {
        feed: string;
        lowerThreshold: bigint;
        fixedPrice: bigint;
      };
    };
    compositeRedstoneOracleWrappersWithThresholding: {
      [key: string]: {
        feedAsset: string;
        feed1: string;
        feed2: string;
        lowerThresholdInBase1: bigint;
        fixedPriceInBase1: bigint;
        lowerThresholdInBase2: bigint;
        fixedPriceInBase2: bigint;
      };
    };
  };
}

export interface IInterestRateStrategyParams {
  readonly name: string;
  readonly optimalUsageRatio: string;
  readonly baseVariableBorrowRate: string;
  readonly variableRateSlope1: string;
  readonly variableRateSlope2: string;
  readonly stableRateSlope1: string;
  readonly stableRateSlope2: string;
  readonly baseStableRateOffset: string;
  readonly stableRateExcessOffset: string;
  readonly optimalStableToTotalDebtRatio: string;
}

export interface IReserveBorrowParams {
  readonly borrowingEnabled: boolean;
  readonly stableBorrowRateEnabled: boolean;
  readonly reserveDecimals: string;
  readonly borrowCap: string;
  readonly debtCeiling: string;
  readonly borrowableIsolation: boolean;
  readonly flashLoanEnabled: boolean;
}

export interface IReserveCollateralParams {
  readonly baseLTVAsCollateral: string;
  readonly liquidationThreshold: string;
  readonly liquidationBonus: string;
  readonly liquidationProtocolFee?: string;
}

export interface IReserveParams
  extends IReserveBorrowParams,
    IReserveCollateralParams {
  readonly aTokenImpl: string;
  readonly reserveFactor: string;
  readonly supplyCap: string;
  readonly strategy: IInterestRateStrategyParams;
}

// --- dStake Types ---

export interface DStakeAdapterConfig {
  readonly vaultAsset: Address; // Address of the vault asset (e.g., wddUSD)
  readonly adapterContract: string; // Contract name for deployment (e.g., dLendConversionAdapter)
}

export interface DLendRewardManagerConfig {
  readonly managedVaultAsset: Address; // Address of the StaticATokenLM wrapper this manager handles (e.g. wddUSD)
  readonly dLendAssetToClaimFor: Address; // Address of the underlying aToken in dLEND (e.g. aDUSD)
  readonly dLendRewardsController: Address; // Address of the dLEND RewardsController
  readonly treasury: Address; // Address for treasury fees
  readonly maxTreasuryFeeBps: number;
  readonly initialTreasuryFeeBps: number;
  readonly initialExchangeThreshold: number; // Min dStable amount to trigger compounding
  readonly initialAdmin?: Address; // Optional: admin for this DStakeRewardManagerDLend instance
  readonly initialRewardsManager?: Address; // Optional: holder of REWARDS_MANAGER_ROLE for this instance
}

export interface DStakeInstanceConfig {
  readonly dStable: Address; // Address of the underlying dSTABLE (e.g., dUSD)
  readonly name: string; // Name for DStakeToken (e.g., "Staked dUSD")
  readonly symbol: string; // Symbol for DStakeToken (e.g., "sdUSD")
  readonly initialAdmin: Address;
  readonly initialFeeManager: Address;
  readonly initialWithdrawalFeeBps: number;
  readonly adapters: DStakeAdapterConfig[]; // List of supported adapters/vault assets
  readonly defaultDepositVaultAsset: Address; // Initial default vault asset for deposits
  readonly collateralExchangers: Address[]; // List of allowed exchanger addresses
  readonly collateralVault?: Address; // The DStakeCollateralVault for this instance (needed for adapter deployment)
  readonly dLendRewardManager?: DLendRewardManagerConfig; // Added for dLend rewards
}

// --- dPool Types ---

export interface DPoolInstanceConfig {
  readonly baseAsset: string; // Reference to token in config (e.g., "USDC", "dUSD")
  readonly name: string; // Name for the vault (e.g., "dPOOL USDC/USDS")
  readonly symbol: string; // Symbol for the vault (e.g., "dpUSDC_USDS")
  readonly initialAdmin: Address;
  readonly initialSlippageBps?: number; // Initial max slippage setting in BPS for periphery
  readonly pool: string; // Pool deployment name (localhost) or pool address (testnet/mainnet)
  // Examples by environment:
  // - localhost: "USDC_USDS_CurvePool" (deployment name)
  // - testnet: "0x742d35Cc6634C0532925a3b8D404fEdF6Caf9cd5" (actual pool address)
  // - mainnet: "0xA5407eAE9Ba41422680e2e00537571bcC53efBfD" (actual pool address)
}
