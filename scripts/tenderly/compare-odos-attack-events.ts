import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { Interface, Log, formatUnits } from "ethers";
import { ethers } from "hardhat";
import {
  createMaliciousSwapData,
  deployOdosV1ExploitFixture,
  COLLATERAL_TO_SWAP,
  EXTRA_COLLATERAL
} from "../../test/dlend/adapters/odos/v1/fixtures/setup";
import {
  TenderlyTraceResult,
  TenderlyTransferEvent,
  extractTenderlyTransferEvents,
  summarizeCallTrace,
  traceTransaction
} from "../../typescript/tenderly/client";

interface LocalTransferEvent {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly decodedVia: "local";
}

interface LocalEventSummary {
  readonly address: string;
  readonly event: string;
  readonly args: Record<string, string>;
}

interface ComparisonOutput {
  readonly metadata: {
    readonly generatedAt: string;
    readonly txHash: string;
    readonly network: string;
    readonly harnessTxHash: string;
  };
  readonly actual: {
    readonly transfers: TenderlyTransferEvent[];
    readonly callTraceExcerpt: string;
    readonly error?: string;
    readonly usedCache?: boolean;
  };
  readonly local: {
    readonly transfers: LocalTransferEvent[];
    readonly customEvents: LocalEventSummary[];
  };
}

interface TokenMetadata {
  readonly symbol?: string;
  readonly decimals: number;
}

const OUTPUT_DIR = path.join("reports", "tenderly");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "attack-vs-repro-transfers.json");
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const transferIface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

async function ensureOutputDir(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Environment variable ${name} must be set`);
  }
  return value;
}

function extractLocalTransferEvents(logs: readonly Log[]): LocalTransferEvent[] {
  const transfers: LocalTransferEvent[] = [];

  for (const log of logs) {
    if (!log.topics || log.topics.length === 0) {
      continue;
    }
    if (log.topics[0].toLowerCase() !== TRANSFER_TOPIC) {
      continue;
    }

    const parsed = transferIface.parseLog({ data: log.data, topics: log.topics });
    transfers.push({
      token: log.address,
      from: parsed.args[0] as string,
      to: parsed.args[1] as string,
      value: BigInt(parsed.args[2].toString()),
      decodedVia: "local"
    });
  }

  return transfers;
}

function aggregateByToken(transfers: readonly { token: string; value: bigint }[]): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const transfer of transfers) {
    const current = totals.get(transfer.token) ?? 0n;
    totals.set(transfer.token, current + transfer.value);
  }
  return totals;
}

function aggregateNetFlows(transfers: readonly { token: string; from: string; to: string; value: bigint }[]): Map<string, Map<string, bigint>> {
  const perToken = new Map<string, Map<string, bigint>>();

  for (const transfer of transfers) {
    const tokenMap = perToken.get(transfer.token) ?? new Map<string, bigint>();

    const fromBalance = tokenMap.get(transfer.from) ?? 0n;
    tokenMap.set(transfer.from, fromBalance - transfer.value);

    const toBalance = tokenMap.get(transfer.to) ?? 0n;
    tokenMap.set(transfer.to, toBalance + transfer.value);

    perToken.set(transfer.token, tokenMap);
  }

  return perToken;
}

function tokenLabel(token: string, metadata?: Map<string, TokenMetadata>): string {
  const meta = metadata?.get(token);
  if (!meta) {
    return token;
  }
  if (meta.symbol && meta.symbol.length > 0) {
    return `${meta.symbol} (${token})`;
  }
  return token;
}

function formatTokenAmount(token: string, amount: bigint, metadata?: Map<string, TokenMetadata>): string {
  const meta = metadata?.get(token);
  const decimals = meta?.decimals ?? 18;
  return formatUnits(amount, decimals);
}

function logTokenSummary(
  label: string,
  transfers: readonly { token: string; value: bigint }[],
  metadata?: Map<string, TokenMetadata>
): void {
  console.log(`\n${label}`);
  const totals = aggregateByToken(transfers);
  for (const [token, total] of totals.entries()) {
    const formatted = formatTokenAmount(token, total, metadata);
    console.log(`  Token ${tokenLabel(token, metadata)} total moved: ${formatted} (raw: ${total.toString()})`);
  }
}

function logNetFlows(
  label: string,
  transfers: readonly { token: string; from: string; to: string; value: bigint }[],
  metadata?: Map<string, TokenMetadata>
): void {
  console.log(`\n${label}`);
  const perToken = aggregateNetFlows(transfers);
  for (const [token, flows] of perToken.entries()) {
    console.log(`  Token ${tokenLabel(token, metadata)}`);
    for (const [account, delta] of flows.entries()) {
      if (delta === 0n) {
        continue;
      }
      const direction = delta > 0n ? "received" : "sent";
      const absolute = delta > 0n ? delta : -delta;
      const formatted = formatTokenAmount(token, absolute, metadata);
      console.log(`    ${account} ${direction}: ${formatted} (raw: ${delta.toString()})`);
    }
  }
}

function stringifyBigInts<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val))
  );
}

function formatLogValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatLogValue(item)).join(",");
  }
  if (value && typeof value === "object") {
    if ("toString" in value && typeof value.toString === "function") {
      const str = value.toString();
      if (str !== "[object Object]") {
        return str;
      }
    }
    return JSON.stringify(value);
  }
  return String(value);
}

async function fetchTenderlyTrace(txHash: string, network: string, accessKey: string, projectSlug?: string): Promise<TenderlyTraceResult> {
  console.log(`Fetching Tenderly trace for ${txHash} on ${network}...`);
  const result = await traceTransaction({ txHash, network, accessKey, projectSlug });
  console.log(`Fetched ${result.logs?.length ?? 0} logs and ${result.trace?.length ?? 0} top-level calls.`);
  return result;
}

async function runLocalRepro(): Promise<{
  transfers: LocalTransferEvent[];
  customEvents: LocalEventSummary[];
  txHash: string;
}> {
  const fixture = await deployOdosV1ExploitFixture();
  const {
    deployer,
    victim,
    attacker,
    attackerBeneficiary,
    reserveManager,
    pool,
    router,
    attackExecutor,
    adapter,
    wstkscUsd,
    dusd,
    aWstkscUsd
  } = fixture;

  await pool
    .connect(deployer)
    .configureReserve(
      await wstkscUsd.getAddress(),
      reserveManager.address,
      await attackExecutor.getAddress(),
      0,
      EXTRA_COLLATERAL
    );

  await aWstkscUsd.connect(victim).approve(await adapter.getAddress(), COLLATERAL_TO_SWAP);

  const swapData = createMaliciousSwapData(router);
  await router.setSwapBehaviour(
    await wstkscUsd.getAddress(),
    await dusd.getAddress(),
    COLLATERAL_TO_SWAP,
    false,
    await attackExecutor.getAddress()
  );

  const permitInput = {
    aToken: await aWstkscUsd.getAddress(),
    value: 0n,
    deadline: 0n,
    v: 0,
    r: ethers.ZeroHash,
    s: ethers.ZeroHash
  };

  const liquiditySwapParams = {
    collateralAsset: await wstkscUsd.getAddress(),
    collateralAmountToSwap: COLLATERAL_TO_SWAP,
    newCollateralAsset: await wstkscUsd.getAddress(),
    newCollateralAmount: 1n,
    user: victim.address,
    withFlashLoan: true,
    swapData
  };

  const tx = await attackExecutor
    .connect(attacker)
    .executeAttack(liquiditySwapParams, permitInput);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("Missing transaction receipt for local repro");
  }

  const transfers = extractLocalTransferEvents(receipt.logs);
  const routerAddress = await router.getAddress();
  const executorAddress = await attackExecutor.getAddress();

  const customEvents: LocalEventSummary[] = [];
  for (const log of receipt.logs) {
    if (log.address === routerAddress) {
      try {
        const parsed = router.interface.parseLog(log);
        const namedArgs: Record<string, string> = {};
        for (let i = 0; i < parsed.fragment.inputs.length; i += 1) {
          const input = parsed.fragment.inputs[i];
          const key = input?.name && input.name.length > 0 ? input.name : `arg${i}`;
          namedArgs[key] = formatLogValue(parsed.args[i]);
        }
        customEvents.push({
          address: routerAddress,
          event: parsed.name,
          args: namedArgs
        });
      } catch (err) {
        console.warn("Failed to parse router log", err);
      }
    }
    if (log.address === executorAddress) {
      try {
        const parsed = attackExecutor.interface.parseLog(log);
        const namedArgs: Record<string, string> = {};
        for (let i = 0; i < parsed.fragment.inputs.length; i += 1) {
          const input = parsed.fragment.inputs[i];
          const key = input?.name && input.name.length > 0 ? input.name : `arg${i}`;
          namedArgs[key] = formatLogValue(parsed.args[i]);
        }
        customEvents.push({
          address: executorAddress,
          event: parsed.name,
          args: namedArgs
        });
      } catch (err) {
        console.warn("Failed to parse executor log", err);
      }
    }
  }

  return {
    transfers,
    customEvents,
    txHash: receipt.hash
  };
}

async function main(): Promise<void> {
  const txHash = requireEnv("TENDERLY_TX_HASH", "0xa6aef05387f5b86b1fd563256fc9223f3c22f74292d66ac796d3f08fd311d940");
  const network = requireEnv("TENDERLY_NETWORK", "sonic");
  const accessKey = requireEnv("TENDERLY_ACCESS_KEY");
  const projectSlug = process.env.TENDERLY_PROJECT_SLUG ?? "project";
  const cacheAllowed = process.env.TENDERLY_FORCE_REFRESH !== "true";
  const traceCacheFile = path.join(
    OUTPUT_DIR,
    `raw-tenderly-trace-${network}-${txHash.slice(2, 10)}.json`
  );

  let tenderlyTrace: TenderlyTraceResult | null = null;
  let tenderlyError: string | undefined;
  let usedCache = false;

  if (cacheAllowed) {
    try {
      const cached = await fs.readFile(traceCacheFile, "utf8");
      tenderlyTrace = JSON.parse(cached) as TenderlyTraceResult;
      usedCache = true;
      console.log(`Loaded Tenderly trace from cache ${traceCacheFile}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`Cache miss (${message}), will request fresh trace.`);
    }
  }

  if (!tenderlyTrace) {
    try {
      tenderlyTrace = await fetchTenderlyTrace(txHash, network, accessKey, projectSlug);
      await ensureOutputDir();
      await fs.writeFile(traceCacheFile, JSON.stringify(tenderlyTrace, null, 2));
      console.log(`Cached Tenderly trace to ${traceCacheFile}`);
    } catch (err) {
      tenderlyError = err instanceof Error ? err.message : String(err);
      console.error(`Failed to fetch Tenderly trace: ${tenderlyError}`);

      if (cacheAllowed) {
        try {
          const cached = await fs.readFile(traceCacheFile, "utf8");
          tenderlyTrace = JSON.parse(cached) as TenderlyTraceResult;
          usedCache = true;
          console.log(`Recovered Tenderly trace from cache ${traceCacheFile}`);
          tenderlyError = `${tenderlyError} (used cached copy)`;
        } catch (cacheErr) {
          const cacheMsg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
          console.error(`Failed to recover cache: ${cacheMsg}`);
        }
      }
    }
  }

  const actualTransfers = tenderlyTrace ? extractTenderlyTransferEvents(tenderlyTrace) : [];
  const callTraceExcerpt = tenderlyTrace?.trace ? summarizeCallTrace(tenderlyTrace.trace.slice(0, 4)) : "";
  const tokenMetadata = new Map<string, TokenMetadata>();
  if (tenderlyTrace?.assetChanges) {
    for (const change of tenderlyTrace.assetChanges) {
      const address = change?.assetInfo?.contractAddress;
      if (!address) {
        continue;
      }
      const decimals = Number(change.assetInfo?.decimals ?? 18);
      const symbol = change.assetInfo?.symbol ?? undefined;
      if (!tokenMetadata.has(address)) {
        tokenMetadata.set(address, { symbol, decimals: Number.isNaN(decimals) ? 18 : decimals });
      }
    }
  }

  const { transfers: localTransfers, customEvents, txHash: localTxHash } = await runLocalRepro();

  const localTokenMetadata = new Map<string, TokenMetadata>();
  for (const transfer of localTransfers) {
    if (!localTokenMetadata.has(transfer.token)) {
      localTokenMetadata.set(transfer.token, { decimals: 18 });
    }
  }

  await ensureOutputDir();
  const payload: ComparisonOutput = {
    metadata: {
      generatedAt: new Date().toISOString(),
      txHash,
      network,
      harnessTxHash: localTxHash
    },
    actual: {
      transfers: actualTransfers,
      callTraceExcerpt,
      error: tenderlyError,
      usedCache
    },
    local: {
      transfers: localTransfers,
      customEvents
    }
  };

  const serialised = JSON.stringify(stringifyBigInts(payload), null, 2);
  await fs.writeFile(OUTPUT_FILE, `${serialised}\n`);

  console.log(`\nWrote comparison artefact to ${OUTPUT_FILE}`);
  logTokenSummary("Actual attack transfer totals", actualTransfers, tokenMetadata);
  logNetFlows("Actual attack net flows per account", actualTransfers, tokenMetadata);
  logTokenSummary("Local repro transfer totals", localTransfers, localTokenMetadata);
  logNetFlows("Local repro net flows per account", localTransfers, localTokenMetadata);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
