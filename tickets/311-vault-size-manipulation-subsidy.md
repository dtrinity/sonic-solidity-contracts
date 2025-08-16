# Vault Size Manipulation Leading to Oversized Subsidy (Issue #311)

**Status:** ⏳ Needs Fix

**Severity:** High

**Reporter reference:** https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/311

---

## Summary
The DLoop vault pays a _subsidy bonus_ on every `increaseLeverage()` / `decreaseLeverage()` call that is proportional to the amount of collateral/debt required to rebalance.  Because `deposit()` keeps the leverage ratio unchanged while scaling both the collateral and debt bases linearly, an attacker can _temporarily_ inflate the vault size (via a flash-loan), call a rebalance function, and pocket an **oversized subsidy** while returning the flash-loaned funds in the same transaction.  The protocol is left with a permanent loss equal to the subsidy amount.

---

## Technical Details
1. `deposit()` supplies the caller’s collateral _and immediately_ borrows debt in the same proportion, so the vault’s leverage **remains unchanged**.
2. `getCurrentSubsidyBps()` depends **only** on the leverage deviation from target, **not** on absolute vault size.
3. The derived functions `_getCollateralTokenAmountToReachTargetLeverage()` and `_getDebtTokenAmountToReachTargetLeverage()` multiply that subsidy rate by the _vault-wide base values_ `(C, D)`, so the required amount – and thus the subsidy payout – **scales linearly with vault size**.
4. By flash-depositing a large amount, the attacker inflates `(C, D)` while keeping the leverage deviation constant ⇒ much larger subsidy.

---

## Proof-of-Concept (single-transaction attack)
1. Flash-loan **N** collateral tokens.
2. `deposit(N)`
   * Vault supplies **N** collateral and borrows debt that preserves the pre-existing leverage (e.g. 2×).
3. Flash-loan **x** additional collateral (≈ 42.3 % of **N** when target=3×, current=2×).
4. `increaseLeverage(x, 0)`
   * Vault supplies **x**, borrows `(1+k)·x` debt (where `k = getCurrentSubsidyBps()`), and sends it to the attacker.
5. `withdrawAll()` (burn shares)
   * Repays the debt needed to keep target leverage and withdraws **N + x** collateral.
6. Repay both flash-loans.
7. Profit: the subsidy `k·x` debt-tokens remain in attacker wallet; vault keeps the debt.

Observed loss ≈ `k · x` which scales with **N**; repeatable while within leverage bounds.

---

## Impact
* Permanent increase of vault debt or decrease of collateral ⇒ bad-debt for all remaining LPs.
* Loss is only bounded by flash-loan liquidity and `maxSubsidyBps`.

---

## Affected Components
* `contracts/vaults/dloop/core/DLoopCoreBase.sol`
  * `deposit()`
  * `increaseLeverage()` / `decreaseLeverage()`
  * `getCurrentSubsidyBps()`

---

## Remediation Ideas
* Cap the **absolute** subsidy amount per call (not just BPS).
* Make subsidy a function of vault size (e.g. scale down by `totalSupply`).
* Disallow `deposit()` + rebalance in the same block/tx, or require time-weighted average size.
* Use slippage-based reward rather than fixed percentage.

---

## Action Items
- [ ] Discuss & decide mitigation strategy
- [ ] Implement fix in core logic
- [ ] Add comprehensive unit/↔integration tests reproducing attack & proving fix
- [ ] Run static-analysis + fuzzing pass
- [ ] Audit review / sign-off

---

*Created automatically from Hats Issue #311 findings.* 