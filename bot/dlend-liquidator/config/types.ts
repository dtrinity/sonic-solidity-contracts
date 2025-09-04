export interface Config {
  readonly parentDeploymentAddresses: {
    poolAddressesProvider: string;
    poolDataProvider: string;
    aaveOracle: string;
    liquidationLogic: string;
  };
  // Mapping from token address to the proxy contract address
  readonly tokenProxyContractMap: {
    [tokenAddress: string]: string;
  };
  readonly liquidatorBotOdos?: LiquidatorBotOdosConfig;
  readonly pendle?: PendleConfig;
}

export interface LiquidatorBotConfig {
  readonly flashMinters: {
    dUSD: string;
    dS: string;
  };
  readonly slippageTolerance: number;
  readonly healthFactorThreshold: number;
  readonly healthFactorBatchSize: number;
  readonly reserveBatchSize: number;
  readonly profitableThresholdInUSD: number;
  readonly liquidatingBatchSize: number;
  readonly graphConfig: {
    url: string;
    batchSize: number;
  };
  // Mapping from token address to whether it requires unstaking
  readonly isUnstakeTokens: {
    [tokenAddress: string]: boolean;
  };
}

export interface LiquidatorBotOdosConfig extends LiquidatorBotConfig {
  readonly odosRouter: string;
  readonly odosApiUrl: string;
}

export interface PendleConfig {
  readonly pyFactory: string;
}
