#!/usr/bin/env ts-node

import { SwapLiquidityDataDecoder, TransactionAnalyzer } from "./decode-liquidity-swap-data";

/**
 * CLI tool for decoding OdosLiquiditySwapAdapterV2 transaction data
 *
 * Usage:
 *   # Decode raw transaction input data (most common)
 *   yarn ts-node scripts/decode-swap-cli.ts 0xabcd...
 *
 *   # Or explicitly specify data mode
 *   yarn ts-node scripts/decode-swap-cli.ts data 0xabcd...
 *
 *   # Decode transaction by hash (requires RPC)
 *   yarn ts-node scripts/decode-swap-cli.ts tx 0x1234... --rpc https://rpc.soniclabs.com
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
Usage:
  # Decode raw transaction input data (most common)
  yarn ts-node scripts/decode-swap-cli.ts 0xabcd...
  
  # Or explicitly specify mode
  yarn ts-node scripts/decode-swap-cli.ts data 0xabcd...
  yarn ts-node scripts/decode-swap-cli.ts tx 0x1234... [--rpc <url>]

Modes:
  tx <txHash>     - Decode transaction by hash (requires RPC)
  data <calldata> - Decode raw calldata
  <calldata>      - Auto-detect: decode raw calldata (default)

Options:
  --rpc <url>     - Custom RPC URL (default: Sonic mainnet)

Examples:
  # Direct calldata (recommended)
  yarn ts-node scripts/decode-swap-cli.ts 0x1234abcd...
  
  # Transaction hash lookup
  yarn ts-node scripts/decode-swap-cli.ts tx 0xd58a50f47ceee493a36d466c9d6747f51ae6ff1e0f9d0964022e51f48ef15b56
        `);
    process.exit(1);
  }

  // Auto-detect mode based on arguments
  let mode: string;
  let data: string;

  if (args[0] === "tx" || args[0] === "data") {
    // Explicit mode specified
    if (args.length < 2) {
      console.error(`Mode '${args[0]}' requires a second argument`);
      process.exit(1);
    }
    mode = args[0];
    data = args[1];
  } else if (args[0].startsWith("0x") && args[0].length > 10) {
    // Auto-detect: looks like calldata (starts with 0x and reasonable length)
    mode = "data";
    data = args[0];
    console.log("Auto-detected mode: data (raw calldata)");
  } else if (args[0].startsWith("0x") && args[0].length === 66) {
    // Auto-detect: looks like transaction hash (64 chars + 0x prefix = 66)
    mode = "tx";
    data = args[0];
    console.log("Auto-detected mode: tx (transaction hash)");
  } else {
    console.error(`Unable to auto-detect mode for input: ${args[0]}`);
    console.error("Please specify mode explicitly or provide valid calldata/tx hash");
    process.exit(1);
  }

  // Parse RPC URL option
  const rpcIndex = args.indexOf("--rpc");
  const rpcUrl = rpcIndex !== -1 && rpcIndex + 1 < args.length ? args[rpcIndex + 1] : "https://rpc.soniclabs.com"; // Default to Sonic mainnet

  try {
    if (mode === "tx") {
      console.log(`Using RPC: ${rpcUrl}`);
      const analyzer = new TransactionAnalyzer(rpcUrl);
      await analyzer.analyzeTransaction(data);
    } else if (mode === "data") {
      const decoder = new SwapLiquidityDataDecoder();
      const decoded = decoder.decodeSwapLiquidity(data);
      console.log("\nDecoded Data:");
      console.log(decoder.formatDecodedData(decoded));
    } else {
      console.error(`Unknown mode: ${mode}`);
      console.error(`Supported modes: tx, data`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
