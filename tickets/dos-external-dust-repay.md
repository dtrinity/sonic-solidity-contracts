# DoS via External Dust Repay on `_repayDebtToPool`

## Summary
An attacker can grief/DoS the last withdrawer from any DLoop vault by front-running with an extremely small `repay()` (e.g. 2 wei) executed **on behalf of the vault** against the underlying Aave‐V3 pool.  The dust reduces the vault's outstanding debt without touching its own token balance.  When the vault subsequently calls `_repayDebtToPool()` during a user-initiated `withdraw` / `redeem`, its post-repay balance delta differs from the `amount` parameter by > `BALANCE_DIFF_TOLERANCE` (currently 1 wei) and the function reverts with `UnexpectedRepayAmountToPool`.  The user's transaction fails and their funds remain locked.  The attacker can repeat this cheaply and indefinitely.

## Impact
* Permanent Denial-of-Service for the last user attempting to exit a vault position.
* Only costs the attacker a few wei of the debt token per griefing attempt.
* Affects all flows that rely on `_repayDebtToPool()` (redeem, withdraw, decreaseLeverage, etc.).

## Root Cause
1.  `DLoopCoreBase._repayDebtToPool()` assumes that **exactly** `amount` tokens leave the vault during the repay (±1 wei rounding tolerance).
2.  Aave's `repay()` is permission-less and silently caps the actual transfer to `min(requestedAmount, currentDebt)`.
3.  Any external actor can therefore create an off-by-dust condition by repaying a few wei on behalf of the vault before the vault's own repay executes.
4.  The observed balance delta after the vault's repay is now smaller than `amount` by the attacker's dust; the 1‐wei tolerance is exceeded and the call reverts.

## Reproduction
* Added automated test: `test/dloop/DLoopCoreMock/dos-repay-dust-test.ts`
  * Opens a position, sets up an attacker dust repay (simulated via `setTransferPortionBps`), and shows the subsequent `redeem()` reverting.

## Proposed Remediation
### Minimal risk-free fix
* Accept **smaller-than-expected** balance deltas when calling `repay`.
  ```solidity
  if (observedDiffRepay + BALANCE_DIFF_TOLERANCE < amount) {
      // Only revert if we *over-paid* far beyond tolerance.  Under-payment
      // means the debt was already lower; nothing critical happened.
  }
  ```
* Keep the revert for *over-payment* (unexpected token loss).

### Safer long-term fix
1.  Before issuing the repay, query the remaining debt:  
   `uint256 debtBefore = _getUserDebt(onBehalfOf);`
2.  Set `amount = debtBefore;` or call the pool with `type(uint256).max` so the pool computes the actual payoff.
3.  Skip fragile balance-delta assertion; verify instead that `debtAfter == debtBefore - observedDiff` within 1 wei.

### Optional defence-in-depth
* Increase `BALANCE_DIFF_TOLERANCE` to cover a few wei.
* Add `min(msg.value, remainingDebt)` logic in all repay paths.

## Acceptance Criteria
- [ ] Fix implemented in `_repayDebtToPool` (choose one of the remedies above).
- [ ] Existing tests pass.
- [ ] New regression test (already committed) passes without reverting.
- [ ] Documentation / comments updated to clarify repay invariants.

## References
* Audit finding "Low – Dust Repay DoS"
* PR #?? (when fix is opened) 