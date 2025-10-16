# Roles Script Refactor Plan

## Goals
- Improve scanning performance by batching RPC reads more aggressively.
- Split responsibilities into dedicated scripts with narrow, low-risk scopes.
- Remove deployer-led role renounce flows; revocations happen via Safe transactions only.
- Provide clear operator feedback (progress logging, explicit manifest opt-outs, summaries).

---

## Immediate Next Steps
- Baseline the current `roles:scan` experience against the Katana deployments to confirm pain points (RPC volume, slow contracts, missing progress logging).
- Annotate this document with findings and translate them into acceptance criteria for the multicall refactor.
- Lock in script CLI surfaces (flags/options) before coding so downstream projects can prepare integrations.

---

## 1. Shared Enhancements

### 1.1 Multicall Infrastructure
- Extend the multicall helper to support cross-contract batching (e.g., chunked `aggregate3` requests grouped by ABI/function signature).
- Add utilities that decode responses with context (contract name/function) and log partial failures gracefully before falling back to one-off calls.

### 1.2 Scan Data Sources
- Build a contract discovery queue, grouping identical view calls across contracts:
  - Batch constant role hash lookups (e.g., `DEFAULT_ADMIN_ROLE`, `<X>_ROLE`) for all AccessControl contracts.
  - Batch `hasRole` checks per holder (deployer vs governance) across contracts.
  - Maintain a fallback path when Multicall3 is unavailable.
- Add progress logging (e.g., `Scanning contract X/Y`) and an RPC savings summary once complete.

---

## 2. Script Breakdown

### 2.1 `scan-roles.ts`
- Keep current reporting while using the new batching strategy.
- Print per-contract progress and highlight manifest opt-outs when encountered.
- Emit a final statistics block (contracts scanned, roles detected, multicall hit rate).

### 2.2 `grant-default-admin.ts` (new “grant” script)
- Read manifest defaults/overrides but focus solely on granting `DEFAULT_ADMIN_ROLE` to the governance multisig.
- Behavior:
  - Ensure the deployer signer is performing direct calls (no Safe integration).
  - Skip removals entirely.
  - Support dry-run planning with explicit logging (`Granting`, `Already granted`, `Skipped (opt-out)`).
  - Confirm manifest opt-outs by name whenever they suppress a grant.

### 2.3 `revoke-roles.ts` (revamp existing script)
- Purpose: build Safe batch transactions that revoke **all** AccessControl roles held by the deployer (including `DEFAULT_ADMIN_ROLE`).
- Requirements:
  1. Require a Safe configuration; no direct execution path.
  2. For each contract, queue `revokeRole` calls for every deployer-held role, unless opted out in the manifest (print these skips explicitly).
  3. Use batched scan data to seed the revocation list; no local cache between runs (re-scan each invocation).
  4. Provide JSON and console summaries, with counts for revocations queued vs skipped due to opt-outs or missing Safe config.

### 2.4 `transfer-ownership.ts` (simplified transfer script)
- Scope: only `Ownable.transferOwnership` from deployer to governance multisig.
- Safeguards:
  - Verify current owner matches the deployer signer before attempting the transfer.
  - Abort if governance already owns the contract or if manifest requires an opt-out (log explicitly).
  - Provide detailed prompts per contract (unless `--yes` flag) and track progress (`Transferring X/Y`).
  - Print a concise summary (executed/skipped/failures).

---

## 3. Manifest & Documentation

### 3.1 Schema Adjustments
- Remove `roles.renounce` and related override structures.
- Retain opt-out capabilities via existing override flags; ensure scripts mention them when they suppress actions.
- Optionally add a manifest flag (e.g., `revocations.includeNonAdmin`) if future flexibility is required—default to `false` (current request: revoke deployer-held roles only).

### 3.2 Docs & CLI Help
- Update README with the four-script workflow (`scan` → `grant` → `revoke` (Safe) → `transfer`).
- Document new CLI flags and expected prompts.
- Include safety notes emphasizing two-phase commit for AccessControl vs direct ownership transfer.

---

## 4. Implementation Steps

1. ✅ **Multicall & batching refactor**: extend helper, update scan logic, add progress logging/statistics.
2. ✅ **Manifest cleanup**: remove renounce policy fields, update types/validation, adjust planner output.
3. ✅ **Grant script**: create `grant-default-admin.ts`, wire into planner machinery with direct execution only.
4. ✅ **Revoke script**: overhaul to generate Safe revocation batches for all deployer-held roles, honoring opt-outs, with explicit logging.
5. ✅ **Transfer script**: strip role handling logic, reinforce ownership safeguards and progress reporting.
6. **Documentation & verification**:
   - Update README/examples/CLI help.
   - Run `scan` against sample deployments.
   - Dry-run `grant`, `revoke`, `transfer` to validate logging and Safe batch output.
   - Ensure Safe batch generation tested in a development environment.
7. **Dogfooding & acceptance**:
   - Execute `roles:scan` end-to-end on the Katana repo and record before/after metrics.
   - Share the diff in operator experience (progress logs, RPC calls, runtime) with stakeholders prior to release.

---

## Open Questions / Confirmed Decisions
- ✅ Revocation targets only roles held by the deployer.
- ✅ Manifest opt-outs stay; each script must log when an opt-out suppresses an action.
- ✅ No inter-script cache; each run performs a fresh scan with multicall batching.

---

## Dogfooding Log (Katana Mainnet scan – 2025-02-15)
- Command: `npx ts-node .shared/scripts/roles/scan-roles.ts --network katana_mainnet --manifest manifests/katana-mainnet-roles.json --deployer 0x0f5e3D9AEe7Ab5fDa909Af1ef147D98a7f4B3022 --governance 0xE83c188a7BE46B90715C757A06cF917175f30262`
- Runtime: ~29s via public RPC; ~400 log lines emitted without progress indicators.
- Pain points observed:
  - No batching: one call per `hasRole`, resulting in repeated RPC churn across ~50 contracts.
  - Logging is noisy and inconsistent (`Checking roles...` banners mixed with summary output).
  - Missing progress counters make it unclear how long the run will take or how far along it is.
  - Drift/manifests summary at the end is useful, but lack of aggregated statistics (RPC counts, failures, cache hits) hides performance characteristics.
  - Startup prints missing mnemonic warnings even though scanning is read-only (should downgrade/skip when only reading).
- Acceptance criteria updates:
  - New scan must show `Scanning X/Y` progress with elapsed time.
  - Provide a final block containing contract count, unique role hashes fetched, and multicall savings (fallback counts).
  - Compact the per-contract output (group by contract with deployer/governance role summaries) or add `--verbose` flag.
  - Filter or reclassify non-blocking env warnings when running read-only tasks.
- Post-refactor validation: `npx ts-node scripts/roles/scan-roles.ts --network katana_mainnet --manifest ../katana-solidity-contracts/manifests/katana-mainnet-roles.json --deployer 0x0f5e3D9AEe7Ab5fDa909Af1ef147D98a7f4B3022 --governance 0xE83c188a7BE46B90715C757A06cF917175f30262 --deployments-dir ../katana-solidity-contracts/deployments/katana_mainnet --hardhat-config ../katana-solidity-contracts/hardhat.config.ts`
  - Runtime dropped to ~6s (multicall supported; 5 aggregate batches covering 204 calls, zero fallbacks).
  - Stage logging now outputs three progress markers (role hashes, hasRole checks, ownership), replacing 400+ lines with 60 lines.
  - Summary block reports direct-call counts and multicall stats; exposure sections list only actionable items.
  - Remaining gaps: environment warns about missing mnemonics; consider suppressing for read-only scans in future polish.
- Script dry-runs (Katana Mainnet, 2025-02-15):
  - `npx ts-node .shared/scripts/roles/grant-default-admin.ts --network katana_mainnet --manifest manifests/katana-mainnet-roles.json --dry-run`
    - Planned 20 grants (auto), 4 already satisfied, 2 blocked (implementations without deployer admin).
  - `npx ts-node .shared/scripts/roles/revoke-roles.ts --network katana_mainnet --manifest manifests/katana-mainnet-roles.json --dry-run`
    - Generated Safe batch preview with 48 `revokeRole` operations across 22 contracts, zero opt-outs.
  - `npx ts-node .shared/scripts/roles/transfer-ownership.ts --network katana_mainnet --manifest manifests/katana-mainnet-roles.json --dry-run`
    - Single Ownable transfer (DefaultProxyAdmin) flagged with irreversible transfer warning; no opt-outs.
