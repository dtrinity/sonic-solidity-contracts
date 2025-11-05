import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { Contract, Interface, JsonRpcProvider, formatUnits, getAddress } from "ethers";

type OutputMode = "text" | "json";

interface CliOptions {
  tokens: string[];
  spenders: string[];
  etherscanApiKey: string;
  rpcUrl?: string;
  chainId: number;
  fromBlock: number;
  toBlock: number | "latest";
  pageSize: number;
  maxPages?: number;
  etherscanDelayMs: number;
  rpcDelayMs: number;
  rpcConcurrency: number;
  skipRpcVerification: boolean;
  output: OutputMode;
  cacheDir: string;
  cacheTtlSeconds: number;
  multicallAddress?: string;
  multicallBatchSize: number;
}

interface ApprovalLog {
  owner: string;
  spender: string;
  token: string;
  value: bigint;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  timeStamp?: number;
}

interface AllowanceRecord {
  owner: string;
  token: string;
  spender: string;
  onChainAllowance: bigint;
  eventValue: bigint;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  timeStamp?: number;
}

interface TokenMetadata {
  symbol?: string;
  decimals: number;
}

interface CachedApprovals {
  logs: ApprovalLog[];
  lastFetchedBlock: number;
  updatedAt: number;
}

interface ApprovalCacheKey {
  chainId: number;
  token: string;
  spender: string;
  fromBlock: number;
  pageSize: number;
}

interface CachedApprovalFile {
  version: number;
  chainId: number;
  token: string;
  spender: string;
  fromBlock: number;
  pageSize: number;
  lastFetchedBlock: number;
  updatedAt: number;
  logs: Array<{
    owner: string;
    value: string;
    blockNumber: number;
    logIndex: number;
    transactionHash: string;
    timeStamp?: number;
  }>;
}

const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const ALLOWANCE_SELECTOR = "0xdd62ed3e";
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
];
const CACHE_VERSION = 1;
const DEFAULT_CACHE_DIR = ".cache/allowance-scanner";
const DEFAULT_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

class ApprovalCache {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
  }

  load(key: ApprovalCacheKey): CachedApprovals | undefined {
    const filePath = this.getFilePath(key);

    if (!existsSync(filePath)) {
      return undefined;
    }

    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as CachedApprovalFile;

      if (parsed.version !== CACHE_VERSION) {
        return undefined;
      }

      if (
        parsed.chainId !== key.chainId ||
        parsed.token.toLowerCase() !== key.token.toLowerCase() ||
        parsed.spender.toLowerCase() !== key.spender.toLowerCase() ||
        parsed.fromBlock !== key.fromBlock ||
        parsed.pageSize !== key.pageSize
      ) {
        return undefined;
      }

      const logs: ApprovalLog[] = parsed.logs.map((entry) => ({
        owner: getAddress(entry.owner),
        spender: parsed.spender,
        token: parsed.token,
        value: BigInt(entry.value),
        blockNumber: entry.blockNumber,
        logIndex: entry.logIndex,
        transactionHash: entry.transactionHash,
        timeStamp: entry.timeStamp,
      }));

      return {
        logs,
        lastFetchedBlock: parsed.lastFetchedBlock,
        updatedAt: parsed.updatedAt,
      };
    } catch (error) {
      console.warn(`Failed to read cache file ${filePath}: ${(error as Error).message}`);
      return undefined;
    }
  }

  save(key: ApprovalCacheKey, entry: CachedApprovals): void {
    const filePath = this.getFilePath(key);
    const payload: CachedApprovalFile = {
      version: CACHE_VERSION,
      chainId: key.chainId,
      token: key.token,
      spender: key.spender,
      fromBlock: key.fromBlock,
      pageSize: key.pageSize,
      lastFetchedBlock: entry.lastFetchedBlock,
      updatedAt: entry.updatedAt,
      logs: entry.logs.map((log) => ({
        owner: log.owner,
        value: log.value.toString(),
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
        timeStamp: log.timeStamp,
      })),
    };

    writeFileSync(filePath, JSON.stringify(payload, null, 2));
  }

  private getFilePath(key: ApprovalCacheKey): string {
    const normalizedToken = key.token.toLowerCase();
    const normalizedSpender = key.spender.toLowerCase();
    const rawKey = `${key.chainId}|${normalizedToken}|${normalizedSpender}|${key.fromBlock}|${key.pageSize}`;
    const digest = createHash("sha256").update(rawKey).digest("hex").slice(0, 32);
    return path.join(this.baseDir, `${digest}.json`);
  }
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const provider = options.rpcUrl ? new JsonRpcProvider(options.rpcUrl, options.chainId) : undefined;
  const cache = new ApprovalCache(options.cacheDir);

  const tokenMetadataCache = new Map<string, TokenMetadata>();
  const results: Array<{
    token: string;
    spender: string;
    metadata: TokenMetadata;
    allowances: AllowanceRecord[];
  }> = [];

  for (const token of options.tokens) {
    const metadata = await getTokenMetadata(provider, token, tokenMetadataCache);

    for (const spender of options.spenders) {
      const approvals = await loadApprovalLogsWithCache(token, spender, options, cache);
      const events = collectLatestApprovals(approvals);

      if (events.length === 0) {
        results.push({ token, spender, metadata, allowances: [] });
        continue;
      }

      let allowances: AllowanceRecord[];

      if (options.skipRpcVerification) {
        allowances = events
          .filter((event) => event.value > 0n)
          .map((event) => ({
            owner: event.owner,
            token,
            spender,
            onChainAllowance: event.value,
            eventValue: event.value,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            timeStamp: event.timeStamp,
          }));
      } else {
        if (!provider) {
          throw new Error("RPC URL required for on-chain verification. Provide --rpc-url or set --skip-rpc.");
        }

        allowances = await verifyAllowances(
          provider,
          token,
          spender,
          events,
          options.rpcDelayMs,
          options.rpcConcurrency,
          options.multicallAddress,
          options.multicallBatchSize,
        ).then((records) => records.filter((entry) => entry.onChainAllowance > 0n));
      }

      results.push({ token, spender, metadata, allowances });
    }
  }

  renderOutput(results, options.output);
}

function parseCli(argv: string[]): CliOptions {
  const argMap = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, rawValue] = arg.includes("=") ? arg.slice(2).split("=") : [arg.slice(2), undefined];
    const key = rawKey.trim();

    if (rawValue !== undefined) {
      argMap.set(key, rawValue.trim());
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      argMap.set(key, next.trim());
      i += 1;
      continue;
    }

    argMap.set(key, "true");
  }

  const tokens = collectList(argMap.get("tokens"), argMap.get("tokens-file"));
  const spenders = collectList(argMap.get("spenders"), argMap.get("spenders-file"));

  if (tokens.length === 0) {
    throw new Error("No token addresses provided. Use --tokens or --tokens-file.");
  }

  if (spenders.length === 0) {
    throw new Error("No spender addresses provided. Use --spenders or --spenders-file.");
  }

  const etherscanApiKey = argMap.get("etherscan-api-key") ?? process.env.ETHERSCAN_API_KEY;
  const skipRpcVerification = parseBoolean(argMap.get("skip-rpc"));
  const rpcUrl = argMap.get("rpc-url") ?? process.env.RPC_URL;

  if (!etherscanApiKey) {
    throw new Error("Missing Etherscan API key. Provide via --etherscan-api-key or ETHERSCAN_API_KEY env.");
  }

  if (!rpcUrl && !skipRpcVerification) {
    throw new Error("Missing RPC URL. Provide via --rpc-url or RPC_URL env.");
  }

  const chainId = parseInteger(argMap.get("chain-id"), 1);
  const fromBlock = parseInteger(argMap.get("from-block"), 0);

  const toBlockRaw = argMap.get("to-block") ?? "latest";
  const toBlock = toBlockRaw === "latest" ? "latest" : parseInteger(toBlockRaw, 0);

  const pageSize = Math.min(Math.max(parseInteger(argMap.get("page-size"), 1000), 1), 1000);
  const maxPages = argMap.has("max-pages") ? parseInteger(argMap.get("max-pages"), 1) : undefined;
  const etherscanDelayMs = Math.max(parseInteger(argMap.get("etherscan-delay-ms"), 210), 0);
  const rpcDelayMs = Math.max(parseInteger(argMap.get("rpc-delay-ms"), 0), 0);
  const rpcConcurrency = Math.max(parseInteger(argMap.get("rpc-concurrency"), 4), 1);
  const cacheDir = path.resolve(process.cwd(), argMap.get("cache-dir") ?? DEFAULT_CACHE_DIR);
  const cacheTtlSeconds = parseInteger(argMap.get("cache-ttl-seconds"), 300);
  const multicallBatchSize = Math.max(parseInteger(argMap.get("multicall-batch-size"), 100), 1);

  const rawMulticallAddress = argMap.get("multicall-address");
  let multicallAddress: string | undefined;

  if (rawMulticallAddress === undefined) {
    multicallAddress = DEFAULT_MULTICALL3;
  } else if (rawMulticallAddress.toLowerCase() === "none") {
    multicallAddress = undefined;
  } else {
    multicallAddress = getAddress(rawMulticallAddress);
  }

  const output = (argMap.get("output") ?? "text").toLowerCase() as OutputMode;
  if (output !== "text" && output !== "json") {
    throw new Error(`Unsupported output mode "${output}". Use "text" or "json".`);
  }

  return {
    tokens: normalizeAddresses(tokens),
    spenders: normalizeAddresses(spenders),
    etherscanApiKey,
    rpcUrl,
    chainId,
    fromBlock,
    toBlock,
    pageSize,
    maxPages,
    etherscanDelayMs,
    rpcDelayMs,
    rpcConcurrency,
    skipRpcVerification,
    output,
    cacheDir,
    cacheTtlSeconds,
    multicallAddress,
    multicallBatchSize,
  };
}

function collectList(inline?: string, filePath?: string): string[] {
  const values = new Set<string>();

  const processEntry = (input: string | undefined) => {
    if (!input) {
      return;
    }

    const commentIndex = input.indexOf("#");
    const withoutComment = commentIndex >= 0 ? input.slice(0, commentIndex) : input;
    const trimmed = withoutComment.trim();

    if (trimmed) {
      values.add(trimmed);
    }
  };

  if (inline) {
    inline.split(",").forEach((value) => processEntry(value));
  }

  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    const content = readFileSync(resolved, "utf8");
    content.split(/\r?\n/).forEach((line) => processEntry(line));
  }

  return Array.from(values);
}

function normalizeAddresses(addresses: string[]): string[] {
  return addresses.map((entry) => getAddress(entry));
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value "${value}".`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

async function loadApprovalLogsWithCache(
  token: string,
  spender: string,
  options: CliOptions,
  cache: ApprovalCache,
): Promise<ApprovalLog[]> {
  const key: ApprovalCacheKey = {
    chainId: options.chainId,
    token,
    spender,
    fromBlock: options.fromBlock,
    pageSize: options.pageSize,
  };

  const cached = cache.load(key);
  const now = Math.floor(Date.now() / 1000);

  let logs = cached?.logs ?? [];
  let lastFetchedBlock = cached?.lastFetchedBlock ?? options.fromBlock - 1;
  const updatedAt = cached?.updatedAt ?? 0;

  let shouldFetch = cached === undefined;

  if (!shouldFetch) {
    if (typeof options.toBlock === "number" && options.toBlock > lastFetchedBlock) {
      shouldFetch = true;
    } else if (options.toBlock === "latest") {
      if (options.cacheTtlSeconds === 0) {
        shouldFetch = true;
      } else if (options.cacheTtlSeconds > 0 && now - updatedAt >= options.cacheTtlSeconds) {
        shouldFetch = true;
      }
    }
  }

  if (shouldFetch) {
    const fetchFrom = Math.max(options.fromBlock, lastFetchedBlock + 1);
    const fetchTo = options.toBlock;

    if (typeof fetchTo !== "number" || fetchFrom <= fetchTo) {
      let receivedLogs = false;
      await fetchApprovalEvents(
        token,
        spender,
        options.chainId,
        options.etherscanApiKey,
        fetchFrom,
        fetchTo,
        options.pageSize,
        options.maxPages,
        options.etherscanDelayMs,
        async (pageLogs, _page) => {
          if (pageLogs.length === 0) {
            return;
          }
          receivedLogs = true;
          logs = mergeApprovalLogs(logs, pageLogs);
          const maxFetchedBlock = pageLogs.reduce((acc, item) => Math.max(acc, item.blockNumber), lastFetchedBlock);
          lastFetchedBlock = Math.max(lastFetchedBlock, maxFetchedBlock);
          cache.save(key, {
            logs,
            lastFetchedBlock,
            updatedAt: Math.floor(Date.now() / 1000),
          });
        },
      );

      if (!receivedLogs) {
        if (typeof fetchTo === "number") {
          lastFetchedBlock = Math.max(lastFetchedBlock, fetchTo);
        }
        cache.save(key, {
          logs,
          lastFetchedBlock,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      } else if (typeof fetchTo === "number" && lastFetchedBlock < fetchTo) {
        lastFetchedBlock = fetchTo;
        cache.save(key, {
          logs,
          lastFetchedBlock,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }
    }
  }

  const upperBound = typeof options.toBlock === "number" ? options.toBlock : Number.POSITIVE_INFINITY;

  return logs.filter((log) => log.blockNumber >= options.fromBlock && log.blockNumber <= upperBound);
}

async function fetchApprovalEvents(
  token: string,
  spender: string,
  chainId: number,
  etherscanApiKey: string,
  fromBlock: number,
  toBlock: number | "latest",
  pageSize: number,
  maxPages: number | undefined,
  delayMs: number,
  onPage?: (logs: ApprovalLog[], page: number) => Promise<void> | void,
): Promise<ApprovalLog[]> {
  const entries: ApprovalLog[] = [];
  let page = 1;

  while (true) {
    if (maxPages !== undefined && page > maxPages) {
      break;
    }

    const params = new URLSearchParams({
      chainid: chainId.toString(),
      module: "logs",
      action: "getLogs",
      address: token,
      fromBlock: fromBlock.toString(),
      toBlock: typeof toBlock === "number" ? toBlock.toString() : "latest",
      topic0: APPROVAL_TOPIC,
      topic2: `0x000000000000000000000000${spender.slice(2).toLowerCase()}`,
      page: page.toString(),
      offset: pageSize.toString(),
      apikey: etherscanApiKey,
    });

    const response = await fetch(`https://api.etherscan.io/v2/api?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch logs: HTTP ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      status: string;
      message: string;
      result: Array<{
        topics: string[];
        data: string;
        timeStamp?: string;
        blockNumber: string;
        logIndex: string;
        transactionHash: string;
      }>;
    };

    if (data.status === "0") {
      if (data.message === "No records found") {
        break;
      }

      throw new Error(`Etherscan error: ${data.message}`);
    }

    const pageEntries: ApprovalLog[] = [];

    for (const log of data.result) {
      if (log.topics.length < 3) {
        continue;
      }

      const owner = topicToAddress(log.topics[1]);
      const value = BigInt(log.data);
      const blockNumber = parseBlockNumber(log.blockNumber);
      const logIndex = parseBlockNumber(log.logIndex);
      const timeStamp = log.timeStamp ? parseBlockNumber(log.timeStamp) : undefined;

      const parsedLog: ApprovalLog = {
        owner,
        spender,
        token,
        value,
        blockNumber,
        logIndex,
        transactionHash: log.transactionHash,
        timeStamp,
      };

      entries.push(parsedLog);
      pageEntries.push(parsedLog);
    }

    if (onPage && pageEntries.length > 0) {
      await onPage(pageEntries, page);
    }

    if (data.result.length < pageSize) {
      break;
    }

    page += 1;
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return entries;
}

function mergeApprovalLogs(existing: ApprovalLog[], incoming: ApprovalLog[]): ApprovalLog[] {
  if (incoming.length === 0) {
    return existing.slice();
  }

  const byKey = new Map<string, ApprovalLog>();

  for (const log of existing) {
    byKey.set(approvalLogKey(log), log);
  }

  for (const log of incoming) {
    byKey.set(approvalLogKey(log), log);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber - b.blockNumber;
    }
    return a.logIndex - b.logIndex;
  });
}

function approvalLogKey(log: ApprovalLog): string {
  return `${log.blockNumber}:${log.logIndex}:${log.transactionHash}`;
}

function collectLatestApprovals(logs: ApprovalLog[]): ApprovalLog[] {
  const latestByOwner = new Map<string, ApprovalLog>();

  for (const log of logs) {
    const existing = latestByOwner.get(log.owner);

    if (
      !existing ||
      log.blockNumber > existing.blockNumber ||
      (log.blockNumber === existing.blockNumber && log.logIndex > existing.logIndex)
    ) {
      latestByOwner.set(log.owner, log);
    }
  }

  return Array.from(latestByOwner.values());
}

async function verifyAllowances(
  provider: JsonRpcProvider,
  token: string,
  spender: string,
  events: ApprovalLog[],
  rpcDelayMs: number,
  rpcConcurrency: number,
  multicallAddress: string | undefined,
  multicallBatchSize: number,
): Promise<AllowanceRecord[]> {
  if (events.length === 0) {
    return [];
  }

  if (multicallAddress) {
    try {
      return await verifyAllowancesWithMulticall(provider, token, spender, events, multicallAddress, multicallBatchSize, rpcDelayMs);
    } catch (error) {
      console.warn(`Multicall allowance query failed, falling back to individual calls: ${(error as Error).message}`);
    }
  }

  return verifyAllowancesIndividually(provider, token, spender, events, rpcDelayMs, rpcConcurrency);
}

async function verifyAllowancesWithMulticall(
  provider: JsonRpcProvider,
  token: string,
  spender: string,
  events: ApprovalLog[],
  multicallAddress: string,
  batchSize: number,
  rpcDelayMs: number,
): Promise<AllowanceRecord[]> {
  const multicallInterface = new Interface(MULTICALL3_ABI);
  const erc20Interface = new Interface(ERC20_ABI);
  const allowances = new Map<string, bigint>();

  for (let i = 0; i < events.length; i += batchSize) {
    const chunk = events.slice(i, i + batchSize);
    const calls = chunk.map((entry) => ({
      target: token,
      allowFailure: true,
      callData: erc20Interface.encodeFunctionData("allowance", [entry.owner, spender]),
    }));

    const encoded = multicallInterface.encodeFunctionData("aggregate3", [calls]);
    const raw = await provider.call({ to: multicallAddress, data: encoded });
    const decoded = multicallInterface.decodeFunctionResult("aggregate3", raw);
    const results = decoded[0] as Array<{ success: boolean; returnData: string }>;

    for (let j = 0; j < chunk.length; j += 1) {
      const owner = chunk[j].owner;
      const callResult = results[j];
      let value = 0n;

      if (callResult?.success && callResult.returnData && callResult.returnData !== "0x") {
        value = BigInt(callResult.returnData);
      }

      allowances.set(owner, value);
    }

    if (rpcDelayMs > 0 && i + batchSize < events.length) {
      await sleep(rpcDelayMs);
    }
  }

  return events.map((event) => ({
    owner: event.owner,
    token: event.token,
    spender: event.spender,
    onChainAllowance: allowances.get(event.owner) ?? 0n,
    eventValue: event.value,
    blockNumber: event.blockNumber,
    logIndex: event.logIndex,
    transactionHash: event.transactionHash,
    timeStamp: event.timeStamp,
  }));
}

async function verifyAllowancesIndividually(
  provider: JsonRpcProvider,
  token: string,
  spender: string,
  events: ApprovalLog[],
  rpcDelayMs: number,
  concurrency: number,
): Promise<AllowanceRecord[]> {
  const results: AllowanceRecord[] = new Array(events.length);
  let cursor = 0;
  const workerCount = Math.min(concurrency, events.length);

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= events.length) {
        return;
      }

      const event = events[index];
      const allowance = await readAllowance(provider, token, event.owner, spender);

      if (rpcDelayMs > 0) {
        await sleep(rpcDelayMs);
      }

      results[index] = {
        owner: event.owner,
        token,
        spender,
        onChainAllowance: allowance,
        eventValue: event.value,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        transactionHash: event.transactionHash,
        timeStamp: event.timeStamp,
      };
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function readAllowance(provider: JsonRpcProvider, token: string, owner: string, spender: string): Promise<bigint> {
  const data = `${ALLOWANCE_SELECTOR}${padAddress(owner)}${padAddress(spender)}`;

  try {
    const raw = await provider.call({ to: token, data });
    if (!raw || raw === "0x") {
      return 0n;
    }

    return BigInt(raw);
  } catch (error) {
    console.warn(`Failed to read allowance for ${owner} -> ${spender} on ${token}: ${(error as Error).message}`);
    return 0n;
  }
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function getTokenMetadata(
  provider: JsonRpcProvider | undefined,
  token: string,
  cache: Map<string, TokenMetadata>,
): Promise<TokenMetadata> {
  if (cache.has(token)) {
    return cache.get(token)!;
  }

  if (!provider) {
    const metadata: TokenMetadata = { symbol: undefined, decimals: 18 };
    cache.set(token, metadata);
    return metadata;
  }

  const contract = new Contract(token, ERC20_ABI, provider);

  let symbol: string | undefined;
  let decimals = 18;

  try {
    const [rawSymbol, rawDecimals] = await Promise.allSettled([contract.symbol(), contract.decimals()]);

    if (rawSymbol.status === "fulfilled") {
      symbol = rawSymbol.value;
    }

    if (rawDecimals.status === "fulfilled") {
      decimals = Number(rawDecimals.value);
    }
  } catch {
    // Fall back to default metadata
  }

  const metadata: TokenMetadata = { symbol, decimals };
  cache.set(token, metadata);
  return metadata;
}

function renderOutput(
  results: Array<{ token: string; spender: string; metadata: TokenMetadata; allowances: AllowanceRecord[] }>,
  mode: OutputMode,
): void {
  if (mode === "json") {
    const payload = results.map((entry) => ({
      token: entry.token,
      symbol: entry.metadata.symbol,
      decimals: entry.metadata.decimals,
      spender: entry.spender,
      allowances: entry.allowances.map((item) => ({
        owner: item.owner,
        onChainAllowance: item.onChainAllowance.toString(),
        formattedAllowance: formatUnits(item.onChainAllowance, entry.metadata.decimals),
        lastApprovalEvent: {
          rawValue: item.eventValue.toString(),
          formattedValue: formatUnits(item.eventValue, entry.metadata.decimals),
          blockNumber: item.blockNumber,
          logIndex: item.logIndex,
          transactionHash: item.transactionHash,
          timeStamp: item.timeStamp,
        },
      })),
    }));

    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  for (const entry of results) {
    const headerSymbol = entry.metadata.symbol ? ` (${entry.metadata.symbol})` : "";
    console.log(`Token: ${entry.token}${headerSymbol} | Decimals: ${entry.metadata.decimals}`);
    console.log(`  Spender: ${entry.spender}`);

    if (entry.allowances.length === 0) {
      console.log("  No positive allowances found.\n");
      continue;
    }

    console.log(`  Positive allowances: ${entry.allowances.length}`);
    for (const allowance of entry.allowances) {
      const formattedOnChain = formatUnits(allowance.onChainAllowance, entry.metadata.decimals);
      const formattedEvent = formatUnits(allowance.eventValue, entry.metadata.decimals);
      const timestamp = allowance.timeStamp ? new Date(allowance.timeStamp * 1000).toISOString() : "unknown";

      console.log(
        `    Owner: ${allowance.owner} | Current: ${formattedOnChain} | Last event: ${formattedEvent} | Block: ${allowance.blockNumber} | Tx: ${allowance.transactionHash} | Time: ${timestamp}`,
      );
    }

    console.log("");
  }
}

function topicToAddress(topic: string): string {
  if (!topic.startsWith("0x") || topic.length !== 66) {
    throw new Error(`Invalid topic for address: ${topic}`);
  }

  return getAddress(`0x${topic.slice(26)}`);
}

function parseBlockNumber(value: string): number {
  if (value.startsWith("0x")) {
    return Number.parseInt(value, 16);
  }

  return Number.parseInt(value, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
