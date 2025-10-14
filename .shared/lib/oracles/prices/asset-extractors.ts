import type { OracleAssetEntry } from './types';

function isAddressLike(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function addAddress(target: Set<string>, value: unknown): void {
  if (isAddressLike(value) && value !== '0x0000000000000000000000000000000000000000') {
    target.add(value.toLowerCase());
  }
}

function collectAddressesFromObjectKeys(target: Set<string>, record: unknown): void {
  if (!record || typeof record !== 'object') {
    return;
  }
  for (const key of Object.keys(record as Record<string, unknown>)) {
    addAddress(target, key);
  }
}

type NestedCollector = (target: Set<string>, value: any) => void;

function collectAddressesFromValues(target: Set<string>, record: unknown, fields: string[], collectors?: Record<string, NestedCollector>): void {
  if (!record || typeof record !== 'object') {
    return;
  }
  for (const value of Object.values(record as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    for (const field of fields) {
      addAddress(target, (value as Record<string, unknown>)[field]);
    }
    if (collectors) {
      for (const [field, collector] of Object.entries(collectors)) {
        collector(target, (value as Record<string, unknown>)[field]);
      }
    }
  }
}

function collectCurveCompositeAssets(target: Set<string>, configSection: any): void {
  const curveSection = configSection?.curveOracleAssets?.curveApi3CompositeOracles;
  if (!curveSection || typeof curveSection !== 'object') {
    return;
  }
  collectAddressesFromObjectKeys(target, curveSection);
  for (const value of Object.values(curveSection)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const composite = (value as Record<string, unknown>).compositeAPI3Feed;
    if (!composite || typeof composite !== 'object') {
      continue;
    }
    addAddress(target, (composite as Record<string, unknown>).api3Asset);
  }
}

function collectSafeRateAssets(target: Set<string>, configSection: any): void {
  const safeSection = configSection?.safeRateProviderAssets;
  if (!safeSection || typeof safeSection !== 'object') {
    return;
  }

  const chainlinkWrappers = safeSection.chainlinkSafeRateProviderCompositeWrappers;
  const erc4626Wrappers = safeSection.erc4626SafeRateProviderWrappers;

  collectAddressesFromObjectKeys(target, chainlinkWrappers);
  collectAddressesFromValues(target, chainlinkWrappers, ['feedAsset']);

  collectAddressesFromObjectKeys(target, erc4626Wrappers);
  collectAddressesFromValues(target, erc4626Wrappers, ['feedAsset']);
}

function collectTellorAssets(target: Set<string>, configSection: any): void {
  const tellorSection = configSection?.tellorOracleAssets;
  if (!tellorSection || typeof tellorSection !== 'object') {
    return;
  }
  collectAddressesFromObjectKeys(target, tellorSection.plainTellorOracleWrappers);
  collectAddressesFromObjectKeys(target, tellorSection.tellorOracleWrappersWithThresholding);
}

function collectRedstoneAssets(target: Set<string>, configSection: any): void {
  const redstoneSection = configSection?.redstoneOracleAssets;
  if (!redstoneSection || typeof redstoneSection !== 'object') {
    return;
  }
  collectAddressesFromObjectKeys(target, redstoneSection.plainRedstoneOracleWrappers);
  collectAddressesFromObjectKeys(target, redstoneSection.redstoneOracleWrappersWithThresholding);
  collectAddressesFromObjectKeys(target, redstoneSection.compositeRedstoneOracleWrappersWithThresholding);

  collectAddressesFromValues(target, redstoneSection.compositeRedstoneOracleWrappersWithThresholding, ['feedAsset']);
}

function collectApi3Assets(target: Set<string>, configSection: any): void {
  const api3Section = configSection?.api3OracleAssets;
  if (!api3Section || typeof api3Section !== 'object') {
    return;
  }
  collectAddressesFromObjectKeys(target, api3Section.plainApi3OracleWrappers);
  collectAddressesFromObjectKeys(target, api3Section.api3OracleWrappersWithThresholding);
  collectAddressesFromObjectKeys(target, api3Section.compositeApi3OracleWrappersWithThresholding);

  collectAddressesFromValues(target, api3Section.compositeApi3OracleWrappersWithThresholding, ['feedAsset']);
}

function collectDexAssets(target: Set<string>, configSection: any): void {
  collectAddressesFromObjectKeys(target, configSection?.dexOracleAssets);
}

function collectChainlinkCompositeAssets(target: Set<string>, configSection: any): void {
  collectAddressesFromObjectKeys(target, configSection?.chainlinkCompositeAggregator);
  collectAddressesFromObjectKeys(target, configSection?.chainlinkCompositeWrapperAggregator);
}

export function collectAggregatorAssets(aggregatorConfig: any): Set<string> {
  const assets = new Set<string>();
  if (!aggregatorConfig || typeof aggregatorConfig !== 'object') {
    return assets;
  }

  addAddress(assets, aggregatorConfig.dUSDAddress ?? aggregatorConfig.baseCurrency);
  collectApi3Assets(assets, aggregatorConfig);
  collectRedstoneAssets(assets, aggregatorConfig);
  collectTellorAssets(assets, aggregatorConfig);
  collectSafeRateAssets(assets, aggregatorConfig);
  collectDexAssets(assets, aggregatorConfig);
  collectChainlinkCompositeAssets(assets, aggregatorConfig);
  collectCurveCompositeAssets(assets, aggregatorConfig);

  return assets;
}

export function buildSymbolLookup(config: any): Map<string, string> {
  const symbols = new Map<string, string>();

  const appendFromRecord = (record: any, fallbackPrefix?: string) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    for (const [symbol, address] of Object.entries(record as Record<string, unknown>)) {
      if (!isAddressLike(address)) {
        continue;
      }
      const key = address.toLowerCase();
      const label = symbol || fallbackPrefix;
      if (label) {
        symbols.set(key, label);
      }
    }
  };

  appendFromRecord(config?.tokenAddresses);
  appendFromRecord(config?.lending?.reserveAssetAddresses);
  appendFromRecord(config?.lending?.chainlinkAggregatorAddresses, 'feed');

  if (isAddressLike(config?.dusd?.address ?? config?.dUSDAddress)) {
    symbols.set((config.dusd?.address ?? config.dUSDAddress).toLowerCase(), 'dUSD');
  }

  if (Array.isArray(config?.dusd?.collaterals)) {
    for (const address of config.dusd.collaterals) {
      if (isAddressLike(address) && !symbols.has(address.toLowerCase())) {
        symbols.set(address.toLowerCase(), 'collateral');
      }
    }
  }

  return symbols;
}

export function buildAggregatorList(config: any): { key: string; assets: OracleAssetEntry[] }[] {
  const aggregators: { key: string; assets: OracleAssetEntry[] }[] = [];
  const symbolLookup = buildSymbolLookup(config);

  if (config?.oracleAggregators && typeof config.oracleAggregators === 'object') {
    for (const [key, aggregatorConfig] of Object.entries(config.oracleAggregators as Record<string, unknown>)) {
      const assets = collectAggregatorAssets(aggregatorConfig);
      aggregators.push({
        key,
        assets: Array.from(assets).map(address => ({
          address,
          symbol: symbolLookup.get(address),
        })),
      });
    }
  } else if (config?.oracleAggregator) {
    const assets = collectAggregatorAssets(config.oracleAggregator);
    aggregators.push({
      key: 'OracleAggregator',
      assets: Array.from(assets).map(address => ({
        address,
        symbol: symbolLookup.get(address),
      })),
    });
  }

  return aggregators;
}
