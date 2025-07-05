# Title
DLoopCoreBase deleverage formula correction – update downstream tests

## Context / Problem Statement

While addressing [Hats Issue #223](https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/223) we discovered that the helper used by *decreaseLeverage* (`_getDebtTokenAmountToReachTargetLeverage`) employed an **incorrect denominator** when computing the debt amount that needs to be repaid to bring the vault back to the target leverage (3 ×).

Old denominator (bps form):
```
ONE_HUNDRED_PERCENT_BPS + subsidyBps + 0          // 1 + k
```

Correct denominator (derived from the leverage equation):
```
ONE_HUNDRED_PERCENT_BPS + subsidyBps - (T * subsidyBps) / ONE_HUNDRED_PERCENT_BPS   // 1 + k - T·k
```
where `T = targetLeverageBps / ONE_HUNDRED_PERCENT_BPS` and `k = subsidyBps / ONE_HUNDRED_PERCENT_BPS`.

Because the old denominator was too large the vault would **under-repay debt**, so the leverage after `decreaseLeverage()` stayed above 3 × (≈3.06 × in unit tests).  This cascaded into several tests that asserted on the final leverage or relied on the precise amount transferred.

## Fix (already merged on branch `dz/hats-audit-low-fixes`)
1. **contracts/vaults/dloop/core/DLoopCoreBase.sol**
   * Replaced denominator calculation with the correct formula and added a zero-denominator guard.
   * Improved `_getRequiredDebtTokenAmountToRebalance` so that when the caller forwards extra debt the vault never repays more than the exact requirement (prevents overshoot / panic 0x11).
   * Added a 1-bps rounding cushion when validating `newLeverageBps` after deleverage (integer truncation can land us one bps below target).

2. **test/dloop/DLoopCoreMock/rebalance-test.ts**
   * Un-skipped "Should use vault debt balance for decrease leverage when available (inverse prices)" – now passes.

All previously failing suites under `test/dloop/DLoopCoreMock` have been updated, but **many other test files still rely on the old, slightly-too-high leverage after a deleverage call**.  They will now fail (usually with a custom error `DecreaseLeverageOutOfRange` or leverage mismatch assertions).

---

## Required Follow-up Work

1. **Refactor leverage assertions in the remaining tests**
   * Search pattern: `expect(...).to.be.closeTo(...` or hard-coded numbers around `TARGET_LEVERAGE_BPS` after deleverage.
   * The vault should now end within **≤1 bps *below* or at target** instead of ~3 % above.
   * Update tolerances or expected values accordingly.

2. **Remove safety skips**
   * Some tests were previously marked `- SKIP` because of the panic overflow; these should now pass – delete the tag and verify.

3. **Edge-case rounding**
   * If a test deposits extremely small additional debt there can be a 1-bps under-shoot; prefer
     ```ts
     expect(finalLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, ONE_BPS_UNIT);
     ```
     instead of strict equality.

4. **Integration fixtures**
   * Any fixture that mints extra debt into the vault and then expects balance = 0 afterwards must take into account that the vault may leave a few wei untouched (when exactRequiredDebtTokenAmount < availableDebt).

5. **Re-run full suite**
   * `yarn hardhat test` should return green.

## Acceptance Criteria
- [ ] All Hardhat & Jest tests pass without `it.skip` after the updates.
- [ ] No custom error `DecreaseLeverageOutOfRange` or arithmetic-overflow panics are triggered in normal test flows.
- [ ] Coverage for the corrected formula exists (already provided in `rebalance-test.ts`).

## References
- Equation derivation included in code comments in `DLoopCoreBase.sol` (§"Denominator derivation").
- Original Hats report: Issue #223. 