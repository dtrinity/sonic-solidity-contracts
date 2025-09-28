# Ticket: Reproduce Odos Liquidity Swap Adapter Exploit (Sonic)

## Objective
- Build a deterministic, automated repro that mirrors the production attack described in `ATTACK_STEPS.md`.
- Capture state transitions showing the victim’s `aToken` collateral drain, negligible `newCollateralAsset` deposit, and attacker capture of the underlying collateral.
- Provide artefacts that double as regression tests once a fix ships and as evidence for the public post-mortem.

## Background
- The V1 `OdosLiquiditySwapAdapter` trusts caller-supplied `user`, `swapData`, and `minOut`.
- With a lingering `aWSTKSCUSD` approval, an attacker routes the withdrawn collateral into a malicious executor and returns a 1-micro `wstkscUSD` dust credit to satisfy `minOut` before the adapter re-supplies it on behalf of the victim.
- The attacker simultaneously flash-mints **27,000 dUSD**; this float never repays the victim’s debt, it only fuels the staging vault/recycler/splitter helpers needed to mint the staking wrappers that produce the dust output.
- Reference Sonic exploit tx: `0xa6aef05387f5b86b1fd563256fc9223f3c22f74292d66ac796d3f08fd311d940` (for validating behaviour, not necessarily to fork).

## Deliverables
- `MaliciousOdosRouter` mock (or extension of `MockOdosRouterV2`) that transfers input collateral to an attacker-controlled sink and sends configurable dust output back.
- Attacker executor contract that runs the adapter **with `withFlashLoan = true`**, kicks off a harness-level dUSD flash mint, and returns the dust output to the adapter while keeping the stolen collateral.
- Pool + token fixture that supports:
  - Underlying → aToken accounting (supply/withdraw actually moves balances).
  - Victim deposit helper and leftover allowance simulation.
  - Flash-loan plumbing that burns victim/reserve-manager `aTokens`, transfers the underlying to the executor, and enforces repayment bookkeeping/premiums (premiums can stay zero but should be asserted).
- Hardhat tests (TypeScript) under `test/dlend/adapters/odos/v1/` that drive the exploit through the public adapter API for both `withFlashLoan = false` and `true`.
- Structured assertions + emitted event snapshots usable in the post-mortem write-up and referenced in the RCA.

## Clarifications
- Flash-mint behaviour must emit the zero-address mint/repay pair for **27,000 dUSD**. Pre-funding hacks are no longer acceptable; we need deterministic harness support for a flash-mint stub that mirrors the production helper (mint to attacker executor → repay within the same tx).
- Tests will capture the key adapter, pool, router, and attacker events/logs so the execution flow matches the production transaction narrative.
- Permit flows remain stubbed; the repro assumes an existing unlimited `aWSTKSCUSD` approval, mirroring the exploited precondition.
- Use Sonic magnitudes: `collateralAmountToSwap = 26,243.751965 wstkscUSD` (6 decimals) and dust return = `1` (micro unit). Keep all calculations in wei to avoid rounding drift when we validate balances.

## Test Harness Inventory
- `contracts/testing/dlend/StatefulMockPool.sol` (new) tracks underlying balances, mints/burns `MockAToken`, and exposes a single-asset flash loan hook (currently zero premium, single asset only).
- `contracts/testing/dlend/MockAToken.sol` implements ERC20 with pool-owned mint/burn and stubbed `permit`.
- `contracts/testing/odos/MaliciousOdosRouterV2.sol` steals the adapter’s input asset and returns configurable dust to the adapter while emitting `MaliciousSwap`.
- `contracts/testing/odos/AttackExecutor.sol` wraps the adapter call; today it pre-funds dust and does not yet drive the adapter’s flash-loan logic.
- Tenderly alignment scripts live under `scripts/tenderly/` (`compare-odos-attack-events.ts`, `analyze-sonic-attack.ts`) with cached outputs in `reports/tenderly/`.

## Immediate Gaps
- Extend `StatefulMockPool.flashLoan` so the adapter’s `withFlashLoan = true` branch can execute end-to-end (support multiple assets array, premium accounting, and callback sequencing).
- Add a harness-level `FlashMintMock` contract (or extension on `AttackExecutor`) to mint/repay 27,000 dUSD and emit the zero-address transfers.
- Update `AttackExecutor` to route the flash-minted dUSD through the staging helpers (simulated) and to retain the stolen `wstkscUSD` while returning `dust = 1` to the adapter.
- Parameterise fixtures so we can reuse Sonic constants (collateral amount, dust, dUSD float) across flash and non-flash tests.
- Add second test covering `withFlashLoan = true` once the above plumbing lands; capture event snapshots for regression.



## Harness Components (WIP)
- `contracts/testing/dlend/StatefulMockPool.sol` tracks balances and supports single-asset flash loans. **TODO:** add premium bookkeeping, allow the callback to request multiple assets, and emit structured events for victim/reserve burns.
- `contracts/testing/dlend/MockAToken.sol` exposes pool-controlled mint/burn and stubbed `permit`. **TODO:** helper for reserve-manager burn + explicit 18-decimal metadata getters used in tests.
- `contracts/testing/odos/MaliciousOdosRouterV2.sol` siphons collateral and emits `MaliciousSwap`. **TODO:** emit Sonic-sized leg events (`CollateralPulled`, `AttackerBurst`, `DustReturned`).
- `contracts/testing/odos/AttackExecutor.sol` currently pre-funds dust. **TODO:** integrate flash-loan callback handling + dUSD flash mint/recycle so the harness mirrors the Sonic trace.



## Verification
- Current PoC (`withFlashLoan = false`): `npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts` – validates collateral drain + dust repay via stateful harness.
- Upcoming coverage: extend the same test file with a `withFlashLoan = true` case using the upgraded flash-loan + flash-mint mocks; assert on dUSD mint/repay, victim/reserve burns, and attacker net gain.

## Tenderly Tooling
- `npx hardhat run scripts/tenderly/compare-odos-attack-events.ts`
  - Inputs: `TENDERLY_ACCESS_KEY`, optional overrides for `TENDERLY_TX_HASH`, `TENDERLY_NETWORK`, `TENDERLY_PROJECT_SLUG` (defaults: Sonic hash + slug `project`), and `TENDERLY_NODE_URL` (`https://sonic.gateway.tenderly.co/7miGZkS8Apta8ckbhUVLfY`).
  - Behaviour: pulls the production trace, replays the local PoC, and writes `reports/tenderly/attack-vs-repro-transfers.json` plus console summaries highlighting transfer deltas.
  - Shares cached raw trace files under `reports/tenderly/raw-tenderly-trace-<network>-<hashprefix>.json`; set `TENDERLY_FORCE_REFRESH=true` to bust cache if the production tx is reindexed.
- `npx hardhat run scripts/tenderly/analyze-sonic-attack.ts`
  - Produces `reports/tenderly/sonic-attack-summary.json` with step checks for dUSD flash mint/repay, victim/reserve burns, dust return, and attacker net gain.
  - Relies on cached raw trace (`reports/tenderly/raw-tenderly-trace-sonic-<hashprefix>.json`); set `TENDERLY_FORCE_REFRESH=true` to bypass cache.
- Treat step-check failures as repro regressions; update this ticket with any intentional changes before committing.

### Comparison Checklist (Tenderly vs. Repro)
When rerunning the Tenderly comparison scripts, confirm:
- `actual.transfers` captures the ~26.24k `wstkscUSD` collateral drain (burns from victim + reserve manager) and shows the adapter receiving exactly `1` micro unit of `wstkscUSD`.
- dUSD flow in the trace matches our harness: single mint of `27,000` to the attacker executor, staging vault/recycler balances (`+28,577.6000008888`, `-28,627.6000008888`), and a single repay of `27,000` back to the zero address.
- The console summary lists the attacker net gain (~`35,108.1668` `wstkscUSD`) and dust return; align our test assertions with those values (tolerating small deltas).
- Key events/logs (`MaliciousSwap`, `FlashMinted`, `DustRepaid`) appear in the same order as the Tenderly trace so reviewers can diff flows without re-reading call data.
- Any discrepancies are documented here and promoted to TODOs (e.g., missing helper addresses, premium handling, additional token hops).

### Tenderly Reality Check (Sonic txn `0xa6ae…1940`)
- **Token mapping:** Tenderly reports `dUSD` (18 decimals, `0x53a6…`) for the flash mint and `wstkscUSD` (6 decimals, `0x9fb7…`) as the collateral. Helper contracts (`0x1045…` burn helper, `0x8805…`, `0xdb81…`, `0xb1c1…`, micro distributors) shuttle dUSD, while Odos legs (`0xba13…`, `0xba12…`) handle the collateral conversions.
- **Collateral drain:** The trace shows `aWSTKSCUSD` transfers from the victim and reserve manager to the zero address (`21,440.463367` + `7,132.235951`), after which `wstkscUSD` flows into the attacker executor in two large bursts (`26,230.630089` and `8,877.536706`). Our harness should emit equivalent burn + transfer events so the Tenderly comparator aligns.
- **dUSD flow:** Single flash mint of `27,000 dUSD` from zero address → attacker executor, recycled through staging contracts (net `+28,577.6000008888` / `-28,627.6000008888`), and repaid (`27,000`) at the end. The adapter itself only receives `1` micro unit of `wstkscUSD`—no dUSD settles with the victim.
- **Downstream conversions:** After collateral reaches the attacker executor, it passes through simulated frxUSD/scUSD/USDC/staking wrappers before landing with the attacker EOA. We don’t need exact token economics, but we should emit events that document these legs for the RCA.
- **Reality vs. numbers:** Sonic pricing will diverge; assert on structure (burn → flash mint → dust return → attacker net gain) rather than exact balances, except for the key constants listed above.
- **Next steps:**
  1. Extend `MaliciousOdosRouterV2` (or helper) to emit events for burn helper receipt and attacker bursts so assertions can key off them.
  2. Introduce a `FlashMintedDUSD` helper that mints exactly 27,000 dUSD, logs the mint/repay pair, and feeds the staging-vault accounting used in the analyzer script.
  3. Align PoC assertions with 18-decimal dUSD + 6-decimal wstkscUSD handling; ensure dust comparisons work in wei/micro units.
  4. Re-run Tenderly analyzers after each major harness change and stash the artefacts under `reports/tenderly/` for auditability.

## Work Plan
1. **Recon / Fixture Design**
   - Review `BaseOdosSwapAdapter` helpers (`_pullATokenAndWithdraw`, `_sellOnOdos`, `_supply`, flash-loan callbacks) to confirm the adapter expectations for collateral pulls, Odos routing, and dust resupply.
   - Diff Tenderly artefacts (`reports/tenderly/sonic-attack-summary.json`) against the current PoC logs to enumerate missing events/balances.

2. **Exploit Harness Contracts**
   - Extend `StatefulMockPool` to support full flash-loan semantics (multi-asset guards, premium arg, borrower callback) and to emit victim/reserve-manager burn events.
   - Add a `FlashMintMock` (or extend `AttackExecutor`) to mint/repay 27,000 dUSD with zero-address transfers and stage the dUSD through mocked helper contracts for accounting.
   - Enhance `MaliciousOdosRouterV2` to emit structured events for each major leg (`CollateralPulled`, `DustReturned`, `AttackerBurst`) with Sonic-sized amounts so tests can assert on them.

3. **Scenario Assembly**
   - Deploy the real `OdosLiquiditySwapAdapter` pointing at the upgraded mocks and register the Sonic reserve (`wstkscUSD` / `aWSTKSCUSD`).
   - Victim flow: mint `wstkscUSD`, supply via the pool to receive `aWSTKSCUSD`, and leave unlimited approval in place.
   - Configure malicious route to drain `26,243.751965 wstkscUSD`, flash mint 27,000 dUSD, return exactly `1` micro unit of `wstkscUSD` to the adapter, and keep the remainder on the attacker.
   - Exercise both adapter code paths: `withFlashLoan = false` (existing coverage) and `true` (new flash-loan-backed repro).

4. **Assertions & Telemetry**
   - Assert victim and reserve-manager `aWSTKSCUSD` balances burn by the expected amounts and that the adapter deposits `1` micro `wstkscUSD` back for the victim.
   - Verify attacker’s `wstkscUSD` net gain ≈ `35,108.1668` and that all dUSD balances net to zero after mint/repay.
   - Capture emitted events (`MaliciousSwap`, `FlashMinted`, `DustRepaid`, burn helper logs) and write them to fixtures for post-mortem comparisons.

5. **Packaging & Automation**
   - Add the flash-loan reproduction test alongside the existing PoC (`OdosLiquiditySwapAdapter.exploit.test.ts`) and gate it behind a tenderly-fixture snapshot if needed.
   - Document run instructions (`npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts`) and how to refresh Tenderly caches.
   - Track limitations (e.g., simplified downstream wrapper modelling) inside the test file and this ticket.

## Validation Criteria
- Test consistently reproduces the collateral drain without non-deterministic dependencies (no chain forking, no external RPC calls).
- Balances before/after exactly match the attack narrative (collateral gone, dust collateral supplied, attacker enriched).
- Repro fails (or throws) once we introduce the planned mitigation (e.g., enforcing caller == user, adding oracle check). This will be used later but should be anticipated now.

## Follow-Ups
- Pull exact event signatures/order from tx `0xa6ae...1940` to confirm which ones we want to assert in the repro logs.
- Decide where to store the numeric constants (e.g., helper constants vs. inline literals) so the `26,243.751965` `wstkscUSD` collateral and `27,000 dUSD` flash-mint values stay easy to update.
- Scope whether to include a helper script that diffs victim/attacker balances before and after for post-mortem screenshots.

## Dependencies
- Typechain bindings regeneration after adding new mocks.
- Hardhat deployment helpers for mock pool + tokens.
- Potential contract size allowances if the fixture grows (keep mocks minimal).

## Out of Scope (for this ticket)
- Implementing the actual fix/mitigation.
- Publishing the post-mortem (only gathering artefacts).
- Writing integration tests for V2 adapters (unless reused for comparison).
