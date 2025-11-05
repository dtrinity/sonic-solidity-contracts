import { readFileSync, writeFileSync } from "fs";
import path from "path";

interface ReportAllowance {
  owner: string;
  onChainAllowance: string;
  formattedAllowance: string;
  lastApprovalEvent?: {
    rawValue: string;
    formattedValue: string;
    blockNumber: number;
    logIndex: number;
    transactionHash: string;
    timeStamp?: number;
  };
}

interface ReportEntry {
  token: string;
  symbol?: string;
  decimals: number;
  spender: string;
  allowances: ReportAllowance[];
}

interface CliOptions {
  reportPath: string;
  outputPath?: string;
  includeHeaders: boolean;
}

function main(): void {
  try {
    const options = parseCli(process.argv.slice(2));
    const report = loadReport(options.reportPath);
    const rows = extractRows(report);
    const output = formatRows(rows, options.includeHeaders);

    if (options.outputPath) {
      writeFileSync(options.outputPath, output, "utf8");
      console.log(`Wrote formatted allowances to ${options.outputPath}`);
    } else {
      console.log(output);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

function parseCli(argv: string[]): CliOptions {
  const args = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, rawValue] = arg.includes("=") ? arg.slice(2).split("=", 2) : [arg.slice(2), undefined];
    const key = rawKey.trim();

    if (rawValue !== undefined) {
      args.set(key, rawValue.trim());
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next.trim());
      i += 1;
      continue;
    }

    args.set(key, "true");
  }

  const reportPath = args.get("report");
  if (!reportPath) {
    throw new Error("Missing required argument --report <path-to-report.json>");
  }

  const outputPath = args.get("out");
  const includeHeaders = !parseBoolean(args.get("no-headers"));

  return {
    reportPath: path.resolve(process.cwd(), reportPath),
    outputPath: outputPath ? path.resolve(process.cwd(), outputPath) : undefined,
    includeHeaders,
  };
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function loadReport(filePath: string): ReportEntry[] {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Report root must be an array");
  }

  return parsed.map((entry, index) => {
    const token = expectString(entry.token, `entry[${index}].token`);
    const symbol = typeof entry.symbol === "string" ? entry.symbol : undefined;
    const decimals = Number(entry.decimals);
    const spender = expectString(entry.spender, `entry[${index}].spender`);

    if (!Number.isInteger(decimals) || decimals < 0) {
      throw new Error(`Invalid decimals for ${token}: ${entry.decimals}`);
    }

    if (!Array.isArray(entry.allowances)) {
      throw new Error(`entry[${index}].allowances must be an array`);
    }

    const allowances = entry.allowances.map((allowance: ReportAllowance, allowanceIndex: number) => {
      const owner = expectString(allowance.owner, `entry[${index}].allowances[${allowanceIndex}].owner`);
      const formattedAllowance = expectString(
        allowance.formattedAllowance,
        `entry[${index}].allowances[${allowanceIndex}].formattedAllowance`,
      );
      const onChainAllowance = expectString(
        allowance.onChainAllowance,
        `entry[${index}].allowances[${allowanceIndex}].onChainAllowance`,
      );

      return {
        owner,
        formattedAllowance,
        onChainAllowance,
        lastApprovalEvent: allowance.lastApprovalEvent,
      };
    });

    return {
      token,
      symbol,
      decimals,
      spender,
      allowances,
    };
  });
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty string for ${context}`);
  }
  return value;
}

interface Row {
  owner: string;
  spender: string;
  token: string;
  symbol?: string;
  formattedAllowance: string;
}

function extractRows(entries: ReportEntry[]): Row[] {
  const rows: Row[] = [];

  for (const entry of entries) {
    for (const allowance of entry.allowances) {
      rows.push({
        owner: allowance.owner,
        spender: entry.spender,
        token: entry.token,
        symbol: entry.symbol,
        formattedAllowance: allowance.formattedAllowance,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.symbol && b.symbol) {
      const symbolCompare = a.symbol.localeCompare(b.symbol);
      if (symbolCompare !== 0) {
        return symbolCompare;
      }
    } else if (a.symbol) {
      return -1;
    } else if (b.symbol) {
      return 1;
    }

    const spenderCompare = a.spender.localeCompare(b.spender);
    if (spenderCompare !== 0) {
      return spenderCompare;
    }

    return a.owner.localeCompare(b.owner);
  });

  return rows;
}

function formatRows(rows: Row[], includeHeaders: boolean): string {
  if (rows.length === 0) {
    return "No positive allowances found.";
  }

  const header = includeHeaders ? ["Owner", "Spender", "Token", "FormattedAllowance"] : [];
  const lines: string[] = [];

  if (header.length > 0) {
    lines.push(header.join(","));
  }

  for (const row of rows) {
    const label = row.symbol ? `${row.symbol} (${row.token})` : row.token;
    lines.push([row.owner, row.spender, label, row.formattedAllowance].join(","));
  }

  return lines.join("\n");
}

main();
