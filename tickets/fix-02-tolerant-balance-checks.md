# Ticket: Fix #02 – Tolerant Balance-Difference Checks

Date opened: 2025-06-13

## Background
Audit finding #2 (medium severity) pointed out that the helper wrappers in `DLoopCoreBase` revert if the observed balance delta after a `borrow` / `repay` / `withdraw` differs *exactly* from the nominal `amount`.  Because Aave's V3 `Pool` rounds to the nearest wei when converting between scaled values and real token units, the difference can be ±1 wei in perfectly normal, single-transaction flows (see detailed analysis in the discussion thread).

## Done
1. Introduced a public constant `BALANCE_DIFF_TOLERANCE = 1` in `DLoopCoreBase.sol`.
2. Re-implemented the delta assertions in the three internal helpers ` _borrowFromPool`, `_repayDebtToPool`, and `_withdrawFromPool` so that they now:
   • keep the original sanity check that balance increased/decreased in the expected direction; and
   • accept an absolute difference ≤ `BALANCE_DIFF_TOLERANCE` instead of strict equality.
3. Added targeted unit test `tolerant-balance-test.ts` under `test/dloop/DLoopCoreMock/` that proves:
   • a 1-wei discrepancy no longer reverts;
   • a ≥2-wei discrepancy still reverts (regression guard).

## To verify
`yarn hardhat test --grep "tolerant balance"`

The new test as well as the full suite must pass.

## Roll-out
No storage layout changes.  Safe to deploy as part of next release bundle. 