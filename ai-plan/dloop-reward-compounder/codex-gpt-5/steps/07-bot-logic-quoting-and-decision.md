Goal: Implement quoting and decision logic using on-chain quote helper and core parameters.

Entrypoint
- `src/runner.ts` orchestrates the cycle; accepts `--network`.

Core Flow
1) Load per-network config from `config/networks/<network>.ts` with hardcoded addresses: CORE, rewardQuoteHelper, dUSD, collateral token, odos router, flash lender, chain RPC.
2) Read `exchangeThreshold()` and `maxDeposit()` via CORE; skip if `maxDeposit == 0`.
3) Query reward quote via RewardQuoteHelper (net rewards for dUSD).
4) Estimate costs: flash fee, swap expected input for exact‑out of `previewMint(S)` (use mocked Odos API in tests; in prod, use real aggregator client).
5) Decision: proceed if `K + netZ >= X + fee + safetyBuffer` (conservative), otherwise skip.

Implementation Details
- Use ethers v6, `JsonRpcProvider`, signer from private key in env (not for addresses).
- Encapsulate providers, contracts, and config in `src/lib` helpers.

Outputs
- Structured logs for each step.
- Return non-zero exit code on hard failures.

Acceptance
- Dry-run mode prints computed threshold, previewMint, estimated flash amount and decision.
- Unit tests cover decision function with varying inputs.

