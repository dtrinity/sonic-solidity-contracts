import { isAddress, ZeroAddress } from "ethers";

import { OracleAggregatorConfig } from "../../config/types";

const DEFAULT_MIN_PRICE = 0.01;
const DEFAULT_MAX_PRICE = 1e6;

type Address = string;

export interface ThresholdState {
  lowerThresholdInBase: bigint;
  fixedPriceInBase: bigint;
}

export interface Api3SetupPlan {
  plain: Array<{
    asset: Address;
    proxy: Address;
  }>;
  threshold: Array<{
    asset: Address;
    proxy: Address;
    lowerThreshold: bigint;
    fixedPrice: bigint;
  }>;
  composite: Array<{
    configKey: Address;
    asset: Address;
    proxy1: Address;
    proxy2: Address;
    lowerThresholdInBase1: bigint;
    fixedPriceInBase1: bigint;
    lowerThresholdInBase2: bigint;
    fixedPriceInBase2: bigint;
  }>;
}

export interface RedstoneSetupPlan {
  plain: Array<{
    asset: Address;
    feed: Address;
  }>;
  threshold: Array<{
    asset: Address;
    feed: Address;
    lowerThreshold: bigint;
    fixedPrice: bigint;
  }>;
  composite: Array<{
    configKey: Address;
    asset: Address;
    feed1: Address;
    feed2: Address;
    lowerThresholdInBase1: bigint;
    fixedPriceInBase1: bigint;
    lowerThresholdInBase2: bigint;
    fixedPriceInBase2: bigint;
  }>;
}

export interface OracleSetupPlan {
  api3: Api3SetupPlan;
  redstone: RedstoneSetupPlan;
}

export interface OracleRoutingEntry {
  asset: Address;
  bucket: "api3.plain" | "api3.threshold" | "api3.composite" | "redstone.plain" | "redstone.threshold" | "redstone.composite";
}

export interface OracleRoutingPlan {
  api3: OracleRoutingEntry[];
  redstone: OracleRoutingEntry[];
}

export interface ApplyResult {
  writes: number;
}

interface WrapperSanityCheckOptions {
  minPrice?: number;
  maxPrice?: number;
}

interface OracleWrapperLike {
  getAssetPrice(asset: Address): Promise<bigint>;
}

interface Api3WrapperLike extends OracleWrapperLike {
  assetToProxy(asset: Address): Promise<Address>;
  setProxy(asset: Address, proxy: Address): Promise<unknown>;
}

interface Api3WrapperWithThresholdingLike extends Api3WrapperLike {
  assetThresholds(asset: Address): Promise<ThresholdState>;
  setThresholdConfig(asset: Address, lowerThresholdInBase: bigint, fixedPriceInBase: bigint): Promise<unknown>;
}

interface Api3CompositeFeedState {
  proxy1: Address;
  proxy2: Address;
  primaryThreshold: ThresholdState;
  secondaryThreshold: ThresholdState;
}

interface Api3CompositeWrapperLike extends OracleWrapperLike {
  compositeFeeds(asset: Address): Promise<Api3CompositeFeedState>;
  addCompositeFeed(
    asset: Address,
    proxy1: Address,
    proxy2: Address,
    lowerThresholdInBase1: bigint,
    fixedPriceInBase1: bigint,
    lowerThresholdInBase2: bigint,
    fixedPriceInBase2: bigint,
  ): Promise<unknown>;
}

interface RedstoneWrapperLike extends OracleWrapperLike {
  assetToFeed(asset: Address): Promise<Address>;
  setFeed(asset: Address, feed: Address): Promise<unknown>;
}

interface RedstoneWrapperWithThresholdingLike extends RedstoneWrapperLike {
  assetThresholds(asset: Address): Promise<ThresholdState>;
  setThresholdConfig(asset: Address, lowerThresholdInBase: bigint, fixedPriceInBase: bigint): Promise<unknown>;
}

interface RedstoneCompositeFeedState {
  feed1: Address;
  feed2: Address;
  primaryThreshold: ThresholdState;
  secondaryThreshold: ThresholdState;
}

interface RedstoneCompositeWrapperLike extends OracleWrapperLike {
  compositeFeeds(asset: Address): Promise<RedstoneCompositeFeedState>;
  addCompositeFeed(
    asset: Address,
    feed1: Address,
    feed2: Address,
    lowerThresholdInBase1: bigint,
    fixedPriceInBase1: bigint,
    lowerThresholdInBase2: bigint,
    fixedPriceInBase2: bigint,
  ): Promise<unknown>;
}

interface OracleAggregatorLike {
  assetOracles(asset: Address): Promise<Address>;
  setOracle(asset: Address, oracle: Address): Promise<unknown>;
}

export interface Api3SetupContracts {
  plainWrapper: Api3WrapperLike;
  thresholdWrapper: Api3WrapperWithThresholdingLike;
  compositeWrapper: Api3CompositeWrapperLike;
}

export interface RedstoneSetupContracts {
  plainWrapper: RedstoneWrapperLike;
  thresholdWrapper: RedstoneWrapperWithThresholdingLike;
  compositeWrapper: RedstoneCompositeWrapperLike;
}

export interface Api3RoutingTargets {
  plainWrapper: Address;
  thresholdWrapper: Address;
  compositeWrapper: Address;
}

export interface RedstoneRoutingTargets {
  plainWrapper: Address;
  thresholdWrapper: Address;
  compositeWrapper: Address;
}

/**
 * Builds an idempotent wrapper-setup plan from USD oracle config.
 *
 * @param config USD oracle aggregator config.
 * @returns Normalized setup plan for API3 and Redstone wrappers.
 */
export function buildUsdOracleSetupPlan(config: OracleAggregatorConfig): OracleSetupPlan {
  validateUsdOracleConfig(config);

  const api3: Api3SetupPlan = {
    plain: Object.entries(config.api3OracleAssets?.plainApi3OracleWrappers ?? {}).map(([asset, proxy]) => ({
      asset,
      proxy,
    })),
    threshold: Object.entries(config.api3OracleAssets?.api3OracleWrappersWithThresholding ?? {}).map(([asset, feedConfig]) => ({
      asset,
      proxy: feedConfig.proxy,
      lowerThreshold: feedConfig.lowerThreshold,
      fixedPrice: feedConfig.fixedPrice,
    })),
    composite: Object.entries(config.api3OracleAssets?.compositeApi3OracleWrappersWithThresholding ?? {}).map(
      ([configKey, feedConfig]) => ({
        configKey,
        asset: feedConfig.feedAsset,
        proxy1: feedConfig.proxy1,
        proxy2: feedConfig.proxy2,
        lowerThresholdInBase1: feedConfig.lowerThresholdInBase1,
        fixedPriceInBase1: feedConfig.fixedPriceInBase1,
        lowerThresholdInBase2: feedConfig.lowerThresholdInBase2,
        fixedPriceInBase2: feedConfig.fixedPriceInBase2,
      }),
    ),
  };

  const redstone: RedstoneSetupPlan = {
    plain: Object.entries(config.redstoneOracleAssets?.plainRedstoneOracleWrappers ?? {}).map(([asset, feed]) => ({
      asset,
      feed,
    })),
    threshold: Object.entries(config.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding ?? {}).map(([asset, feedConfig]) => ({
      asset,
      feed: feedConfig.feed,
      lowerThreshold: feedConfig.lowerThreshold,
      fixedPrice: feedConfig.fixedPrice,
    })),
    composite: Object.entries(config.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding ?? {}).map(
      ([configKey, feedConfig]) => ({
        configKey,
        asset: feedConfig.feedAsset,
        feed1: feedConfig.feed1,
        feed2: feedConfig.feed2,
        lowerThresholdInBase1: feedConfig.lowerThresholdInBase1,
        fixedPriceInBase1: feedConfig.fixedPriceInBase1,
        lowerThresholdInBase2: feedConfig.lowerThresholdInBase2,
        fixedPriceInBase2: feedConfig.fixedPriceInBase2,
      }),
    ),
  };

  return { api3, redstone };
}

/**
 * Builds aggregator routing entries from the normalized wrapper-setup plan.
 *
 * @param config USD oracle aggregator config.
 * @returns Routing entries keyed by oracle provider.
 */
export function buildUsdOracleRoutingPlan(config: OracleAggregatorConfig): OracleRoutingPlan {
  const setupPlan = buildUsdOracleSetupPlan(config);

  return {
    api3: [
      ...setupPlan.api3.plain.map((entry) => ({ asset: entry.asset, bucket: "api3.plain" as const })),
      ...setupPlan.api3.threshold.map((entry) => ({ asset: entry.asset, bucket: "api3.threshold" as const })),
      ...setupPlan.api3.composite.map((entry) => ({ asset: entry.asset, bucket: "api3.composite" as const })),
    ],
    redstone: [
      ...setupPlan.redstone.plain.map((entry) => ({ asset: entry.asset, bucket: "redstone.plain" as const })),
      ...setupPlan.redstone.threshold.map((entry) => ({ asset: entry.asset, bucket: "redstone.threshold" as const })),
      ...setupPlan.redstone.composite.map((entry) => ({ asset: entry.asset, bucket: "redstone.composite" as const })),
    ],
  };
}

/**
 * Validates address integrity and ensures each asset is assigned to exactly one bucket.
 *
 * @param config USD oracle aggregator config.
 */
export function validateUsdOracleConfig(config: OracleAggregatorConfig): void {
  const placements = new Map<Address, string[]>();

  for (const [asset, proxy] of Object.entries(config.api3OracleAssets?.plainApi3OracleWrappers ?? {})) {
    assertAddress(asset, `api3.plain asset`);
    assertAddress(proxy, `api3.plain[${asset}] proxy`, { allowZero: false });
    registerPlacement(placements, asset, "api3.plain");
  }

  for (const [asset, feedConfig] of Object.entries(config.api3OracleAssets?.api3OracleWrappersWithThresholding ?? {})) {
    assertAddress(asset, `api3.threshold asset`);
    assertAddress(feedConfig.proxy, `api3.threshold[${asset}] proxy`, { allowZero: false });
    registerPlacement(placements, asset, "api3.threshold");
  }

  for (const [configKey, feedConfig] of Object.entries(config.api3OracleAssets?.compositeApi3OracleWrappersWithThresholding ?? {})) {
    assertAddress(configKey, `api3.composite config key`);
    assertAddress(feedConfig.feedAsset, `api3.composite[${configKey}] feedAsset`, { allowZero: false });
    assertAddress(feedConfig.proxy1, `api3.composite[${configKey}] proxy1`, { allowZero: false });
    assertAddress(feedConfig.proxy2, `api3.composite[${configKey}] proxy2`, { allowZero: false });
    registerPlacement(placements, feedConfig.feedAsset, "api3.composite");
  }

  for (const [asset, feed] of Object.entries(config.redstoneOracleAssets?.plainRedstoneOracleWrappers ?? {})) {
    assertAddress(asset, `redstone.plain asset`);
    assertAddress(feed, `redstone.plain[${asset}] feed`, { allowZero: false });
    registerPlacement(placements, asset, "redstone.plain");
  }

  for (const [asset, feedConfig] of Object.entries(config.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding ?? {})) {
    assertAddress(asset, `redstone.threshold asset`);
    assertAddress(feedConfig.feed, `redstone.threshold[${asset}] feed`, { allowZero: false });
    registerPlacement(placements, asset, "redstone.threshold");
  }

  for (const [configKey, feedConfig] of Object.entries(
    config.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding ?? {},
  )) {
    assertAddress(configKey, `redstone.composite config key`);
    assertAddress(feedConfig.feedAsset, `redstone.composite[${configKey}] feedAsset`, { allowZero: false });
    assertAddress(feedConfig.feed1, `redstone.composite[${configKey}] feed1`, { allowZero: false });
    assertAddress(feedConfig.feed2, `redstone.composite[${configKey}] feed2`, { allowZero: false });
    registerPlacement(placements, feedConfig.feedAsset, "redstone.composite");
  }
}

/**
 * Applies API3 wrapper state changes and skips writes when the target state already matches.
 *
 * @param plan Desired API3 wrapper state.
 * @param contracts Deployed API3 wrapper contracts.
 * @param baseCurrencyUnit Base currency unit used for sanity-check normalization.
 * @param sanityOptions Optional sanity-check bounds override.
 * @returns Number of contract writes performed.
 */
export async function applyApi3SetupPlan(
  plan: Api3SetupPlan,
  contracts: Api3SetupContracts,
  baseCurrencyUnit: bigint,
  sanityOptions: WrapperSanityCheckOptions = {},
): Promise<ApplyResult> {
  let writes = 0;

  for (const entry of plan.plain) {
    const currentProxy = await contracts.plainWrapper.assetToProxy(entry.asset);

    if (sameAddress(currentProxy, entry.proxy)) {
      continue;
    }

    await waitForTransaction(contracts.plainWrapper.setProxy(entry.asset, entry.proxy));
    writes += 1;
  }

  await performOracleSanityChecks(
    contracts.plainWrapper,
    plan.plain.map((entry) => entry.asset),
    baseCurrencyUnit,
    "plain API3 wrapper",
    sanityOptions,
  );

  for (const entry of plan.threshold) {
    const currentProxy = await contracts.thresholdWrapper.assetToProxy(entry.asset);
    const currentThreshold = await contracts.thresholdWrapper.assetThresholds(entry.asset);

    if (sameAddress(currentProxy, entry.proxy) && sameThreshold(currentThreshold, entry.lowerThreshold, entry.fixedPrice)) {
      continue;
    }

    if (!sameAddress(currentProxy, entry.proxy)) {
      await waitForTransaction(contracts.thresholdWrapper.setProxy(entry.asset, entry.proxy));
      writes += 1;
    }

    if (!sameThreshold(currentThreshold, entry.lowerThreshold, entry.fixedPrice)) {
      await waitForTransaction(contracts.thresholdWrapper.setThresholdConfig(entry.asset, entry.lowerThreshold, entry.fixedPrice));
      writes += 1;
    }
  }

  await performOracleSanityChecks(
    contracts.thresholdWrapper,
    plan.threshold.map((entry) => entry.asset),
    baseCurrencyUnit,
    "API3 wrapper with thresholding",
    sanityOptions,
  );

  for (const entry of plan.composite) {
    const currentFeed = await contracts.compositeWrapper.compositeFeeds(entry.asset);

    if (
      sameAddress(currentFeed.proxy1, entry.proxy1) &&
      sameAddress(currentFeed.proxy2, entry.proxy2) &&
      sameThreshold(currentFeed.primaryThreshold, entry.lowerThresholdInBase1, entry.fixedPriceInBase1) &&
      sameThreshold(currentFeed.secondaryThreshold, entry.lowerThresholdInBase2, entry.fixedPriceInBase2)
    ) {
      continue;
    }

    await waitForTransaction(
      contracts.compositeWrapper.addCompositeFeed(
        entry.asset,
        entry.proxy1,
        entry.proxy2,
        entry.lowerThresholdInBase1,
        entry.fixedPriceInBase1,
        entry.lowerThresholdInBase2,
        entry.fixedPriceInBase2,
      ),
    );
    writes += 1;
  }

  await performOracleSanityChecks(
    contracts.compositeWrapper,
    plan.composite.map((entry) => entry.asset),
    baseCurrencyUnit,
    "composite API3 wrapper",
    sanityOptions,
  );

  return { writes };
}

/**
 * Applies Redstone wrapper state changes and skips writes when the target state already matches.
 *
 * @param plan Desired Redstone wrapper state.
 * @param contracts Deployed Redstone wrapper contracts.
 * @param baseCurrencyUnit Base currency unit used for sanity-check normalization.
 * @param sanityOptions Optional sanity-check bounds override.
 * @returns Number of contract writes performed.
 */
export async function applyRedstoneSetupPlan(
  plan: RedstoneSetupPlan,
  contracts: RedstoneSetupContracts,
  baseCurrencyUnit: bigint,
  sanityOptions: WrapperSanityCheckOptions = {},
): Promise<ApplyResult> {
  let writes = 0;

  for (const entry of plan.plain) {
    const currentFeed = await contracts.plainWrapper.assetToFeed(entry.asset);

    if (sameAddress(currentFeed, entry.feed)) {
      continue;
    }

    await waitForTransaction(contracts.plainWrapper.setFeed(entry.asset, entry.feed));
    writes += 1;
  }

  await performOracleSanityChecks(
    contracts.plainWrapper,
    plan.plain.map((entry) => entry.asset),
    baseCurrencyUnit,
    "plain Redstone wrapper",
    sanityOptions,
  );

  for (const entry of plan.threshold) {
    const currentFeed = await contracts.thresholdWrapper.assetToFeed(entry.asset);
    const currentThreshold = await contracts.thresholdWrapper.assetThresholds(entry.asset);

    if (sameAddress(currentFeed, entry.feed) && sameThreshold(currentThreshold, entry.lowerThreshold, entry.fixedPrice)) {
      continue;
    }

    if (!sameAddress(currentFeed, entry.feed)) {
      await waitForTransaction(contracts.thresholdWrapper.setFeed(entry.asset, entry.feed));
      writes += 1;
    }

    if (!sameThreshold(currentThreshold, entry.lowerThreshold, entry.fixedPrice)) {
      await waitForTransaction(contracts.thresholdWrapper.setThresholdConfig(entry.asset, entry.lowerThreshold, entry.fixedPrice));
      writes += 1;
    }
  }

  await performOracleSanityChecks(
    contracts.thresholdWrapper,
    plan.threshold.map((entry) => entry.asset),
    baseCurrencyUnit,
    "Redstone wrapper with thresholding",
    sanityOptions,
  );

  for (const entry of plan.composite) {
    const currentFeed = await contracts.compositeWrapper.compositeFeeds(entry.asset);

    if (
      sameAddress(currentFeed.feed1, entry.feed1) &&
      sameAddress(currentFeed.feed2, entry.feed2) &&
      sameThreshold(currentFeed.primaryThreshold, entry.lowerThresholdInBase1, entry.fixedPriceInBase1) &&
      sameThreshold(currentFeed.secondaryThreshold, entry.lowerThresholdInBase2, entry.fixedPriceInBase2)
    ) {
      continue;
    }

    await waitForTransaction(
      contracts.compositeWrapper.addCompositeFeed(
        entry.asset,
        entry.feed1,
        entry.feed2,
        entry.lowerThresholdInBase1,
        entry.fixedPriceInBase1,
        entry.lowerThresholdInBase2,
        entry.fixedPriceInBase2,
      ),
    );
    writes += 1;
  }

  await performOracleSanityChecks(
    contracts.compositeWrapper,
    plan.composite.map((entry) => entry.asset),
    baseCurrencyUnit,
    "composite Redstone wrapper",
    sanityOptions,
  );

  return { writes };
}

/**
 * Routes API3-backed assets to the expected wrapper contracts without duplicating writes.
 *
 * @param plan Routing entries for API3-backed assets.
 * @param oracleAggregator Oracle aggregator receiving the routes.
 * @param targets Deployed API3 wrapper addresses.
 * @returns Number of aggregator writes performed.
 */
export async function applyApi3RoutingPlan(
  plan: OracleRoutingEntry[],
  oracleAggregator: OracleAggregatorLike,
  targets: Api3RoutingTargets,
): Promise<ApplyResult> {
  let writes = 0;

  for (const entry of plan) {
    const expectedOracle =
      entry.bucket === "api3.plain"
        ? targets.plainWrapper
        : entry.bucket === "api3.threshold"
          ? targets.thresholdWrapper
          : targets.compositeWrapper;

    const currentOracle = await oracleAggregator.assetOracles(entry.asset);

    if (sameAddress(currentOracle, expectedOracle)) {
      continue;
    }

    await waitForTransaction(oracleAggregator.setOracle(entry.asset, expectedOracle));
    writes += 1;
  }

  return { writes };
}

/**
 * Routes Redstone-backed assets to the expected wrapper contracts without duplicating writes.
 *
 * @param plan Routing entries for Redstone-backed assets.
 * @param oracleAggregator Oracle aggregator receiving the routes.
 * @param targets Deployed Redstone wrapper addresses.
 * @returns Number of aggregator writes performed.
 */
export async function applyRedstoneRoutingPlan(
  plan: OracleRoutingEntry[],
  oracleAggregator: OracleAggregatorLike,
  targets: RedstoneRoutingTargets,
): Promise<ApplyResult> {
  let writes = 0;

  for (const entry of plan) {
    const expectedOracle =
      entry.bucket === "redstone.plain"
        ? targets.plainWrapper
        : entry.bucket === "redstone.threshold"
          ? targets.thresholdWrapper
          : targets.compositeWrapper;

    const currentOracle = await oracleAggregator.assetOracles(entry.asset);

    if (sameAddress(currentOracle, expectedOracle)) {
      continue;
    }

    await waitForTransaction(oracleAggregator.setOracle(entry.asset, expectedOracle));
    writes += 1;
  }

  return { writes };
}

/**
 * Verifies wrapper prices stay inside a broad expected range after configuration writes.
 *
 * @param wrapper Wrapper contract used for price lookups.
 * @param assets Assets to validate.
 * @param baseCurrencyUnit Base currency unit used for normalization.
 * @param wrapperName Human-readable wrapper label used in thrown errors.
 * @param options Optional sanity-check bounds override.
 */
async function performOracleSanityChecks(
  wrapper: OracleWrapperLike,
  assets: Address[],
  baseCurrencyUnit: bigint,
  wrapperName: string,
  options: WrapperSanityCheckOptions,
): Promise<void> {
  const minPrice = options.minPrice ?? DEFAULT_MIN_PRICE;
  const maxPrice = options.maxPrice ?? DEFAULT_MAX_PRICE;

  for (const asset of assets) {
    try {
      const price = await wrapper.getAssetPrice(asset);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < minPrice || normalizedPrice > maxPrice) {
        throw new Error(
          `Sanity check failed for asset ${asset} in ${wrapperName}: normalized price ${normalizedPrice} is outside the range [${minPrice}, ${maxPrice}]`,
        );
      }
    } catch (error) {
      throw new Error(`Error performing sanity check for asset ${asset} in ${wrapperName}: ${error}`);
    }
  }
}

/**
 * Ensures config values are valid addresses and optionally rejects the zero address.
 *
 * @param value Address-like value to validate.
 * @param label Human-readable field label used in thrown errors.
 * @param options Validation options.
 * @param options.allowZero Allows the zero address when true.
 */
function assertAddress(value: string, label: string, options: { allowZero?: boolean } = {}): void {
  if (!isAddress(value)) {
    throw new Error(`Invalid address for ${label}: '${value}'`);
  }

  if (!options.allowZero && sameAddress(value, ZeroAddress)) {
    throw new Error(`Zero address is not allowed for ${label}`);
  }
}

/**
 * Tracks which logical oracle bucket owns each asset and rejects duplicates.
 *
 * @param placements Existing asset-to-bucket placements.
 * @param asset Asset being registered.
 * @param bucket Bucket that now owns the asset.
 */
function registerPlacement(placements: Map<Address, string[]>, asset: Address, bucket: string): void {
  const existingBuckets = placements.get(asset) ?? [];

  if (existingBuckets.length > 0) {
    throw new Error(`Asset ${asset} is configured in multiple oracle buckets: ${existingBuckets.join(", ")}, ${bucket}`);
  }

  placements.set(asset, [bucket]);
}

/**
 * Compares threshold structs using the same field names exposed by the wrappers.
 *
 * @param current Current threshold state from the wrapper.
 * @param expectedLowerThreshold Expected lower-threshold value.
 * @param expectedFixedPrice Expected fixed-price fallback.
 * @returns True when both threshold fields already match.
 */
function sameThreshold(current: ThresholdState, expectedLowerThreshold: bigint, expectedFixedPrice: bigint): boolean {
  return current.lowerThresholdInBase === expectedLowerThreshold && current.fixedPriceInBase === expectedFixedPrice;
}

/**
 * Performs a case-insensitive address comparison.
 *
 * @param left First address.
 * @param right Second address.
 * @returns True when both addresses match ignoring case.
 */
function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Waits on contract writes when the underlying call returns a transaction response.
 *
 * @param txPromise Promise returned by a contract write.
 */
async function waitForTransaction(txPromise: Promise<unknown>): Promise<void> {
  const tx = (await txPromise) as { wait?: () => Promise<unknown> };

  if (typeof tx === "object" && tx !== null && "wait" in tx && typeof tx.wait === "function") {
    await tx.wait();
  }
}
