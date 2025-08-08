# Step 1 – Review of `phong/issue-17` branch (Iteration-1)

## 1. Changes compared with `main`

`git diff main..phong/issue-17` shows updates and additions primarily around the **Odos swap flow**:

1. `contracts/odos/OdosSwapUtils.sol`
2. `contracts/dlend/periphery/adapters/odos/{BaseOdosBuyAdapter,BaseOdosSellAdapter}.sol`
3. `contracts/vaults/dloop/periphery/venue/odos/OdosSwapLogic.sol`
4. Several new testing-only files (`contracts/testing/odos/*` & `contracts/mocks/MockERC20.sol`)
5. Added unit-tests under `test/odos/` (4 spec files + shared setup helper).

The intention, as per audit issue #17/#124, is to: 
• Return **amountSpent** instead of **amountOut** for accurate accounting.
• Guarantee that the Odos router delivers at least the requested output or revert.
• Refund any surplus output tokens to the user/receiver.

## 2. Compilation / existing tests

```bash
make compile            # ✅ 0 errors
npx hardhat test test/odos/*.ts  # ✅ 11 tests passing
```

Compilation succeeds and the newly added tests all pass on the branch.

## 3. Do the fixes & tests actually resolve the audit issue?

### 3.1 Manual code inspection
*`OdosSwapLogic.swapExactOutput()`* now measures the receiver’s `outputToken` balance **before** and **after** the swap:
```solidity
uint256 outputBalanceBefore = ERC20(outputToken).balanceOf(receiver);
...
uint256 outputBalanceAfter = ERC20(outputToken).balanceOf(receiver);
uint256 actualOutputReceived = outputBalanceAfter - outputBalanceBefore;
```
However, the Odos router transfers the output tokens **to the calling contract (the vault/adapter)**, **not directly to `receiver`**. Therefore `actualOutputReceived` will be *zero* in all happy-path scenarios and the `if (actualOutputReceived > amountOut)` refund branch is never taken.  Surplus tokens remain trapped in the contract – **the original vulnerability persists.**

### 3.2 Review of current tests
`test/odos/OdosSwapLogic.test.ts` explicitly asserts that **no tokens reach `receiver` after a surplus swap**, and instead remain with the calling contract:
```ts
expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(0);
expect(harnessBalanceAfter - harnessBalanceBefore).to.equal(amountReceived);
```
This means the test suite is validating the *broken* behaviour, not the correct one.  Hence the presence of passing tests does not prove the fix; it conceals the unresolved issue.

**Conclusion:** We are in **Case 3 – the fixes do not fix the audit issue**.

---

## 4. Test-plan to capture the still-present audit issue
All new tests live in `test/odos/` (same directory used by the branch).  We will *extend* the suite with additional cases marked with `[NEED-TO-FIX-AUDIT-ISSUE]` that fail today but must pass once the vulnerability is properly patched.

### 4.1 General utilities
Reuse the existing helper `test/odos/utils/setup.ts` (fixtures for ERC20 mocks, router mock, etc.).  Add a small helper `expectBalanceChange(token, account, delta)` to assert ERC20 balance diffs in a readable way.

### 4.2 New / updated spec files & cases
1. **`OdosSwapLogic.refund.test.ts`** – dedicated to surplus-refund logic
   * `it.only("[NEED-TO-FIX-AUDIT-ISSUE] refunds surplus output to receiver", ...)`
     1. Deploy harness and set router to spend 1 000 `TOKEN_IN`, deliver **2 500** `TOKEN_OUT` for an `amountOut` request of **2 000**.
     2. Call `swapExactOutput(...)` with `receiver` set to an EOA.
     3. **Assert**
        * Receiver gains **exactly 500** `TOKEN_OUT` (surplus).
        * Harness/Vault keeps **2 000** `TOKEN_OUT` (requested amount).
        * Function returns `amountSpent == 1 000`.
2. **Update** `OdosSwapLogic.test.ts`
   * Remove the incorrect expectation that receiver balance stays 0.
   * Add a **no-surplus** path where router delivers exactly `amountOut` (should leave receiver unchanged).
3. **`BaseOdosBuyAdapter.surplus.test.ts`** `[NEED-TO-FIX-AUDIT-ISSUE]`
   * Similar scenario for adapter buy path – verify surplus refund.
4. **`BaseOdosSellAdapter.surplus.test.ts`** `[NEED-TO-FIX-AUDIT-ISSUE]`
   * Mirror for sell path.

### 4.3 Edge-cases
* **Very small surplus (1 wei)** – ensure refund branch still executes.
* **Receiver == contract self** – no external transfer should be attempted (gas optimisation / no-op).
* **Router sends *less* than `amountOut`** – existing tests already cover revert; ensure custom error & values are correct.

### 4.4 Implementation checklist
- [ ] Create new spec file(s) as described.
- [ ] Tag at least one failing case per affected component with `[NEED-TO-FIX-AUDIT-ISSUE]`.
- [ ] Run `npx hardhat test` – the marked cases **must fail** on current branch.
- [ ] Commit tests; CI should show red until the contract logic is fixed.

### 4.5 Success criteria
After the contracts are properly patched:
* All surplus-refund tests pass.
* No regression on existing passing cases.
* 100 % branch coverage on the new refund logic.

---

## 5. Outcome of Step 1
* The branch introduces tests but they validate incorrect behaviour.
* Audit issue #17/#124 **remains unfixed** → **Case 3**.
* Detailed test-plan above will ensure the vulnerability is demonstrably captured and provides a red-first workflow for the upcoming fix implementation. 