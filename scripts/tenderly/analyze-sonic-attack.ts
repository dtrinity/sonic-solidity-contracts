import "dotenv/config";
import path from "path";
import { promises as fs } from "fs";
import { formatUnits } from "ethers";
import {
  TenderlyTraceResult,
  TenderlyTransferEvent,
  TenderlyCall,
  extractTenderlyTransferEvents,
  traceTransaction,
} from "../../typescript/tenderly/client";

interface NamedAddressMap {
  readonly [address: string]: string;
}

interface StepCheck {
  readonly description: string;
  readonly passed: boolean;
  readonly details?: string;
}

interface TokenSummaryEntry {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly decodedVia: string;
}

interface TokenSummary {
  readonly symbol: string;
  readonly decimals: number;
  readonly transfers: TokenSummaryEntry[];
  readonly netBalances: Record<string, string>;
}

interface AnalysisReport {
  readonly metadata: {
    readonly generatedAt: string;
    readonly txHash: string;
    readonly network: string;
    readonly traceSource: string;
  };
  readonly stepChecks: StepCheck[];
  readonly tokenSummaries: Record<string, TokenSummary>;
  readonly callInfo: {
    readonly swapLiquidity?: {
      readonly from: string;
      readonly to: string;
      readonly functionName?: string;
      readonly args?: Record<string, unknown>;
    };
    readonly flashLoan?: {
      readonly from: string;
      readonly to: string;
      readonly functionName?: string;
      readonly args?: Record<string, unknown>;
    };
  };
}

const DEFAULT_TX_HASH = "0xa6aef05387f5b86b1fd563256fc9223f3c22f74292d66ac796d3f08fd311d940";
const DEFAULT_NETWORK = "sonic";
const TRACE_DIR = path.join("reports", "tenderly");

const TOKEN_INFO = {
  dUSD: { address: "0x53a6abb52b2f968fa80df6a894e4f1b1020da975", decimals: 18 },
  aWSTKSCUSD: { address: "0x72f1b09dea4bef67d223c21ab4a2bfcaa60f0d51", decimals: 18 },
  wstkscUSD: { address: "0x9fb76f7ce5fceaa2c42887ff441d46095e494206", decimals: 6 },
} as const;

const ADDRESS_LABELS: NamedAddressMap = {
  "0x0a69c298ece97fb50a00ace91c79182184423933": "attacker_eoa",
  "0xde8558c9111fd58c8db74c6c01d29bb9e5836565": "attacker_executor",
  "0x9ee939ddc8eaaac72d3cae793b12a09d92624e4a": "odos_adapter",
  "0xc51fefb9ef83f2d300448b22db6fac032f96df3f": "victim",
  "0x53a6abb52b2f968fa80df6a894e4f1b1020da975": "dUSD",
  "0x72f1b09dea4bef67d223c21ab4a2bfcaa60f0d51": "aWSTKSCUSD",
  "0x9fb76f7ce5fceaa2c42887ff441d46095e494206": "wstkscUSD",
  "0x8805f9d444de3994aa69f8bbdfbc08fe3a277aee": "dusd_staging_vault",
  "0xdb81ee19ea2e5e1aca04f55d9c6c4188c36a81fe": "dusd_recycler",
  "0xb1c1a961a6619289f035a5ea413f8dcc53433061": "dusd_splitter",
  "0x2493b7809f8ed73224a6867a8b82b7329fa598a7": "micro_dist_1",
  "0x6bfaaa1f342df3f6afba6be7e0a555f34bb91793": "micro_dist_2",
  "0xba1333333333a1ba1108e8412f11850a5c319ba9": "odos_pool_leg",
  "0xba12222222228d8ba445958a75a0704d566bf2c8": "balancer_vault",
  "0xf0ab950ce2dbc6af4bff3d9bdcb82e634aafd6e0": "reserve_manager",
  "0x10451579fd6375c8bee09f1e2c5831afde9003ed": "atoken_burn_helper",
  "0x0000000000000000000000000000000000000000": "zero",
};

function normalise(value: string): string {
  return value.toLowerCase();
}

async function ensureTrace(txHash: string, network: string, cachePath: string): Promise<TenderlyTraceResult> {
  try {
    const cached = await fs.readFile(cachePath, "utf8");
    return JSON.parse(cached) as TenderlyTraceResult;
  } catch (err) {
    const accessKey = process.env.TENDERLY_ACCESS_KEY;
    if (!accessKey) {
      throw new Error(`Tenderly trace not cached at ${cachePath} and TENDERLY_ACCESS_KEY not set to fetch it.`);
    }
    const projectSlug = process.env.TENDERLY_PROJECT_SLUG ?? "project";
    const trace = await traceTransaction({
      txHash,
      network,
      accessKey,
      projectSlug,
    });
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(trace, null, 2));
    return trace;
  }
}

function labelAddress(address: string): string {
  const lower = normalise(address);
  return ADDRESS_LABELS[lower] ?? address;
}

function formatAmount(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

function summariseToken(transfers: readonly TenderlyTransferEvent[], tokenName: keyof typeof TOKEN_INFO): TokenSummary {
  const info = TOKEN_INFO[tokenName];
  const tokenAddress = normalise(info.address);
  const relevant = transfers.filter((t) => normalise(t.token) === tokenAddress);

  const entries: TokenSummaryEntry[] = relevant.map((t) => ({
    from: labelAddress(t.from),
    to: labelAddress(t.to),
    value: formatAmount(t.value, info.decimals),
    decodedVia: t.decodedVia,
  }));

  const net: Record<string, bigint> = {};
  for (const t of relevant) {
    const fromLabel = labelAddress(t.from);
    const toLabel = labelAddress(t.to);

    net[fromLabel] = (net[fromLabel] ?? 0n) - t.value;
    net[toLabel] = (net[toLabel] ?? 0n) + t.value;
  }

  const netStrings: Record<string, string> = {};
  for (const [addr, amount] of Object.entries(net)) {
    if (amount === 0n) {
      continue;
    }
    netStrings[addr] = formatAmount(amount, info.decimals);
  }

  return {
    symbol: tokenName,
    decimals: info.decimals,
    transfers: entries,
    netBalances: netStrings,
  };
}

function findCall(rootCalls: readonly TenderlyCall[] | undefined, predicate: (call: TenderlyCall) => boolean): TenderlyCall | undefined {
  if (!rootCalls) {
    return undefined;
  }
  const stack: TenderlyCall[] = [...rootCalls];
  while (stack.length > 0) {
    const call = stack.pop();
    if (!call) {
      continue;
    }
    if (predicate(call)) {
      return call;
    }
    if (call.children && call.children.length > 0) {
      stack.push(...call.children);
    }
  }
  return undefined;
}

function extractArgs(call?: TenderlyCall): Record<string, unknown> | undefined {
  if (!call?.inputs) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const input of call.inputs) {
    result[input.name] = input.value;
  }
  return result;
}

function buildStepChecks(transfers: readonly TenderlyTransferEvent[]): StepCheck[] {
  const checks: StepCheck[] = [];
  const dusdInfo = TOKEN_INFO.dUSD;
  const dusdTransfers = transfers.filter((t) => normalise(t.token) === normalise(dusdInfo.address));
  const minted = dusdTransfers.find(
    (t) =>
      normalise(t.from) === normalise("0x0000000000000000000000000000000000000000") &&
      normalise(t.to) === normalise("0xde8558c9111fd58c8db74c6c01d29bb9e5836565"),
  );
  checks.push({
    description: "dUSD flash-mint from zero address to attacker executor",
    passed: minted !== undefined,
    details: minted ? `amount=${formatAmount(minted.value, dusdInfo.decimals)}` : "missing transfer",
  });

  const repaid = dusdTransfers.find(
    (t) =>
      normalise(t.from) === normalise("0xde8558c9111fd58c8db74c6c01d29bb9e5836565") &&
      normalise(t.to) === normalise("0x0000000000000000000000000000000000000000"),
  );
  checks.push({
    description: "dUSD flash-mint repaid to zero address",
    passed: repaid !== undefined,
    details: repaid ? `amount=${formatAmount(repaid.value, dusdInfo.decimals)}` : "missing repayment",
  });

  const atokenInfo = TOKEN_INFO.aWSTKSCUSD;
  const atokenTransfers = transfers.filter((t) => normalise(t.token) === normalise(atokenInfo.address));
  const zeroAddress = normalise("0x0000000000000000000000000000000000000000");
  const adapterAddress = normalise("0x9ee939ddc8eaaac72d3cae793b12a09d92624e4a");
  const victimAddress = normalise("0xc51fefb9ef83f2d300448b22db6fac032f96df3f");
  const aBurn = atokenTransfers.find((t) => {
    if (normalise(t.to) !== zeroAddress) {
      return false;
    }
    const from = normalise(t.from);
    return from === adapterAddress || from === victimAddress;
  });
  checks.push({
    description: "Victim aToken balance burned (transfer to zero)",
    passed: aBurn !== undefined,
    details: aBurn ? `from=${labelAddress(aBurn.from)} amount=${formatAmount(aBurn.value, atokenInfo.decimals)}` : "missing burn transfer",
  });

  const wstInfo = TOKEN_INFO.wstkscUSD;
  const wstTransfers = transfers.filter((t) => normalise(t.token) === normalise(wstInfo.address));
  const dust = wstTransfers.find(
    (t) =>
      normalise(t.from) === normalise("0xde8558c9111fd58c8db74c6c01d29bb9e5836565") && normalise(t.to) === adapterAddress && t.value === 1n,
  );
  checks.push({
    description: "Dust (1 micro wstkscUSD) returned from attacker executor to adapter",
    passed: dust !== undefined,
    details: dust ? `value=${dust.value.toString()}` : "missing dust transfer",
  });

  const attackerGain = wstTransfers.filter((t) => normalise(t.to) === normalise("0xde8558c9111fd58c8db74c6c01d29bb9e5836565"));
  const totalAttackerGain = attackerGain.reduce((acc, t) => acc + t.value, 0n);
  checks.push({
    description: "Attacker executor accumulates wstkscUSD from pool flow",
    passed: attackerGain.length > 0 && totalAttackerGain > 0n,
    details: attackerGain.length > 0 ? `netGain=${formatAmount(totalAttackerGain, wstInfo.decimals)}` : "no incoming transfers",
  });

  return checks;
}

async function main(): Promise<void> {
  const txHash = process.env.TENDERLY_TX_HASH ?? DEFAULT_TX_HASH;
  const network = process.env.TENDERLY_NETWORK ?? DEFAULT_NETWORK;
  const cacheFile = process.env.TENDERLY_TRACE_FILE ?? path.join(TRACE_DIR, `raw-tenderly-trace-${network}-${txHash.slice(2, 10)}.json`);

  const trace = await ensureTrace(txHash, network, cacheFile);
  const transfers = extractTenderlyTransferEvents(trace);

  const tokenSummaries: Record<string, TokenSummary> = {};
  (Object.keys(TOKEN_INFO) as (keyof typeof TOKEN_INFO)[]).forEach((key) => {
    tokenSummaries[key] = summariseToken(transfers, key);
  });

  const swapCall = findCall(
    trace.trace,
    (call) =>
      normalise(call.to) === normalise("0x9ee939ddc8eaaac72d3cae793b12a09d92624e4a") &&
      (call.functionName?.toLowerCase().includes("swapliquidity") ?? false),
  );

  const flashLoanCall = findCall(trace.trace, (call) => call.functionName?.toLowerCase().includes("flashloan") ?? false);

  const report: AnalysisReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      txHash,
      network,
      traceSource: cacheFile,
    },
    stepChecks: buildStepChecks(transfers),
    tokenSummaries,
    callInfo: {
      swapLiquidity: swapCall
        ? {
            from: labelAddress(swapCall.from),
            to: labelAddress(swapCall.to),
            functionName: swapCall.functionName,
            args: extractArgs(swapCall),
          }
        : undefined,
      flashLoan: flashLoanCall
        ? {
            from: labelAddress(flashLoanCall.from),
            to: labelAddress(flashLoanCall.to),
            functionName: flashLoanCall.functionName,
            args: extractArgs(flashLoanCall),
          }
        : undefined,
    },
  };

  await fs.mkdir(TRACE_DIR, { recursive: true });
  const outputPath = path.join(TRACE_DIR, "sonic-attack-summary.json");
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

  console.log(`Generated summary at ${outputPath}`);
  console.log("\nStep Checks:");
  for (const check of report.stepChecks) {
    const status = check.passed ? "[PASS]" : "[FAIL]";
    console.log(`${status} ${check.description}${check.details ? ` (${check.details})` : ""}`);
  }

  console.log("\nKey Calls:");
  if (report.callInfo.swapLiquidity) {
    console.log("- swapLiquidity", report.callInfo.swapLiquidity);
  } else {
    console.log("- swapLiquidity call not found in trace");
  }
  if (report.callInfo.flashLoan) {
    console.log("- flashLoan", report.callInfo.flashLoan);
  } else {
    console.log("- flashLoan call not found in trace");
  }

  console.log("\nToken Summaries (net balances):");
  for (const [token, summary] of Object.entries(report.tokenSummaries)) {
    console.log(`- ${token}:`);
    for (const [addr, amount] of Object.entries(summary.netBalances)) {
      console.log(`    ${addr}: ${amount}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
