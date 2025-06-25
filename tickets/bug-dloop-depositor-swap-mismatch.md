# Ticket: DLoopDepositor `deposit` DoS due to `_swapExactOutput` accounting mismatch

## Summary
`DLoopDepositorBase.deposit()` reverts for every call whenever the underlying swap implementation returns the output–token amount instead of the **input**–token amount.  The revert is thrown in `SwappableVault._swapExactOutput` via the custom error
`SpentInputTokenAmountNotEqualReturnedAmountIn`.

## Root Cause
```
# contracts/common/SwappableVault.sol (excerpt)
spentInputTokenAmount = inputTokenBalanceBefore - inputTokenBalanceAfter;
...
if (spentInputTokenAmount != amountIn) revert SpentInputTokenAmountNotEqualReturnedAmountIn;
```

`amountIn` **is assumed to be** the amount of *input* tokens spent, but every Odos-based implementation (`OdosSwapLogic.swapExactOutput`) returns the *output*-token amount it actually received.  Because the two values are denominated in different tokens, equality almost never holds and the call reverts.

A dedicated regression test has been added at
`test/dloop/DLoopDepositorOdos/revert-bug.test.ts`.  It:
1. Deploys a minimal `MockOdosRouter` that mimics the real Odos return value behaviour.
2. Executes `DLoopDepositorOdos.deposit()`.
3. Expects the transaction to revert with `SpentInputTokenAmountNotEqualReturnedAmountIn`.

## Impact
* Denial of Service – no user can deposit through any `DLoopDepositor*` contract built on `SwappableVault`.
* Other periphery contracts that rely on `_swapExactOutput` are also affected (increase/decrease leverage, redeemer, etc.).

## Remediation Plan
### Option A (preferred – keep invariant)
1. **Modify every `_swapExactOutputImplementation` to return the real input-token amount.**
   * For Odos: record `inputToken.balanceOf()` before and after performing the swap; the delta is the amount actually spent.
   * Update the mock implementations (`SimpleDEXMock`, etc.) accordingly.
2. Keep `SwappableVault._swapExactOutput` unchanged so the invariant continues to protect against unexpected behaviours.

### Option B (quick but weaker)
* Change `SwappableVault._swapExactOutput` to verify the *output*-token amount instead (or to remove the equality check entirely).  This is a smaller code change but drops an important safety assertion.

## Tasks
- [ ] Implement Option A for `OdosSwapLogic`.
- [ ] Apply the same change to all mock venues.
- [ ] Re-run the new regression test; it must now **fail** (no revert) – adjust expectation accordingly.
- [ ] Add/adjust unit tests for other periphery contracts using `_swapExactOutput`.

## Severity
`High` – functional DoS to deposits (and other swaps) until fixed.

## References
* PR introducing these contracts: _link_
* Regression test: `test/dloop/DLoopDepositorOdos/revert-bug.test.ts`

---
_Opened: 2024-06-25_ 