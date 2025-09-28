# Ticket: Reproduce Odos Liquidity Swap Adapter Exploit

## Objective
- Build a deterministic, automated repro that mirrors the production attack described in `ATTACK_STEPS.md`.
- Capture state transitions showing the victim’s `aToken` collateral drain, negligible `newCollateralAsset` deposit, and attacker capture of the underlying collateral.
- Provide artefacts that double as regression tests once a fix ships and as evidence for the public post-mortem.

## Background
- The V1 `OdosLiquiditySwapAdapter` trusts caller-supplied `user`, `swapData`, and `minOut`.
- With a lingering `aToken` approval, an attacker routes the withdrawn collateral into a malicious executor and returns dust `newCollateralAsset` (potentially flash-minted) to satisfy `minOut` before the adapter re-supplies it on behalf of the victim.
- Reference Sonic exploit tx: `0xa6aef05387f5b86b1fd563256fc9223f3c22f74292d66ac796d3f08fd311d940` (for validating behaviour, not necessarily to fork).

## Deliverables
- `MaliciousOdosRouter` mock (or extension of `MockOdosRouterV2`) that transfers input collateral to an attacker-controlled sink and sends configurable dust output back.
- Minimal attacker executor contract that optionally triggers a fake `dUSD` flash-mint so we can mirror on-chain traces (can be stubbed with pre-funded dust if flash minting proves heavy).
- Pool + token fixture that supports:
  - Underlying → aToken accounting (supply/withdraw actually moves balances).
  - Victim deposit helper and leftover allowance simulation.
  - Hooks to observe balances before/after the exploit.
- Hardhat test (TypeScript) under `test/dlend/adapters/odos/` that drives the exploit through the public adapter API for both `withFlashLoan = false` and (if feasible) `true`.
- Structured assertions + emitted event snapshots usable in the post-mortem write-up.

## Clarifications
- Flash-mint behaviour is currently modelled by pre-funding and repaying a 1-wei `dUSD` balance; once the flash-mint helper lands we’ll emit the same mint/repay `Transfer` pair observed on-chain.
- Tests will capture the key adapter, pool, router, and attacker events/logs so the execution flow matches the production transaction narrative.
- Permit flows will be stubbed; the repro assumes an existing unlimited approval, mirroring the exploited precondition.
- Collateral and dust amounts will reuse the production magnitudes (≈17,509.54233 collateral units → 1 wei `dUSD`); the real Sonic flow uses wrapped/staked tokens, but we’ll keep the WFRAX alias in the harness for readability.

## Test Harness Inventory
- `contracts/testing/odos/MockOdosRouterV2.sol` redirects swap outputs back to the caller and cannot siphon funds to a third party yet.
- `contracts/testing/dlend/MockPoolV2.sol` keeps in-memory reserve metadata but `supply/withdraw` are no-ops; no underlying token accounting occurs.
- `contracts/testing/dlend/MockPoolAddressesProvider.sol` simply forwards the configured pool/oracle addresses and suits our constructor expectations.
- `contracts/testing/token/TestMintableERC20.sol` mints/burns freely but lacks permit support (acceptable because we assume infinite approvals).
- No existing `MockAToken` contract; adapters expect ERC20-compatible aTokens with allowance/transfer semantics.

## Immediate Gaps
- Need a pool mock that mints aTokens on `supply`, burns them on `withdraw`, and actually transfers underlying tokens between users, pool, and attacker sinks.
- Require an aToken implementation (ERC20 + mint/burn for the pool) with stubbed `permit` that we can wire into `DataTypes.ReserveData`.
- Malicious Odos router must forward withdrawn collateral to an attacker address while returning configurable dust to the adapter; may reuse existing mock with extra routing parameters.
- Fixtures/tests currently target V2 adapters only; we will scaffold a new test suite under `test/dlend/adapters/odos/v1/` for the vulnerable adapter.



## Harness Components (WIP)
- `contracts/testing/dlend/StatefulMockPool.sol` tracks underlying balances, mints/burns `MockAToken`, and offers a zero-premium flash loan hook for later extension.
- `contracts/testing/dlend/MockAToken.sol` provides pool-controlled mint/burn, standard ERC20 transfers, and a stubbed `permit` that simply updates allowance and nonce.
- `contracts/testing/odos/MaliciousOdosRouterV2.sol` siphons the adapter's input token to a configured attacker while dribbling dust output back and emitting `MaliciousSwap` for tracing.
- `contracts/testing/odos/AttackExecutor.sol` wraps the adapter call, then repays the router with pre-funded dust inside the same transaction so traces echo the flash-mint + repay pattern.



## Verification
- PoC test: `npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts` validates the collateral drain and dust repay flow via the new harness.

## Tenderly Tooling
- Script: `npx hardhat run scripts/tenderly/compare-odos-attack-events.ts`.
  - Inputs: set `TENDERLY_ACCESS_KEY`; optionally override `TENDERLY_TX_HASH`, `TENDERLY_NETWORK`, `TENDERLY_PROJECT_SLUG` (defaults are the Sonic attack hash, `sonic`, and our project slug `project`), and `TENDERLY_NODE_URL` (currently `https://sonic.gateway.tenderly.co/7miGZkS8Apta8ckbhUVLfY`).
  - Behaviour: pulls `tenderly_traceTransaction` for the production tx and reruns the local PoC to capture ERC-20 transfers + key mock events.
  - Output: JSON artefact at `reports/tenderly/attack-vs-repro-transfers.json` plus console summaries of token flow/net deltas.
- Caching: the script writes the raw trace to `reports/tenderly/raw-tenderly-trace-<network>-<tx>.json` and reuses it to avoid hammering Tenderly; set `TENDERLY_FORCE_REFRESH=true` if you need a fresh fetch.

### Comparison Checklist (post-429 fix)
Run the script again once Tenderly RPC access is live and cross-check the artefact against the goals below:
- `actual.transfers` should show the large collateral drain (≈17.5k units in production) and the 1 wei `dUSD` credit flowing through the same addresses we model in the harness.
- Confirm `actual.callTraceExcerpt` includes the Odos router/executor sandwich that our mocks emit (`MaliciousSwap`, `DustRepaid`). If not, extend mocks/events or fixture naming to mirror production call names.
- Align timestamps + ordering: favourite events to match are `adapter.swapLiquidity`, `pool.withdraw`, router swap, and attacker dust repay. Add expectations in the PoC once we know which logs fire.
- Spot any extra tokens or side-effects in `actual.transfers`; add mocks or additional assertions so the test fails if those ever disappear (prevents regressions in replay realism).
- Record any deltas in this doc (e.g., additional dust tokens, non-zero premiums) and translate them into TODOs for the harness.

### Tenderly Reality Check (Sonic txn `0xa6ae…940`)
- **Token mapping:** Tenderly reports `dUSD` (18 decimals, `0x53a6…`) as the dust token and shows the collateral flowing through `frxusd`, `scusd`, `usdc`, and staking receipts (`ws`, `sts`, `wstkscusd`). Helper contracts at `0x72f1…` and `0x1045…` act as the router legs that burn/mint wrapped collateral.
- **Collateral drain:** Value leaves `0x72f1…` (pool adapter) → attacker router `0xde85…` → `0x000…0000`, then reappears as `frxusd` before cascading into staking wrappers. Our harness still pipes collateral straight to the attacker; add a converter stub (e.g., `BurnedForFrxUsd` event + downstream mint) so the trace captures the burn hop.
- **dUSD flow:** The attacker contract flash-mints ~40,000 dUSD from the zero address and repays it later in the same transaction, while the adapter only touches a 1 wei dust amount. Replace the pre-funded dust with a flash-mint mock that emits matching `Transfer(0x0, attacker)` + repay events.
- **Downstream conversions:** After the router, funds split across `usdc/scusd`, `frxusd`, and staking wrappers before final settlement with the attacker EOA (`0x0a69…`). Matching the exact numbers is unnecessary; we just need the same structural hops for the post-mortem narrative.
- **Reality vs. numbers:** Sonic prices/fees differ from our harness, so assert on flows and events rather than strict token amounts. Close-but-not-identical balances are acceptable once the sequence above is reproduced.
- **Next steps:**
  1. Extend `MaliciousOdosRouterV2` (or an auxiliary attacker contract) to emit the burn/mint events we see on Sonic (collateral → `0x0` burn → wrapped mint) so we can assert on ordering.
  2. Introduce a `FlashMintedDUSD` helper in the PoC that mints ~40,000 dUSD to the router mock, emits the same `Transfer(0x0, attacker)` / repay pair, then returns the adapter’s single-unit dust.
  3. Update the test assertions to stay consistent with 18-decimal dUSD accounting (ensure dust comparisons use wei).
  4. Once the harness reflects the burn + flash-mint, snapshot the relevant `Transfer` events and attach them under `reports/tenderly/` for post-mortem diffs.

## Work Plan
1. **Recon / Fixture Design**
   - Review `BaseOdosSwapAdapter` helpers (`_pullATokenAndWithdraw`, `_sellOnOdos`, `_supply`) to understand the minimal surface we must emulate in mocks.
   - Inventory existing testing utilities (`TestMintableERC20`, `MockPoolV2`, `MockPoolAddressesProvider`) and decide whether to extend or replace them for stateful supply/withdraw flows.

2. **Exploit Harness Contracts**
   - Implement (or extend) a pool mock that (a) mints/burns `aToken` balances on supply/withdraw and (b) actually moves underlying ERC20 balances so that stolen collateral winds up with the attacker.
   - Create `MockAToken` (simple ERC20) tied to the pool mock for `transferFrom` + permit support (permit optional but useful to keep interface parity).
   - Build `MaliciousOdosRouter` capable of:
     - Pulling `amountSpent` from the adapter.
     - Forwarding the withdrawn collateral to a configurable attacker wallet/contract.
     - Returning a caller-configurable `amountReceived` of `newCollateralAsset` (dust) to the adapter.
   - Optional: `AttackerOdosExecutor` stub that can emit events or simulate flash-mint traces for richer telemetry.

3. **Scenario Assembly**
   - Deploy real `OdosLiquiditySwapAdapter` pointing at the mocks and register reserves so constructor pre-approvals succeed.
  - Victim flow: mint a `WFRAX`-like placeholder token (mirrors the Sonic collateral for readability), `supply` into the pool to receive `aWFRAX`, and leave a generous approval for the adapter.
   - Configure router behaviour to drain a configured portion (e.g., 100%) of the victim’s collateral into the attacker while returning `1 wei` `dUSD`.
   - Attack flow: attacker calls `swapLiquidity` with crafted `LiquiditySwapParams` (user=victim, tiny `minOut`, malicious `swapData`). Cover both `withFlashLoan = false` path and (if mocks support it) `true` path for completeness.

4. **Assertions & Telemetry**
   - Assert victim’s `aWFRAX` balance decreases by `collateralAmountToSwap`.
   - Confirm pool’s underlying balance decreases and attacker’s balance increases by the same amount (minus any dust configured).
   - Ensure victim’s newly supplied `dUSD` balance equals the dust amount and is grossly below the drained collateral value.
   - Capture/emit helper events and store relevant balances to reuse in post-mortem documentation.

5. **Packaging & Automation**
   - Add the test to CI by extending the existing adapter test suite (e.g., `OdosAdaptersV1.exploit.test.ts`).
   - Provide a README or comment block describing how to rerun (`yarn test path/to/file`), expected output, and how the artefact feeds into regression.
   - Document any limitations (e.g., simplified flash-mint simulation) so the post-mortem accurately reflects the repro scope.

## Validation Criteria
- Test consistently reproduces the collateral drain without non-deterministic dependencies (no chain forking, no external RPC calls).
- Balances before/after exactly match the attack narrative (collateral gone, dust collateral supplied, attacker enriched).
- Repro fails (or throws) once we introduce the planned mitigation (e.g., enforcing caller == user, adding oracle check). This will be used later but should be anticipated now.

## Follow-Ups
- Pull exact event signatures/order from tx `0xa6ae...1940` to confirm which ones we want to assert in the repro logs.
- Decide where to store the numeric constants (e.g., helper constants vs. inline literals) so the 17,509.54233 `WFRAX` figure stays easy to update.
- Scope whether to include a helper script that diffs victim/attacker balances before and after for post-mortem screenshots.

## Dependencies
- Typechain bindings regeneration after adding new mocks.
- Hardhat deployment helpers for mock pool + tokens.
- Potential contract size allowances if the fixture grows (keep mocks minimal).

## Out of Scope (for this ticket)
- Implementing the actual fix/mitigation.
- Publishing the post-mortem (only gathering artefacts).
- Writing integration tests for V2 adapters (unless reused for comparison).
