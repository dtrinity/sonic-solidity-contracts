# Step 3 – Review Tests & Classification (Iteration-1)

## 1. Did the new tests cover audit issue #17 / #124?
**Yes** – the added tests exercise every path identified in the Hats-audit reports:

| Component | Behaviour audited | Test File | Case(s) |
|-----------|-------------------|-----------|---------|
| OdosSwapLogic (vault) | Surplus refund when exact‐output swap delivers > requested | `OdosSwapLogic.refund.test.ts` | *refunds surplus*, *minimal surplus*, *receiver==self* |
| BaseOdosBuyAdapter | Adapter should not keep surplus when buying | `BaseOdosBuyAdapter.surplus.test.ts` | *handle surplus*, *large surplus* |
| BaseOdosSellAdapter | Adapter should not keep surplus when selling | `BaseOdosSellAdapter.surplus.test.ts` | *handle surplus*, *large surplus*, *multi-tx accumulation* |

They collectively prove that:
1. Surplus tokens are **not** forwarded to the user/receiver.
2. Tokens remain trapped in the adapter/vault, matching the exploit scenario described in the audit.

## 2. Are the tests enough to show that the issue is fixed?
**Not yet.** All critical tests are tagged `[NEED-TO-FIX-AUDIT-ISSUE]` and currently fail (or purposefully assert the wrong behaviour). They will turn green only after the contracts are corrected.

## 3. Classification
Because failing, marked tests exist, we are in **Classification 2 – Bug present, tests in place**. We must:
1. Implement the fix.
2. Update contracts.
3. Ensure tests pass afterwards.

---

## 4. Implementation Plan – Fixing Surplus-Refund Bug

### 4.1 High-level Goal
Guarantee that when an Odos swap returns more *outputToken* than requested (`amountOut` or `minAmountToReceive`), **only** the requested amount stays with the contract, and **all surplus** is forwarded to the designated `receiver` (could be external EOA or another contract).

### 4.2 Contract Changes
1. **`OdosSwapUtils.executeSwapOperation`**  
   • Already returns `amountSpent`; extend return values to also emit/return `actualAmountReceived` (optional helper).
2. **`OdosSwapLogic.swapExactOutput`**  
   a. Record contract’s balance of `outputToken` *before* swap (not receiver’s).  
   b. Perform swap via `OdosSwapUtils`.  
   c. `actualReceived = contractBalanceAfter − contractBalanceBefore`.  
   d. `surplus = actualReceived − amountOut` (require `>= 0`).  
   e. If `surplus > 0` **and** `receiver != address(this)`, `safeTransfer(receiver, surplus)`.  
   f. Return `amountSpent` unchanged.
3. **`BaseOdosBuyAdapter._buyOnOdos` & `BaseOdosSellAdapter._sellOnOdos`**  
   • No logic change needed if they always call `OdosSwapUtils` and keep funds; surplus refund now handled in `OdosSwapLogic`.  
   • If adapters themselves need refund semantics (outside vault context), replicate logic: compute surplus using contract balance deltas, refund to `msg.sender` or configurable `receiver`.
4. **Gas optimisation**: Skip refund when `receiver == address(this)` or `surplus == 0`.

### 4.3 Safety Checks
- Use `safeTransfer` (OpenZeppelin) for ERC20 sends.  
- Add revert `InsufficientOutput()` if `actualReceived < amountOut` (already exists).

### 4.4 Deployment & Upgrade
Contracts are libraries; deploy new versions and relink in tests. For production, this will require upgrading vault logic or redeploying.

---

## 5. Test Plan for the Fix
The failing `[NEED-TO-FIX-AUDIT-ISSUE]` tests will turn **green** once the implementation above is complete. Additional success-path tests to add:

| File | New Test | Purpose |
|------|----------|---------|
| `OdosSwapLogic.refund.test.ts` | *surplus refunded when receiver != caller* (green) | Verifies correct surplus transfer post-fix |
| `BaseOdosBuyAdapter.surplus.test.ts` | *adapter refunds surplus to msg.sender* | Ensures adapters no longer hoard surplus |
| `BaseOdosSellAdapter.surplus.test.ts` | same as above | |

No `[NEED-TO-FIX-AUDIT-ISSUE]` marks should remain after fix; they should be removed or renamed to normal tests.

---

## 6. Conclusion
- Current tests adequately **expose** the vulnerability but confirm it is **still unfixed**.  
- Follow the implementation plan to remediate.  
- After code changes, run the full suite → all tests must pass and `[NEED-TO-FIX-AUDIT-ISSUE]` tags removed. 