export interface Config {
  readonly liquidatorBotOdos?: LiquidatorBotOdosConfig;
}

export interface LiquidatorBotConfig {
  readonly flashMinter: string;
  readonly dUSDAddress: string;
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
  // Mapping from token address to the proxy contract address
  readonly proxyContractMap: {
    [tokenAddress: string]: string;
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