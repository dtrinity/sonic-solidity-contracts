# Odos Liquidity Swap Adapter Exploit Reproduction

This guide explains how to exercise the Sonic attack in our local harness, gather parity artefacts, and later confirm that the mitigation closes the hole. For the narrative walk-through of the production incident, see `contracts/dlend/periphery/adapters/ATTACK_STEPS.md`.

## Running the Harness
- Install dependencies once: `yarn install`.
- Execute the exploit regression suite:
  - `yarn hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts`
  - Expected today: 3 passing specs (two positive paths, one structured snapshot) and 2 skipped mitigation guards.
- The fixture seeds all contracts; no environment variables are required.

### Enabling Mitigation Specs (after the fix lands)
1. Remove `.skip` from the final two tests in `test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts`.
2. Update the assertions to target the final revert selector once it is known (placeholders currently use `.to.be.reverted`).
3. Re-run the suite; all five specs should pass when the adapter enforces the new guardrail.

## TypeScript & CI Expectations
- `yarn tsc --noEmit` still fails because of repository-wide gaps (missing `typechain-types`, Slack SDK typings, duplicated `BorrowLogic` symbols). The exploit harness itself compiles cleanly once those dependencies are restored.
- Remove the repo-level blockers and regenerate `typechain-types` before wiring the suite into CI.

## Known Fidelity Gaps
- **Same-asset dust loop:** The real attack returns `1 µ wstkscUSD` to the adapter while the harness currently swaps into `dUSD` with `minOut = 0` to avoid the adapter’s same-asset underflow check (`AttackExecutor.sol:55`, `OdosLiquiditySwapAdapter.exploit.test.ts:70`). The pending router shim in `MaliciousOdosRouterV2.performSwap()` cannot credit dust yet because the executor never approves the router to pull the micro transfer. Address this before relying on the suite to validate accounting-only mitigations.
- **Reserve manager burn parity:** `StatefulMockPool` mints shortfall liquidity instead of burning the reserve manager’s aTokens. Assertions therefore focus on emitted events rather than exact post-attack reserve balances.
- **Single-asset flash loans:** The current fixture supports one-asset loans; extend it if we need multi-asset coverage for future regressions.

## Tenderly Alignment Workflow
- Set `TENDERLY_ACCESS_KEY`, then run `npx hardhat run scripts/tenderly/compare-odos-attack-events.ts`.
- The script downloads the Sonic production trace once (cached under `reports/tenderly/raw-*.json`) and compares it against the latest local run, emitting `reports/tenderly/attack-vs-repro-transfers.json`.
- After restoring same-asset dust fidelity, regenerate the report and sanity-check the `.local` vs `.remote` transfer lists to ensure 1 µ wstkscUSD movements appear in the local data.

## Using the Artefacts During Review
- Capture the console summary printed by the structured snapshot test to support RCA write-ups.
- When validating the final fix, attach updated Tenderly comparison artefacts and mention the passing mitigation specs in the PR description.
- Keep hard-coded constants in `test/dlend/adapters/odos/v1/helpers/attackConstants.ts` synced with production magnitudes (collateral, flash-mint amount, recycler pulls) if new on-chain evidence emerges.

## File Index
- `contracts/dlend/periphery/adapters/ATTACK_STEPS.md` – production incident timeline and balances.
- `contracts/dlend/periphery/adapters/Reproduce.md` (this file) – harness usage, fidelity caveats, and verification guidance.
