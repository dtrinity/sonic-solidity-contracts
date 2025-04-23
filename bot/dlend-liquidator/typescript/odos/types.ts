export interface InputToken {
  tokenAddress: string;
  amount: string;
}

export interface OutputToken {
  tokenAddress: string;
  proportion: number;
}

export interface QuoteRequest {
  chainId: number;
  inputTokens: InputToken[];
  outputTokens: OutputToken[];
  slippageLimitPercent: number;
  userAddr: string;
  referralCode?: number;
  disableRFQs?: boolean;
  compact?: boolean;
}

export interface QuoteResponse {
  inTokens: string[];
  outTokens: string[];
  inAmounts: string[];
  outAmounts: string[];
  gasEstimate: number;
  dataGasEstimate: number;
  gweiPerGas: number;
  gasEstimateValue: number;
  inValues: number[];
  outValues: number[];
  netOutValue: number;
  priceImpact: number;
  percentDiff: number;
  partnerFeePercent: number;
  pathId: string;
  pathViz: string | null;
  blockNumber: number;
  message?: string;
}

export interface AssembleRequest {
  userAddr: string;
  pathId: string;
  simulate?: boolean;
  receiver?: string;
}

export interface Transaction {
  to: string;
  from: string;
  data: string;
  value: string;
  gas: number;
  gasPrice: number;
}

export interface AssembleResponse {
  transaction: Transaction;
  message?: string;
}
