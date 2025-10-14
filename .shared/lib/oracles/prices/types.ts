import type { HardhatRuntimeEnvironment } from 'hardhat/types';
import type { DeploymentsExtension } from 'hardhat-deploy/types';

export type OracleInspectorLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export interface OracleInspectorOptions {
  aggregators?: string[];
  assets?: string[];
  json?: boolean;
  multicallAddress?: string;
  skipWrapperChecks?: boolean;
  chunkSize?: number;
}

export interface OracleInspectorContext {
  hre: HardhatRuntimeEnvironment;
  deployments: DeploymentsExtension;
  logger: OracleInspectorLogger;
  options: Required<OracleInspectorOptionsNormalized>;
}

export interface OracleInspectorOptionsNormalized extends OracleInspectorOptions {
  aggregators: string[];
  assets: string[];
  json: boolean;
  multicallAddress?: string;
  skipWrapperChecks: boolean;
  chunkSize: number;
}

export interface OracleAssetEntry {
  address: string;
  source?: string;
  symbol?: string;
  aggregatorPrice?: string;
  wrapperPrice?: string;
  wrapperAlive?: boolean;
  notes?: string[];
}

export interface OracleAggregatorRecord {
  key: string;
  address: string;
  assets: OracleAssetEntry[];
}

export interface OracleInspectorResult {
  network: string;
  aggregators: OracleAggregatorRecord[];
}
