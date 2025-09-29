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

## Immediate Gaps (updated)
- **Event parity:** enrich `MaliciousOdosRouterV2`/`AttackExecutor` to emit Sonic-style markers (`CollateralPulled`, `FlashMintStart/Settled`, per-leg `AttackerBurst`) so the Tenderly comparator can line up logs instead of relying on aggregate balances.
- **Pool realism:** `StatefulMockPool.flashLoan` now covers the single-asset happy path and mints missing liquidity during the withdraw hook. Still need multi-asset guards, explicit premium accounting, and burn helper events if later tests demand them.
- **Dust fidelity:** the harness currently routes the Odos output as `dUSD` with `minOut = 0` to sidestep the adapter’s same-asset underflow check. Scope a follow-up that simulates the real `wstkscUSD` micro-credit once we have a router shim that can keep the adapter balance monotonic during the swap.
- **Downstream legs:** we still mock the wrapper hops implicitly. Decide whether adding lightweight `frxUSD/scUSD/USDC` emitters adds enough value for the RCA or if balance sheets (from the analyzer) are sufficient.



## Harness Components (WIP)
- `contracts/testing/dlend/StatefulMockPool.sol` now mints shortfall liquidity during withdraw and enforces single-asset flash loans. **TODO:** surface premium maths + burn helper events, and consider multi-asset array handling if future coverage needs it.
- `contracts/testing/dlend/MockAToken.sol` still provides pool-controlled mint/burn with stubbed `permit`. **TODO:** add helper getters or fixtures for reserve-manager burns if we start asserting on them explicitly.
- `contracts/testing/odos/MaliciousOdosRouterV2.sol` drains collateral and triggers the executor callback. **TODO:** instrument Sonic-sized leg events so tests can assert on routing phases rather than raw balance diffs.
- `contracts/testing/odos/AttackExecutor.sol` now owns the 27,000 dUSD flash mint, staging vault choreography, withdraw-hook repayments, and attacker bursts. **TODO:** document the `newCollateralAsset = dUSD` deviation and explore a follow-up path that returns `wstkscUSD` dust without tripping the Odos underflow.



## Verification
- `npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts`
  - Case 1 (`withFlashLoan = false`): baseline collateral drain without flash mint; attacker keeps the entire `26,243.751965 wstkscUSD` while the adapter redeposits zero-outcome collateral.
  - Case 2 (`withFlashLoan = true`): exercises the dUSD flash mint, withdraw-hook repayment, and attacker profit bursts (~`35,108.1668 wstkscUSD`). Assertions currently target balance deltas; once we emit richer events we can tighten them to log sequencing.

## Tenderly Tooling
- `npx hardhat run scripts/tenderly/compare-odos-attack-events.ts`
  - Requires `TENDERLY_ACCESS_KEY` (see `Tenderly.md`), optional overrides for `TENDERLY_TX_HASH`, `TENDERLY_NETWORK`, `TENDERLY_PROJECT_SLUG`, and `TENDERLY_NODE_URL` (defaults target the Sonic exploit and slug `project`).
  - Behaviour: pulls the production trace, replays the local PoC, and writes `reports/tenderly/attack-vs-repro-transfers.json` plus console deltas. Cached raw traces live under `reports/tenderly/raw-tenderly-trace-<network>-<tx>.json`; set `TENDERLY_FORCE_REFRESH=true` to bust cache.
  - Known divergence: the local repro currently returns `0` new collateral and expresses the Odos output as dUSD to avoid the adapter’s same-asset underflow. Expect the comparison to flag the missing `1 µ wstkscUSD` dust until we model that shim.
- `npx hardhat run scripts/tenderly/analyze-sonic-attack.ts`
  - Produces `reports/tenderly/sonic-attack-summary.json` with step checks for dUSD flash mint/repay, victim/reserve burns, dust return, and attacker net gain. Reads the same cached trace files.
- Treat step-check failures as repro regressions; document intentional deviations in this ticket before merging further changes.

### Comparison Checklist (Tenderly vs. Repro)
When rerunning the Tenderly comparison scripts, confirm:
- `actual.transfers` captures the ~26.24k `wstkscUSD` collateral drain (victim + reserve-manager burns) and lists the adapter receiving the `1` micro `wstkscUSD` dust. The local repro currently skips that last credit—track it as an intentional delta until we model the monotonic-swap shim.
- dUSD flow: single mint of `27,000` to the attacker executor, staging vault/recycler net changes (`+28,577.6000008888`, `-28,627.6000008888`), and a matching `27,000` repay. Local harness should mirror those balances; update constants if the analyzer flags drift.
- Attacker profit: console summary should read roughly `35,108.1668 wstkscUSD`. Tests assert on these magnitudes using wei-level equality.
- Event coverage: once router/executor emit structured events, ensure their order matches the Sonic trace so reviewers can diff logs rather than raw balances.
- Document any remaining discrepancies (helper addresses, missing wrappers, premiums) in this ticket and promote them to TODOs before we hand over to the mitigation workstream.

### Tenderly Reality Check (Sonic txn `0xa6ae…1940`)
- **Token mapping:** Tenderly reports `dUSD` (18 decimals, `0x53a6…`) for the flash mint and `wstkscUSD` (6 decimals, `0x9fb7…`) as the collateral. Helper contracts (`0x1045…` burn helper, `0x8805…`, `0xdb81…`, `0xb1c1…`, micro distributors) shuttle dUSD, while Odos legs (`0xba13…`, `0xba12…`) handle the collateral conversions.
- **Collateral drain:** The trace shows `aWSTKSCUSD` transfers from the victim and reserve manager to the zero address (`21,440.463367` + `7,132.235951`), after which `wstkscUSD` flows into the attacker executor in two large bursts (`26,230.630089` and `8,877.536706`). Our harness should emit equivalent burn + transfer events so the Tenderly comparator aligns.
- **dUSD flow:** Single flash mint of `27,000 dUSD` from zero address → attacker executor, recycled through staging contracts (net `+28,577.6000008888` / `-28,627.6000008888`), and repaid (`27,000`) at the end. The adapter itself only receives `1` micro unit of `wstkscUSD`—no dUSD settles with the victim.
- **dUSD flow:** Single flash mint of `27,000 dUSD` from zero address → attacker executor, recycled through staging contracts (net `+28,577.6000008888` / `-28,627.6000008888`), and repaid (`27,000`) at the end. The adapter itself only receives `1` micro unit of `wstkscUSD`—no dUSD settles with the victim. (Our harness presently short-circuits this to `minOut = 0` while we look for a safe way to return same-asset dust.)
- **Downstream conversions:** After collateral reaches the attacker executor, it passes through simulated frxUSD/scUSD/USDC/staking wrappers before landing with the attacker EOA. We don’t need exact token economics, but we should emit events that document these legs for the RCA.
- **Reality vs. numbers:** Sonic pricing will diverge; assert on structure (burn → flash mint → dust return → attacker net gain) rather than exact balances, except for the key constants listed above.
- **Next steps:**
  1. Extend `MaliciousOdosRouterV2` (or helper) to emit events for burn helper receipt and attacker bursts so assertions can key off them.
  2. Introduce a `FlashMintedDUSD` helper that mints exactly 27,000 dUSD, logs the mint/repay pair, and feeds the staging-vault accounting used in the analyzer script.
  3. Align PoC assertions with 18-decimal dUSD + 6-decimal wstkscUSD handling; ensure dust comparisons work in wei/micro units.
  4. Re-run Tenderly analyzers after each major harness change and stash the artefacts under `reports/tenderly/` for auditability.

## Work Plan
1. **Instrument the harness**
   - Add router/executor events that mirror the Sonic trace (collateral pulls, flash-mint staging, attacker bursts) and extend the tests to assert on ordering + payloads.
   - Emit reserve burn events or helper breadcrumbs from `StatefulMockPool` if we decide to diff them in the Tenderly comparator.

2. **Tackle dust parity**
   - Prototype a shim (router pre-credit or two-step swap) that lets the adapter see a monotonic `wstkscUSD` balance so we can reintroduce the `1 µ` dust without triggering the underflow guard.
   - Once stable, flip the fixture constants (`newCollateralAsset = wstkscUSD`, `minOut = 1`) and update docs/tests accordingly.

3. **Broaden assertions**
   - Layer structured expectations for dUSD staging helpers, withdraw-hook burns, and attacker net gain directly in the test suite.
   - Backfill helper utilities (e.g., balance diff helper) so future agents can add more cases without rewriting scaffolding.

4. **Keep Tenderly artefacts fresh**
   - Re-run `analyze-sonic-attack.ts` and `compare-odos-attack-events.ts` after each major harness tweak; stash the regenerated JSON in `reports/tenderly/` and annotate intentional deltas here.
   - Document the remaining discrepancies (notably the dust shim) so the RCA team understands the model gap until it is resolved.

5. **Documentation hand-off**
   - Update `ATTACK_STEPS.md`/this ticket once the event instrumentation and dust shim land, highlighting which parts of the Sonic flow are now faithfully reproduced.
   - Capture any regression expectations for the eventual fix (e.g., tests should fail once the adapter requires `msg.sender == user`).

## Validation Criteria
- Test consistently reproduces the collateral drain without non-deterministic dependencies (no chain forking, no external RPC calls).
- Balances before/after exactly match the attack narrative (collateral gone, dust collateral supplied, attacker enriched).
- Repro fails (or throws) once we introduce the planned mitigation (e.g., enforcing caller == user, adding oracle check). This will be used later but should be anticipated now.

## Follow-Ups
- Once the router/executor emit Sonic-style events, pull the exact signatures/order from tx `0xa6ae...1940` so we can harden the repro assertions against them.
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
