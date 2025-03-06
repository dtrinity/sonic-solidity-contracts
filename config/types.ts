export interface Config {
  readonly MOCK_ONLY?: MockConfig;
  readonly dusd: DusdConfig;
  readonly ds: DsConfig;
  readonly oracleAggregator: OracleAggregatorConfig;
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

export interface DusdConfig {
  readonly address: string;
}

export interface DsConfig {
  readonly address: string;
}

export interface OracleAggregatorConfig {
  readonly dUSDAddress: string;
  readonly dSAddress: string;
  readonly priceDecimals: number;
  readonly hardDusdPeg: number;
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
}
