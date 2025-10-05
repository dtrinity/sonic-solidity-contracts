import axios from "axios";
import { Interface, LogDescription } from "ethers";

const ERC20_TRANSFER_ABI = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const transferIface = new Interface(ERC20_TRANSFER_ABI);

export interface TenderlyLogInput {
  readonly name: string;
  readonly value: any;
}

export interface TenderlyLog {
  readonly address?: string;
  readonly name?: string;
  readonly inputs?: TenderlyLogInput[];
  readonly raw?: {
    readonly data: string;
    readonly topics: string[];
  };
  readonly topics?: string[];
  readonly data?: string;
}

export interface TenderlyTraceResult {
  readonly logs?: TenderlyLog[];
  readonly trace?: TenderlyCall[];
}

export interface TenderlyCall {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly functionName?: string;
  readonly inputs?: { readonly name: string; readonly value: any }[];
  readonly children?: TenderlyCall[];
}

export interface TenderlyTransferEvent {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  readonly decodedVia: "tenderly" | "manual";
}

export interface TraceTransactionParams {
  readonly txHash: string;
  readonly network: string;
  readonly accessKey: string;
  readonly projectSlug?: string;
}

/**
 * Builds the Tenderly RPC URL for the specified network
 * @param network - The network identifier for Tenderly
 * @param customBaseUrl - Optional custom base URL to override the default
 * @returns The complete Tenderly RPC URL
 */
export function buildTenderlyRpcUrl(network: string, customBaseUrl?: string): string {
  if (customBaseUrl && customBaseUrl.length > 0) {
    return customBaseUrl;
  }

  if (!network) {
    throw new Error("Tenderly network must be provided");
  }
  return `https://${network}.gateway.tenderly.co`;
}

/**
 * Traces a transaction using Tenderly's tracing API
 * @param root0 - The transaction trace parameters
 * @param root0.txHash - The transaction hash to trace
 * @param root0.network - The network where the transaction occurred
 * @param root0.accessKey - Tenderly API access key for authentication
 * @param root0.projectSlug - Optional Tenderly project slug
 * @returns Promise resolving to the Tenderly trace result
 */
export async function traceTransaction({ txHash, network, accessKey, projectSlug }: TraceTransactionParams): Promise<TenderlyTraceResult> {
  if (!txHash) {
    throw new Error("Transaction hash is required");
  }

  if (!accessKey) {
    throw new Error("Tenderly access key is required");
  }

  const rpcUrl = buildTenderlyRpcUrl(network, process.env.TENDERLY_NODE_URL);
  const payload = {
    id: 1,
    jsonrpc: "2.0",
    method: "tenderly_traceTransaction",
    params: [txHash],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Access-Key": accessKey,
  };

  if (projectSlug) {
    headers["X-Project"] = projectSlug;
  }

  const { data } = await axios.post(rpcUrl, payload, {
    headers,
  });

  if (data.error) {
    throw new Error(`Tenderly RPC error: ${data.error.message ?? JSON.stringify(data.error)}`);
  }

  return data.result as TenderlyTraceResult;
}

/**
 * Extracts Transfer events from a Tenderly trace result
 * @param traceResult - The Tenderly trace result containing logs
 * @returns Array of parsed transfer events
 */
export function extractTenderlyTransferEvents(traceResult: TenderlyTraceResult): TenderlyTransferEvent[] {
  const transfers: TenderlyTransferEvent[] = [];
  const logs = traceResult.logs ?? [];

  for (const log of logs) {
    if (log.name === "Transfer" && log.inputs) {
      const tokenAddress = log.address ?? log.raw?.address ?? "unknown";
      const from = log.inputs.find((inp) => inp.name === "from")?.value;
      const to = log.inputs.find((inp) => inp.name === "to")?.value;
      const rawValue = log.inputs.find((inp) => inp.name === "value" || inp.name === "wad")?.value;

      if (from && to && rawValue !== undefined) {
        transfers.push({
          token: tokenAddress,
          from,
          to,
          value: BigInt(rawValue.toString()),
          decodedVia: "tenderly",
        });
        continue;
      }
    }

    const topics = log.topics ?? log.raw?.topics ?? [];

    if (topics.length > 0 && topics[0].toLowerCase() === TRANSFER_TOPIC) {
      const tokenAddress = log.address ?? log.raw?.address ?? "unknown";
      const data = log.data ?? log.raw?.data ?? "0x";

      try {
        const parsed: LogDescription = transferIface.parseLog({
          topics,
          data,
        });
        transfers.push({
          token: tokenAddress,
          from: (parsed.args[0] as string) ?? "unknown",
          to: (parsed.args[1] as string) ?? "unknown",
          value: BigInt(parsed.args[2].toString()),
          decodedVia: "manual",
        });
      } catch (err) {
        console.warn("Failed to parse Transfer log", err);
      }
    }
  }

  return transfers;
}

/**
 * Summarizes a call trace into a human-readable string format
 * @param calls - Array of Tenderly call objects to summarize
 * @param indent - Indentation level for nested calls (default: 0)
 * @returns Formatted string representation of the call trace
 */
export function summarizeCallTrace(calls: TenderlyCall[], indent = 0): string {
  let output = "";
  const prefix = "  ".repeat(indent);

  for (const call of calls) {
    const amountWei = call.value ? BigInt(call.value).toString() : "0";
    output += `${prefix}${call.from} -> ${call.to} | ${call.functionName ?? "fallback"} | value: ${amountWei} wei\n`;

    if (call.inputs && call.inputs.length > 0) {
      const args = call.inputs.map((inp) => `${inp.name}=${inp.value}`).join(", ");
      output += `${prefix}  args: ${args}\n`;
    }

    if (call.children && call.children.length > 0) {
      output += summarizeCallTrace(call.children, indent + 1);
    }
  }

  return output;
}
