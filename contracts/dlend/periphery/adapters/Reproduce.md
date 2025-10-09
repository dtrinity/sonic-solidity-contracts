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

## Fidelity Notes
- **Same-asset dust loop restored:** The harness now mirrors production by returning `1 µ wstkscUSD` to the adapter. `AttackExecutor` approves the malicious router to pull the dust, the router credits the adapter in-flight, and the tests assert the `CollateralDustReturned` event plus the victim’s credited micro-aToken.
- **Victim debt repayment reproduced:** The exploit path triggers the pool’s `Repay` flow twice (victim and reserve manager), matching the Sonic trace and leaving the borrower debt-free. Watch for `Repay` events in the Tenderly diff or Hardhat logs to confirm this behavior when refactoring.
- **Reserve manager burns modelled:** `StatefulMockPool.withdraw` burns the reserve manager’s aTokens for the flash-loan premium and extra collateral, so the structured snapshot test now enforces the exact `-35,121.28867 wstkscUSD` delta alongside the `ReserveBurned` event.
- **Multi-asset flash loans supported:** `StatefulMockPool.flashLoan` accepts multi-asset arrays, matching Aave’s semantics should we need cross-reserve coverage for regression tests.

No outstanding fidelity gaps are known. Re-run the suite whenever additional guardrails are added to ensure these invariants continue to hold.

## Tenderly Alignment Workflow
- Run `npx hardhat run scripts/tenderly/compare-odos-attack-events.ts`. The script reuses the cached Sonic trace in `reports/tenderly/raw-*.json`; only set `TENDERLY_ACCESS_KEY` (or `TENDERLY_FORCE_REFRESH=true`) when you need to refresh that cache.
- The comparison artefact `reports/tenderly/attack-vs-repro-transfers.json` should show:
  - `1 µ wstkscUSD` dust in both the production (`actual`) and harness (`local`) sections.
  - Matching `Repay` events for reserve `0x53a6…` covering ~21,444 dUSD (victim) and ~7,133 dUSD (reserve manager).
- Regenerate the report after harness updates and confirm the deltas stay aligned before shipping fixes.

## Using the Artefacts During Review
- Capture the console summary printed by the structured snapshot test to support RCA write-ups.
- When validating the final fix, attach updated Tenderly comparison artefacts and mention the passing mitigation specs in the PR description.
- Keep hard-coded constants in `test/dlend/adapters/odos/v1/helpers/attackConstants.ts` synced with production magnitudes (collateral, flash-mint amount, recycler pulls) if new on-chain evidence emerges.

## File Index
- `contracts/dlend/periphery/adapters/ATTACK_STEPS.md` – production incident timeline and balances.
- `contracts/dlend/periphery/adapters/Reproduce.md` (this file) – harness usage, fidelity caveats, and verification guidance.
