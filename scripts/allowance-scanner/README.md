# Allowance Scanner Scripts

Utilities for enumerating ERC‑20 allowances granted to dTRINITY swap adapters and related contracts across supported networks. The workflow consists of two steps:

1. `index.ts` — queries Etherscan for historical `Approval` logs, verifies live allowances via RPC (with multicall batching), and writes a structured JSON report.
2. `format-report.ts` — flattens a JSON report into a CSV-style summary (`Owner,Spender,Token,FormattedAllowance`) for rapid triage.

## Prerequisites

- Node.js 20+ (repo uses `ts-node --transpile-only`).
- Yarn v4 (already configured in the repository).
- Etherscan API key with V2 access.
- RPC endpoint for the target chain (Sonic or Fraxtal).

Environment variables (optional convenience):

```bash
export ETHERSCAN_API_KEY=H4YNPZMWN87MQUQSX4EVYE62G62A3EEVES
export RPC_URL=https://rpc.soniclabs.com
```

Command-line flags always take precedence over environment variables.

## Running the Scanner

```bash
yarn ts-node --transpile-only scripts/allowance-scanner/index.ts \
  --tokens-file scripts/allowance-scanner/sonic-assets.txt \
  --spenders-file scripts/allowance-scanner/sonic-spenders.txt \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --rpc-url https://rpc.soniclabs.com \
  --chain-id 146 \
  --output json \
  > reports/allowance-scanner/sonic-scan-$(date +%Y%m%d-%H%M%S).json
```

Key options:

- `--tokens` / `--tokens-file` — addresses to scan (inline comma-separated list or `#`-commentable file).
- `--spenders` / `--spenders-file` — spender contract addresses.
- `--chain-id` — numeric chain ID (Sonic `146`, Fraxtal `252`).
- `--from-block`, `--to-block` — optional block range; default is full history with TTL-aware cache refresh for `latest`.
- `--skip-rpc` — skips on-chain verification (useful when seeding cache). Otherwise, provide `--rpc-url` for live allowance checks.
- `--etherscan-delay-ms`, `--etherscan-max-retries`, `--etherscan-retry-backoff-ms` — tune pacing and exponential backoff when Etherscan throttles or drops connections (defaults: `210 ms`, `4`, `750 ms`).
- `--multicall-address`, `--multicall-batch-size` — override multicall config if the default (0xcA11…CA11) is unsupported.
- `--cache-dir`, `--cache-ttl-seconds` — control incremental cache writes. Cache files live under `.cache/allowance-scanner/` keyed by `(chainId, token, spender, fromBlock, pageSize)` and persist after each page of results, allowing safe interruption/resumption.

For Fraxtal:

```bash
yarn ts-node --transpile-only scripts/allowance-scanner/index.ts \
  --tokens-file scripts/allowance-scanner/fraxtal-assets.txt \
  --spenders-file scripts/allowance-scanner/fraxtal-spenders.txt \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --rpc-url https://rpc.frax.com \
  --chain-id 252 \
  --output json \
  > reports/allowance-scanner/fraxtal-scan-$(date +%Y%m%d-%H%M%S).json
```

### Cache Notes

- Cache writes happen incrementally after every non-empty page fetched from Etherscan.
- Delete selected files in `.cache/allowance-scanner/` to force a refetch for specific token/spender pairs.
- Adjust `--cache-ttl-seconds` (default `300`) for how frequently `latest` ranges are refreshed. Set to `0` to always re-query.

## Formatting Reports

```bash
yarn ts-node --transpile-only scripts/allowance-scanner/format-report.ts \
  --report reports/allowance-scanner/sonic-scan-20251105-132813.json \
  --out reports/allowance-scanner/sonic-scan-20251105-132813.csv
```

Options:

- `--report <path>` — input JSON report (required).
- `--out <path>` — optional output file (prints to stdout when omitted).
- `--no-headers` — omit the header row from the CSV output.

CSV columns: `Owner`, `Spender`, `Token` (symbol + address where available), `TokenBalance`, `FormattedAllowance`.

## Generated Artifacts

- JSON reports and CSV summaries are ignored by git via `reports/allowance-scanner/`.
- Cached allowances are stored in `.cache/allowance-scanner/` (`.cache/` is already ignored).

## Troubleshooting

- **Unknown file extension `.ts`** — run via `yarn ts-node --transpile-only ...`.
- **Etherscan rate limits / dropped sockets** — increase `--etherscan-delay-ms`, raise `--etherscan-max-retries`, or widen `--etherscan-retry-backoff-ms`.
- **Multicall failures** — script automatically falls back to per-address RPC calls; adjust `--rpc-concurrency` and `--rpc-delay-ms` if rate-limited.
- **No allowances returned** — confirm address casing, ensure spender is indexed (`topic2`), and verify the token is ERC-20 compliant. Re-run with `--skip-rpc` to inspect raw event values.
