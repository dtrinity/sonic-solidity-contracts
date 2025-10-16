import type { HardhatRuntimeEnvironment } from 'hardhat/types';
import type { DeploymentsExtension } from 'hardhat-deploy/types';

import { logger as defaultLogger } from '../../logger';
import { classifyDeployments } from './deployment-classifier';
import { buildAggregatorList, buildSymbolLookup } from './asset-extractors';
import type {
  OracleAssetEntry,
  OracleAggregatorRecord,
  OracleInspectorOptions,
  OracleInspectorOptionsNormalized,
  OracleInspectorResult,
} from './types';
import { loadNetworkOracleConfig } from './config-loader';

function normalizeOptions(options: OracleInspectorOptions | undefined): OracleInspectorOptionsNormalized {
  const aggregators = (options?.aggregators ?? []).map(name => name.toLowerCase());
  const assets = (options?.assets ?? []).map(address => address.toLowerCase());

  return {
    aggregators,
    assets,
    json: Boolean(options?.json),
    multicallAddress: options?.multicallAddress,
    skipWrapperChecks: Boolean(options?.skipWrapperChecks),
    chunkSize: options?.chunkSize ?? 300,
  };
}

function inferDecimalsFromUnit(unit: bigint | number | undefined): number {
  if (unit === undefined) {
    return 18;
  }
  try {
    let big = BigInt(unit);
    let decimals = 0;
    while (big > 1n && big % 10n === 0n) {
      big /= 10n;
      decimals += 1;
    }
    return decimals > 0 ? decimals : 18;
  } catch {
    return 18;
  }
}

type DeploymentsEnabledHre = HardhatRuntimeEnvironment & {
  deployments: DeploymentsExtension;
  ethers: any;
};

async function resolveAggregatorAddress(
  hre: DeploymentsEnabledHre,
  key: string,
  deploymentNames: Set<string>,
): Promise<{ address: string; name: string } | undefined> {
  const candidates = [
    `${key}_OracleAggregator`,
    `${key}OracleAggregator`,
    key,
    `${key}_oracle_aggregator`,
    'OracleAggregator',
  ];

  for (const candidate of candidates) {
    try {
      const deployment = await hre.deployments.getOrNull(candidate);
      if (deployment?.address) {
        return { address: deployment.address, name: candidate };
      }
    } catch {
      // continue searching
    }
  }

  // Try to match against deployment names we already discovered (case-insensitive)
  for (const candidate of candidates) {
    const match = Array.from(deploymentNames).find(name => name.toLowerCase() === candidate.toLowerCase());
    if (match) {
      const deployment = await hre.deployments.getOrNull(match);
      if (deployment?.address) {
        return { address: deployment.address, name: match };
      }
    }
  }

  return undefined;
}

interface AssetInspection {
  asset: OracleAssetEntry;
  aggregatorPrice?: string;
  wrapperAddress?: string;
  wrapperPrice?: string;
  wrapperAlive?: boolean;
  notes: string[];
}

async function inspectAggregator(
  hre: DeploymentsEnabledHre,
  aggregatorKey: string,
  aggregatorAddress: string,
  assets: OracleAssetEntry[],
  options: OracleInspectorOptionsNormalized,
): Promise<OracleAggregatorRecord> {
  const results: AssetInspection[] = assets.map(asset => ({
    asset,
    notes: [],
  }));

  const AGGREGATOR_ABI = [
    'function BASE_CURRENCY_UNIT() view returns (uint256)',
    'function getAssetPrice(address) view returns (uint256)',
    'function assetOracles(address) view returns (address)',
  ];
  const WRAPPER_ABI = [
    'function BASE_CURRENCY_UNIT() view returns (uint256)',
    'function getPriceInfo(address) view returns (uint256,bool)',
    'function getAssetPrice(address) view returns (uint256)',
  ];

  const aggregatorContract = await hre.ethers.getContractAt(AGGREGATOR_ABI, aggregatorAddress);

  let baseCurrencyUnit: bigint | undefined;
  try {
    const unit = await aggregatorContract.getFunction('BASE_CURRENCY_UNIT').staticCall();
    baseCurrencyUnit = BigInt(unit);
  } catch {
    baseCurrencyUnit = undefined;
  }
  const decimals = inferDecimalsFromUnit(baseCurrencyUnit);

  const aggregatorPrices = new Map<string, bigint>();
  const wrapperPointers = new Map<string, string>();

  for (const entry of results) {
    try {
      const price = await aggregatorContract.getFunction('getAssetPrice').staticCall(entry.asset.address);
      aggregatorPrices.set(entry.asset.address.toLowerCase(), BigInt(price));
    } catch (error) {
      entry.notes.push(`Aggregator lookup failed: ${(error as Error).message}`);
    }
    try {
      const pointer = await aggregatorContract.getFunction('assetOracles').staticCall(entry.asset.address);
      if (typeof pointer === 'string') {
        wrapperPointers.set(entry.asset.address.toLowerCase(), pointer.toLowerCase());
      }
    } catch {
      // not every aggregator exposes assetOracles
    }
  }

  const wrapperUnitCache = new Map<string, number>();

  for (const entry of results) {
    const lower = entry.asset.address.toLowerCase();
    const aggPrice = aggregatorPrices.get(lower);
    if (aggPrice !== undefined) {
      entry.aggregatorPrice = hre.ethers.formatUnits(aggPrice, decimals);
    }

    const pointer = wrapperPointers.get(lower);
    if (!pointer || pointer === hre.ethers.ZeroAddress.toLowerCase()) {
      continue;
    }

    entry.wrapperAddress = pointer;

    if (options.skipWrapperChecks) {
      continue;
    }

    try {
      const wrapperContract = await hre.ethers.getContractAt(WRAPPER_ABI, pointer);
      let wrapperDecimals = wrapperUnitCache.get(pointer);
      if (wrapperDecimals === undefined) {
        try {
          const unit = await wrapperContract.getFunction('BASE_CURRENCY_UNIT').staticCall();
          wrapperDecimals = inferDecimalsFromUnit(unit);
          wrapperUnitCache.set(pointer, wrapperDecimals);
        } catch {
          wrapperDecimals = decimals;
          wrapperUnitCache.set(pointer, wrapperDecimals);
        }
      }

      try {
        const [price, isAlive] = await wrapperContract
          .getFunction('getPriceInfo')
          .staticCall(entry.asset.address)
          .catch(async () => {
            const fallback = await wrapperContract.getFunction('getAssetPrice').staticCall(entry.asset.address);
            return [fallback, true];
          });
        entry.wrapperPrice = hre.ethers.formatUnits(price, wrapperDecimals);
        entry.wrapperAlive = Boolean(isAlive);
      } catch (wrapperError) {
        entry.notes.push(`Wrapper lookup failed: ${(wrapperError as Error).message}`);
      }
    } catch (contractError) {
      entry.notes.push(`Wrapper contract unavailable: ${(contractError as Error).message}`);
    }
  }

  return {
    key: aggregatorKey,
    address: aggregatorAddress,
    assets: results.map(entry => ({
      address: entry.asset.address,
      symbol: entry.asset.symbol,
      source: entry.wrapperAddress,
      aggregatorPrice: entry.aggregatorPrice,
      wrapperPrice: entry.wrapperPrice,
      wrapperAlive: entry.wrapperAlive,
      notes: entry.notes.length > 0 ? entry.notes : undefined,
    })) as OracleAssetEntry[],
  } satisfies OracleAggregatorRecord;
}

export async function runOraclePriceInspector(
  hre: HardhatRuntimeEnvironment,
  rawOptions?: OracleInspectorOptions,
): Promise<OracleInspectorResult> {
  const env = hre as DeploymentsEnabledHre;
  const log = defaultLogger;
  const options = normalizeOptions(rawOptions);

  const config = await loadNetworkOracleConfig(env);
  if (!config) {
    throw new Error(`Unable to load network config for ${env.network.name}`);
  }

  const aggregators = buildAggregatorList(config);
  const aggregatorFilter = new Set(options.aggregators);

  const deployments = await classifyDeployments(env.deployments);
  const deploymentNames = new Set(deployments.aggregators.map(item => item.name ?? '').filter(Boolean));

  const manualAssets = options.assets.map(address => ({ address, symbol: buildSymbolLookup(config).get(address) }));
  const inspectedAggregators: OracleAggregatorRecord[] = [];

  for (const aggregator of aggregators) {
    if (aggregatorFilter.size > 0 && !aggregatorFilter.has(aggregator.key.toLowerCase())) {
      continue;
    }

    const resolved = await resolveAggregatorAddress(env, aggregator.key, deploymentNames);
    if (!resolved) {
      log.warn(`No deployment found for aggregator key ${aggregator.key}`);
      continue;
    }

    const assetEntries = [...aggregator.assets];
    for (const asset of manualAssets) {
      if (!assetEntries.some(existing => existing.address === asset.address)) {
        assetEntries.push(asset);
      }
    }

    log.info(`Inspecting aggregator ${aggregator.key} at ${resolved.address}`);
    const record = await inspectAggregator(env, aggregator.key, resolved.address, assetEntries, options);
    inspectedAggregators.push(record);
  }

  if (aggregatorFilter.size > 0 && inspectedAggregators.length === 0) {
    log.warn(`No aggregators matched requested filters: ${Array.from(aggregatorFilter).join(', ')}`);
  }

  return {
    network: env.network.name,
    aggregators: inspectedAggregators,
  };
}
