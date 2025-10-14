import hre, { ethers } from "hardhat";
import path from "path";

/**
 * Utility script: prints latest prices for all on-chain oracle deployments on a given Hardhat network.
 *
 * Usage examples:
 *   yarn hardhat run --network sonic_mainnet scripts/oracle/show_oracle_prices.ts
 *   yarn hardhat run --network sonic_testnet scripts/oracle/show_oracle_prices.ts
 *
 * The script walks the hardhat-deploy deployments directory for the selected network, tries to
 * attach the minimal Chainlink AggregatorV3 interface and prints {name, description, price, updatedAt}.
 * Non-aggregator contracts are silently skipped.
 */

/** Helper: dynamically import the network config and build Config object */
async function loadNetworkConfig() {
  const networkName = hre.network.name;

  try {
    // Example path: ../../config/networks/sonic_mainnet.ts (relative to this script file)
    const configPath = path.resolve(__dirname, "../../config/networks", `${networkName}.ts`);

    const configModule = await import(configPath);

    if (typeof configModule.getConfig !== "function") {
      console.warn(`Config module for ${networkName} does not export getConfig – skipping aggregator section`);
      return undefined;
    }
    const config = await configModule.getConfig(hre);
    return config;
  } catch (err) {
    console.warn(`⚠️  Could not load network config for ${networkName}: ${(err as Error).message}`);
    return undefined;
  }
}

function buildTokenSymbolMap(config: any): Map<string, string> {
  const map = new Map<string, string>();
  const tokens = (config?.tokenAddresses ?? {}) as Record<string, string>;
  for (const [symbol, addr] of Object.entries(tokens)) {
    if (addr && typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
      map.set(addr.toLowerCase(), symbol);
    }
  }
  return map;
}

// ------------------------------
// CLI args
// ------------------------------

type CrawlerOptions = {
  aggregators?: string[];
  json?: boolean;
  multicall?: string;
};

function parseArgs(argv: string[]): CrawlerOptions {
  const opts: CrawlerOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--aggregators" && i + 1 < argv.length) {
      opts.aggregators = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--json") {
      opts.json = true;
    } else if (a === "--multicall" && i + 1 < argv.length) {
      opts.multicall = argv[++i];
    }
  }
  return opts;
}

// ------------------------------
// Multicall and discovery helpers
// ------------------------------

type DeploymentLike = {
  address: string;
  abi: any[];
  name?: string;
};

type ClassifiedDeployments = {
  aggregators: DeploymentLike[];
  wrappers: DeploymentLike[];
  others: DeploymentLike[];
};

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
];

const WRAPPER_MIN_ABI = [
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
  "function BASE_CURRENCY() view returns (address)",
  "function getAssetPrice(address) view returns (uint256)",
  "function getPriceInfo(address) view returns (uint256,bool)",
];

const AGGREGATOR_MIN_ABI = [
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
  "function getAssetPrice(address) view returns (uint256)",
  "function assetOracles(address) view returns (address)",
];

function hasFn(abi: any[], name: string): boolean {
  return Array.isArray(abi) && abi.some((it: any) => it?.type === "function" && it.name === name);
}

function classifyDeployments(deployments: Record<string, any>): ClassifiedDeployments {
  const aggregators: DeploymentLike[] = [];
  const wrappers: DeploymentLike[] = [];
  const others: DeploymentLike[] = [];

  for (const [name, dep] of Object.entries(deployments)) {
    const abi = (dep as any).abi ?? [];
    const item: DeploymentLike = { address: (dep as any).address, abi, name };

    const isAggregator = hasFn(abi, "setOracle") || hasFn(abi, "assetOracles");
    const isWrapper = hasFn(abi, "getPriceInfo") && !isAggregator;

    if (isAggregator) aggregators.push(item);
    else if (isWrapper) wrappers.push(item);
    else others.push(item);
  }

  return { aggregators, wrappers, others };
}

function getMulticallAddress(overrideAddr?: string): string {
  const fromEnv = overrideAddr ?? process.env.MULTICALL3?.trim();
  if (fromEnv && fromEnv !== "") return fromEnv;
  // Canonical Multicall3 address on most EVM chains
  return "0xcA11bde05977b3631167028862bE2a173976CA11";
}

type Aggregate3Call = { target: string; allowFailure: boolean; callData: string };

async function multicallAggregate3(
  provider: any,
  multicall3: string,
  calls: Aggregate3Call[],
): Promise<Array<{ success: boolean; returnData: string }>> {
  const multicallInterface = new ethers.Interface(MULTICALL3_ABI);
  const data = multicallInterface.encodeFunctionData("aggregate3", [calls]);
  const tx = { to: multicall3, data };
  const raw = await provider.call(tx);
  const decoded = multicallInterface.decodeFunctionResult("aggregate3", raw) as any[];
  const arr = (decoded?.[0] as any[]) || [];
  return arr.map((r: any) => ({ success: !!r?.success, returnData: (r?.returnData ?? "0x") as string }));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function inferDecimalsFromUnit(unit: bigint | number): number {
  try {
    let u = BigInt(unit);
    let d = 0;
    while (u > 1n && u % 10n === 0n) {
      u /= 10n;
      d += 1;
    }
    return d > 0 ? d : 18; // fallback
  } catch {
    return 18;
  }
}

function isAddressLike(s: string | undefined): s is string {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

function collectAssetsFromConfigForKey(config: any, aggKey: string): string[] {
  const assets = new Set<string>();
  const aggCfg = (config?.oracleAggregators ?? {})[aggKey] ?? {};

  const addKeys = (obj?: Record<string, any>) => {
    if (!obj) return;
    for (const k of Object.keys(obj)) if (isAddressLike(k)) assets.add(k.toLowerCase());
  };

  // API3 buckets
  addKeys(aggCfg.api3OracleAssets?.plainApi3OracleWrappers);
  addKeys(aggCfg.api3OracleAssets?.api3OracleWrappersWithThresholding);
  addKeys(aggCfg.api3OracleAssets?.compositeApi3OracleWrappersWithThresholding);

  // Redstone buckets
  addKeys(aggCfg.redstoneOracleAssets?.plainRedstoneOracleWrappers);
  addKeys(aggCfg.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding);
  addKeys(aggCfg.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding);

  // Chainlink composite aggregator
  addKeys(aggCfg.chainlinkCompositeAggregator);

  // Safe rate provider wrappers
  addKeys(aggCfg.safeRateProviderAssets?.chainlinkSafeRateProviderCompositeWrappers);
  addKeys(aggCfg.safeRateProviderAssets?.erc4626SafeRateProviderWrappers);

  // Also include known token addresses
  for (const addr of Object.values((config?.tokenAddresses ?? {}) as Record<string, string>)) {
    if (isAddressLike(addr)) assets.add(addr.toLowerCase());
  }

  return Array.from(assets);
}

/**
 * Retrieve aggregator deployment by conventional name (e.g., USD_OracleAggregator)
 *
 * @param key
 */
async function getAggregatorContract(key: string) {
  const deploymentName = `${key}_OracleAggregator`;

  try {
    const dep = await hre.deployments.get(deploymentName);
    const AGGREGATOR_ABI = ["function getAssetPrice(address) view returns (uint256)"];
    return await ethers.getContractAt(AGGREGATOR_ABI, dep.address);
  } catch {
    return undefined;
  }
}

/** Utility: pretty print aggregator prices */
async function dumpAggregatorPrices(): Promise<void> {
  const config = await loadNetworkConfig();
  const symbolMap = buildTokenSymbolMap(config);
  if (!config) return;

  const aggregatorEntries = Object.entries((config.oracleAggregators ?? {}) as Record<string, any>);
  if (aggregatorEntries.length === 0) return;

  console.log("\n📊 Aggregator Prices");
  console.log("============================================================\n");

  for (const [aggKey, aggConfig] of aggregatorEntries) {
    const contract = await getAggregatorContract(aggKey);

    if (!contract) {
      console.log(`❌ No deployment found for ${aggKey}_OracleAggregator`);
      continue;
    }

    // Collect asset addresses from the various config buckets
    const assetSet = new Set<string>();

    const addKeys = (obj?: Record<string, any>) => {
      if (!obj) return;

      for (const k of Object.keys(obj)) {
        const keyStr = k as string;
        if (keyStr && keyStr !== "") assetSet.add(keyStr.toLowerCase());
      }
    };

    // API3
    addKeys(aggConfig.api3OracleAssets?.plainApi3OracleWrappers);
    addKeys(aggConfig.api3OracleAssets?.api3OracleWrappersWithThresholding);
    addKeys(aggConfig.api3OracleAssets?.compositeApi3OracleWrappersWithThresholding);

    // Redstone
    addKeys(aggConfig.redstoneOracleAssets?.plainRedstoneOracleWrappers);
    addKeys(aggConfig.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding);
    addKeys(aggConfig.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding);

    // Chainlink composite wrappers (simple map asset->config)
    addKeys(aggConfig.chainlinkCompositeWrapperAggregator);

    const tokenAddressMap: Record<string, string> = Object.entries((config.tokenAddresses ?? {}) as Record<string, any>).reduce(
      (acc, [symbol, addr]) => {
        if (addr) acc[(addr as string).toLowerCase()] = symbol;
        return acc;
      },
      {} as Record<string, string>,
    );

    const decimals = aggConfig.priceDecimals ?? 18;

    console.log(`▶ Aggregator: ${aggKey}`);

    for (const assetAddrLower of assetSet) {
      try {
        const rawPrice = await contract.getAssetPrice(assetAddrLower);
        const priceHuman = ethers.formatUnits(rawPrice, decimals);
        const symbol = tokenAddressMap[assetAddrLower] || assetAddrLower;
        console.log(`  ${symbol.padEnd(15)} : ${priceHuman}`);
      } catch (err) {
        console.warn(`  ⚠️  Could not fetch price for ${assetAddrLower}: ${(err as Error).message}`);
      }
    }
    console.log("------------------------------------------------------------");
  }
}

// ------------------------------
// Generalized crawler using deployments + multicall
// ------------------------------

async function runGeneralizedCrawler(options: CrawlerOptions = {}): Promise<void> {
  const provider = hre.ethers.provider;
  const networkName = hre.network.name;
  const multicall3 = getMulticallAddress(options.multicall);
  const config = await loadNetworkConfig();
  const symbolMap = buildTokenSymbolMap(config);

  // 1) Classify all deployments by ABI
  const deployments = await hre.deployments.all();
  const classified = classifyDeployments(deployments);

  // 2) Preflight: fetch BASE_CURRENCY_UNIT for all aggregators + wrappers via multicall
  const baseUnitIface = new ethers.Interface(["function BASE_CURRENCY_UNIT() view returns (uint256)"]);
  const preflightCalls: Aggregate3Call[] = [];
  const allTargets: string[] = [...classified.aggregators.map((d) => d.address), ...classified.wrappers.map((d) => d.address)];
  const uniqueTargets = Array.from(new Set(allTargets.map((a) => a.toLowerCase())));
  for (const target of uniqueTargets) {
    preflightCalls.push({
      target,
      allowFailure: true,
      callData: baseUnitIface.encodeFunctionData("BASE_CURRENCY_UNIT"),
    });
  }

  const baseUnitByAddr = new Map<string, bigint>();
  if (uniqueTargets.length > 0) {
    for (const callsChunk of chunk(preflightCalls, 300)) {
      const results = await multicallAggregate3(provider, multicall3, callsChunk);
      for (let i = 0; i < callsChunk.length; i++) {
        const target = callsChunk[i].target.toLowerCase();
        const res = results[i];
        if (res?.success && res.returnData && res.returnData !== "0x") {
          try {
            const decoded = baseUnitIface.decodeFunctionResult("BASE_CURRENCY_UNIT", res.returnData);
            const unit = decoded[0] as unknown as bigint;
            baseUnitByAddr.set(target, unit);
          } catch {}
        }
      }
    }
  }

  // 3) For each aggregator key from config, select deployment and matching wrappers
  let aggEntries = Object.entries((config?.oracleAggregators ?? {}) as Record<string, any>);
  if (options.aggregators && options.aggregators.length > 0) {
    const allow = new Set(options.aggregators.map((k) => k.toLowerCase()));
    aggEntries = aggEntries.filter(([k]) => allow.has(k.toLowerCase()));
  }
  if (aggEntries.length === 0) return;

  const aggregatorIface = new ethers.Interface(AGGREGATOR_MIN_ABI);
  const wrapperIface = new ethers.Interface(WRAPPER_MIN_ABI);

  const globalSummary: any[] = [];

  for (const [aggKey, aggCfg] of aggEntries) {
    // Prefer deployment name like `${aggKey}_OracleAggregator` else pick the first aggregator
    let aggregatorDep = classified.aggregators.find((d) => (d.name ?? "").toLowerCase() === `${aggKey.toLowerCase()}_oracleaggregator`);
    if (!aggregatorDep) aggregatorDep = classified.aggregators[0];
    if (!aggregatorDep) continue;

    const aggAddr = aggregatorDep.address;
    const aggUnit = baseUnitByAddr.get(aggAddr.toLowerCase()) ?? 10n ** BigInt(aggCfg?.priceDecimals ?? 18);
    const aggDecimals = inferDecimalsFromUnit(aggUnit);

    // Candidate assets for this aggregator
    const assetList = collectAssetsFromConfigForKey(config, aggKey);
    if (assetList.length === 0) continue;

    console.log(`\n🧭 Aggregator: ${aggKey} (${networkName})`);
    console.log(`Address: ${aggAddr}`);
    console.log(`Assets discovered: ${assetList.length}`);
    console.log("============================================================\n");

    // Phase A: aggregator prices and pointers
    const callsA: Aggregate3Call[] = [];
    const metaA: { kind: "agg_price" | "agg_ptr"; asset: string }[] = [];
    for (const asset of assetList) {
      callsA.push({
        target: aggAddr,
        allowFailure: true,
        callData: aggregatorIface.encodeFunctionData("getAssetPrice", [asset]),
      });
      metaA.push({ kind: "agg_price", asset });
      callsA.push({
        target: aggAddr,
        allowFailure: true,
        callData: aggregatorIface.encodeFunctionData("assetOracles", [asset]),
      });
      metaA.push({ kind: "agg_ptr", asset });
    }
    const resA: Array<{ success: boolean; returnData: string } | undefined> = [];
    for (const chunkA of chunk(callsA, 300)) {
      const part = await multicallAggregate3(provider, multicall3, chunkA);
      resA.push(...part);
    }
    const aggPriceByAsset = new Map<string, bigint>();
    const aggPtrByAsset = new Map<string, string>();
    for (let i = 0; i < resA.length; i++) {
      const ra = resA[i];
      const ma = metaA[i];
      if (!ra?.success || !ra.returnData || ra.returnData === "0x") continue;
      try {
        if (ma.kind === "agg_price") {
          const decoded = aggregatorIface.decodeFunctionResult("getAssetPrice", ra.returnData);
          const p = decoded[0] as unknown as bigint;
          aggPriceByAsset.set(ma.asset.toLowerCase(), p);
        } else {
          const decoded = aggregatorIface.decodeFunctionResult("assetOracles", ra.returnData);
          const ptr = String(decoded[0]);
          aggPtrByAsset.set(ma.asset.toLowerCase(), ptr.toLowerCase());
        }
      } catch {}
    }

    // Choose wrappers: prefix match OR used by aggregator pointers
    const prefix = `${aggKey}_`.toLowerCase();
    const byPrefix = classified.wrappers.filter(
      (w) => (baseUnitByAddr.get(w.address.toLowerCase()) ?? -1n) === aggUnit && (w.name ?? "").toLowerCase().startsWith(prefix),
    );
    const ptrSet = new Set<string>(Array.from(aggPtrByAsset.values()));
    const byPtr = classified.wrappers.filter((w) => ptrSet.has(w.address.toLowerCase()));
    const wrappersForAgg = Array.from(new Map([...byPrefix, ...byPtr].map((w) => [w.address.toLowerCase(), w])).values());

    console.log(`Wrappers considered: ${wrappersForAgg.length}`);
    console.log("------------------------------------------------------------\n");

    // Phase B: wrapper prices
    const callsB: Aggregate3Call[] = [];
    const metaB: { kind: "wrap_info" | "wrap_price"; addr: string; asset: string }[] = [];
    for (const w of wrappersForAgg) {
      for (const asset of assetList) {
        callsB.push({
          target: w.address,
          allowFailure: true,
          callData: wrapperIface.encodeFunctionData("getPriceInfo", [asset]),
        });
        metaB.push({ kind: "wrap_info", addr: w.address, asset });
        callsB.push({
          target: w.address,
          allowFailure: true,
          callData: wrapperIface.encodeFunctionData("getAssetPrice", [asset]),
        });
        metaB.push({ kind: "wrap_price", addr: w.address, asset });
      }
    }
    const resB: Array<{ success: boolean; returnData: string } | undefined> = [];
    for (const chunkB of chunk(callsB, 300)) {
      const part = await multicallAggregate3(provider, multicall3, chunkB);
      resB.push(...part);
    }
    const wrapPriceByAssetAddr = new Map<string, bigint>();
    const wrapAliveByAssetAddr = new Map<string, boolean>();
    for (let i = 0; i < resB.length; i++) {
      const rb = resB[i];
      const mb = metaB[i];
      if (!rb?.success || !rb.returnData || rb.returnData === "0x") continue;
      try {
        if (mb.kind === "wrap_info") {
          const decoded = wrapperIface.decodeFunctionResult("getPriceInfo", rb.returnData);
          const p = decoded[0] as unknown as bigint;
          const alive = decoded[1] as unknown as boolean;
          wrapPriceByAssetAddr.set(`${mb.addr.toLowerCase()}_${mb.asset.toLowerCase()}`, p);
          wrapAliveByAssetAddr.set(`${mb.addr.toLowerCase()}_${mb.asset.toLowerCase()}`, alive);
        } else {
          const decoded = wrapperIface.decodeFunctionResult("getAssetPrice", rb.returnData);
          const p = decoded[0] as unknown as bigint;
          const key = `${mb.addr.toLowerCase()}_${mb.asset.toLowerCase()}`;
          if (!wrapPriceByAssetAddr.has(key)) wrapPriceByAssetAddr.set(key, p);
          if (!wrapAliveByAssetAddr.has(key)) wrapAliveByAssetAddr.set(key, true);
        }
      } catch {}
    }

    // Render wrapper-centric tables
    for (const w of wrappersForAgg) {
      console.log(`Wrapper: ${w.name ?? w.address} @ ${w.address}`);
      console.log("Symbol".padEnd(15), "Price".padStart(18));
      console.log("-".repeat(40));
      for (const asset of assetList) {
        const aLower = asset.toLowerCase();
        const key = `${w.address.toLowerCase()}_${aLower}`;
        const wPrice = wrapPriceByAssetAddr.get(key);
        if (wPrice === undefined) continue;
        const aggPrice = aggPriceByAsset.get(aLower);
        const alive = wrapAliveByAssetAddr.get(key) ?? false;
        const symbol = symbolMap.get(aLower) ?? `${asset.slice(0, 10)}...`;
        const wHuman = ethers.formatUnits(wPrice, aggDecimals);
        if (aggPrice !== undefined && aggPrice > 0n && wPrice > 0n) {
          const larger = wPrice > aggPrice ? wPrice : aggPrice;
          const smaller = wPrice > aggPrice ? aggPrice : wPrice;
          if (smaller > 0n) {
            const ratio = larger / smaller;
            if (ratio >= 10_000_000n) {
              const aggHuman = ethers.formatUnits(aggPrice, aggDecimals);
              const pointer = aggPtrByAsset.get(aLower);
              const mismatchMsg = [
                `Wrapper ${w.name ?? w.address} price for ${symbol} looks mis-scaled (>7 decimals off)`,
                `wrapperRaw=${wPrice.toString()}`,
                `aggregatorRaw=${aggPrice.toString()}`,
                `formattedWrapper=${wHuman}`,
                `formattedAggregator=${aggHuman}`,
                `baseUnit=${aggUnit.toString()}`,
                pointer ? `aggregatorPointer=${pointer}` : undefined,
                `ratio=${ratio.toString()}`,
              ]
                .filter(Boolean)
                .join("; ");
              console.warn(`⚠️  ${mismatchMsg}`);
              throw new Error(mismatchMsg);
            }
          }
        }
        if (!alive) {
          console.warn(`⚠️  ${symbol} price reported as not alive by ${w.name ?? w.address}`);
        }
        console.log(symbol.padEnd(15), wHuman.padStart(18));
      }
      console.log("");
    }

    // Optionally build JSON summary per aggregator (minimal)
    globalSummary.push({
      key: aggKey,
      address: aggAddr,
      wrappers: wrappersForAgg.map((x) => ({ name: x.name ?? null, address: x.address })),
    });
  }

  if (options.json) {
    console.log(JSON.stringify({ network: networkName, summary: globalSummary }, null, 2));
  }
}

/**
 *
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // 1. Load all deployments for the current network via hardhat-deploy
  const deployments = await hre.deployments.all();
  const networkName = hre.network.name;
  const multicall3 = getMulticallAddress(args.multicall);

  console.log(`\n🔍 Custom Oracle Prices for ${networkName}`);
  console.log("============================================================\n");

  // Minimal ABI for Chainlink-style aggregator or our wrappers (they follow the same interface)
  const ORACLE_MIN_IFACE = new ethers.Interface([
    "function decimals() view returns (uint8)",
    "function description() view returns (string)",
    "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  ]);

  const entries = Object.entries(deployments);

  // Helper to decide whether a deployment looks like an oracle (naive pattern match)
  const looksLikeOracle = (name: string): boolean => /Oracle|Wrapper|Converter|HardPegOracle|Aggregator/i.test(name);

  const targets: { name: string; address: string }[] = [];
  for (const [name, deployment] of entries) {
    if (!looksLikeOracle(name)) continue;
    const { address } = deployment;
    if (!address || address === ethers.ZeroAddress) continue;
    targets.push({ name, address });
  }

  const customCalls: Aggregate3Call[] = [];
  const customMeta: { name: string; address: string; kind: "decimals" | "description" | "round" }[] = [];
  for (const t of targets) {
    customCalls.push({
      target: t.address,
      allowFailure: true,
      callData: ORACLE_MIN_IFACE.encodeFunctionData("decimals"),
    });
    customMeta.push({ name: t.name, address: t.address, kind: "decimals" });
    customCalls.push({
      target: t.address,
      allowFailure: true,
      callData: ORACLE_MIN_IFACE.encodeFunctionData("description"),
    });
    customMeta.push({ name: t.name, address: t.address, kind: "description" });
    customCalls.push({
      target: t.address,
      allowFailure: true,
      callData: ORACLE_MIN_IFACE.encodeFunctionData("latestRoundData"),
    });
    customMeta.push({ name: t.name, address: t.address, kind: "round" });
  }

  const customResults: Array<{ success: boolean; returnData: string } | undefined> = [];
  for (const callsChunk of chunk(customCalls, 300)) {
    const part = await multicallAggregate3(hre.ethers.provider, multicall3, callsChunk);
    customResults.push(...part);
  }

  const byAddr: Record<string, { name: string; decimals?: number; description?: string; price?: string; updatedAt?: string }> = {};
  for (let i = 0; i < customResults.length; i++) {
    const meta = customMeta[i];
    const res = customResults[i];
    if (!meta || !res?.success || !res.returnData || res.returnData === "0x") continue;
    const rec = (byAddr[meta.address] = byAddr[meta.address] || { name: meta.name });
    try {
      if (meta.kind === "decimals") {
        const decoded = ORACLE_MIN_IFACE.decodeFunctionResult("decimals", res.returnData);
        rec.decimals = Number(decoded[0]);
      } else if (meta.kind === "description") {
        const decoded = ORACLE_MIN_IFACE.decodeFunctionResult("description", res.returnData);
        rec.description = String(decoded[0]);
      } else if (meta.kind === "round") {
        const decoded = ORACLE_MIN_IFACE.decodeFunctionResult("latestRoundData", res.returnData);
        const answer = decoded[1] as unknown as bigint;
        const updatedAt = decoded[3] as unknown as bigint;
        const decimals = rec.decimals ?? 18;
        rec.price = ethers.formatUnits(answer, decimals);
        rec.updatedAt = new Date(Number(updatedAt) * 1000).toISOString();
      }
    } catch {}
  }

  // Print "Custom Oracle Prices" using multicall
  for (const t of targets) {
    const rec = byAddr[t.address];
    if (!rec || rec.price === undefined) continue;
    console.log(`${t.name} @ ${t.address}`);
    console.log(`  description : ${rec.description ?? ""}`);
    console.log(`  decimals    : ${rec.decimals ?? 18}`);
    console.log(`  price       : ${rec.price}`);
    console.log(`  updatedAt   : ${rec.updatedAt ?? ""}`);
    console.log("------------------------------------------------------------");
  }

  // Next: wrappers (generalized, multicall-powered crawl and comparison)
  await runGeneralizedCrawler(args);

  // Finally: aggregator prices
  await dumpAggregatorPrices();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
