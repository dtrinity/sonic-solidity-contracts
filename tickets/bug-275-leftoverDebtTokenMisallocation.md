# Bug 275 – Depositor forwards leftover debt tokens to vault, diluting the depositor

## Status
*Open – TODO*

---

## Context / Summary
When a leveraged deposit is executed through a `DLoopDepositor*` periphery contract the flow may leave a positive balance of the **debt token** on the periphery after the flash-loan repayment.  The current implementation calls `_handleLeftoverDebtTokens`, which unconditionally transfers that balance to the core vault.  Because share minting already occurred, the depositor receives **no economic credit** for those tokens; the value is distributed to existing shareholders, resulting in a systematic value leakage.

Reference: [External Issue #275](https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/275).

---

## Root Cause
```solidity
// contracts/vaults/dloop/periphery/DLoopDepositorBase.sol
function _finalizeDepositAndTransfer(...) internal returns (uint256 shares) {
    // 1️⃣ shares are computed & minted here …

    // 2️⃣ leftover debt tokens are then forwarded to the core vault
    _handleLeftoverDebtTokens(dLoopCore, debtToken);
}
```

1.  The core vault mints shares to `address(this)` *before* the leftover is handled.
2.  The surplus debt tokens are then sent to the vault, reducing its outstanding debt and increasing NAV.
3.  Because no new shares are minted, the depositor's share of NAV is effectively diluted; pre-existing holders capture the surplus.

---

## Proposed Fix – Variant A (Pre-share-mint repay)
Repay the surplus debt *inside the core vault* **before** shares are minted. This way NAV is already adjusted when shares are calculated, so the depositor receives full credit without ever touching the surplus tokens.

Pseudo-code showing the key change (to be placed in `_executeDepositAndValidate` right after the deposit succeeds and before control returns to `_finalizeDepositAndTransfer`):
```solidity
uint256 surplusDebt = debtToken.balanceOf(address(this)) - flashLoanFee;
if (surplusDebt > 0) {
    debtToken.forceApprove(address(dLoopCore), surplusDebt);
    dLoopCore.repay(surplusDebt);          // existing external function
}
```
* Shares are now minted after `repay`, so the depositor's ownership is proportional to the updated NAV.
* No user sees "extra" tokens; UX remains single-asset (shares).
* Incremental logic is ~5 lines, no new storage.

### Tasks
1. Insert surplus-repay logic in `DLoopDepositorBase._executeDepositAndValidate`.
2. Remove / deprecate `_handleLeftoverDebtTokens` **or** update it to revert when a non-zero balance remains (should be unreachable after the fix).
3. Update comments & NatSpec.
4. Bump contract version pragma header.

---

## Test Plan
Add a new test-suite file `test/dloop/DLoopDepositorMock/leftover-repay.test.ts` with the following scenarios (extend existing fixtures):

1. **Baseline (no slippage)**  
   *Deposit that produces zero surplus* – behaviour unchanged.

2. **Positive Slippage – small surplus**  
   • Execute deposit with crafted swap rate to leave e.g. 1 dUSD surplus.  
   • **Assert:**
     - `depositorShareIncrease * pricePerShare ≈ leveragedCollateralValue` (within 1 bps).
     - Vault `debtToken.balanceOf` did **not** increase.

3. **Positive Slippage – large surplus**  
   • Same as above but with 1000 dUSD surplus.

4. **Regression – leverage bounds**  
   • Ensure vault leverage after deposit stays within `[lower, upper]` bounds.

5. **Event emissions**  
   • Verify no `LeftoverDebtTokensTransferred` event is emitted anymore.

General rules for tests (per workspace guidance):
* Use explicit `chai` assertions, no `console.log`.
* Expect exact reverts with `.to.be.revertedWith` where relevant.

Coverage target ≥ 95 % lines in modified file(s).

---

## Acceptance Criteria
- [ ] Surplus debt token balance on periphery after `_executeDepositAndValidate` is **always** zero.
- [ ] Depositor's shares represent full economic value of their transaction under all tested slippage scenarios.
- [ ] No dilution of pre-existing shareholders observed in unit tests.
- [ ] All new/updated tests pass with `npm run test`.
- [ ] No increase in cyclomatic complexity ≥ 5 in any function according to `solhint`/`slither` metrics.

---

## Security / Audit Notes
The change narrows, rather than widens, the economic attack surface by preventing unintended subsidies.  External call pattern remains unchanged (only an additional `repay` to the already-relied-upon core vault), so new re-entrancy risk is negligible. 