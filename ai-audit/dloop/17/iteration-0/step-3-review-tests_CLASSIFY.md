# Step 3 – Review of Implemented Tests

## Conclusion
* The implemented suite (`OdosSwapUtils.test.ts`) verifies the **core library** logic and demonstrates that the fix for [Audit Issue #17 / #124] is effective **at the library level**.
* However, the audit issue originally manifested in the higher-level contracts (`BaseOdosBuyAdapter`, `BaseOdosSellAdapter`, `OdosSwapLogic`). These contracts were refactored in the same branch and must have dedicated coverage to guarantee that no regressions remain.
* The current suite still contains a test labelled `[NEED-TO-FIX-AUDIT-ISSUE]`. According to `base-info.md`, that tag should only be present when the audit bug is **not yet fixed**. Because the test passes (revert fires as expected) the tag is misleading and should be removed.

Therefore **additional tests are required** (classification #1 – missing tests).

---

## Detailed Test-Plan to complete coverage
Implement the following new test files under `test/odos/`.

### 1. `BaseOdosBuyAdapter.test.ts`
1. Happy-path buy
   * Router behaviour: spend 1 000 `TOKEN_IN` → receive 2 000 `TOKEN_OUT`.
   * Call `buy(maxSwap=1 500, amountToReceive=2 000)`.
   * Expect:
     * Adapter emits `Bought(tokenIn, tokenOut, 1 000, 2 000)`.
     * Balances: −1 000 `TOKEN_IN`, +2 000 `TOKEN_OUT`.
2. Revert when output lower than requested  `[NEED-TO-FIX-AUDIT-ISSUE]` **should be absent** – because issue fixed.
   * Instead, expect revert and NO special tag.
3. Revert on maxAmountToSwap exceeded.

### 2. `BaseOdosSellAdapter.test.ts`
1. Happy-path sell mirrors buy case.
2. Revert when adapter balance insufficient.
3. Revert when router delivers < `minAmountToReceive` (expect `InsufficientOutput`).

### 3. `OdosSwapLogic.test.ts`
1. `swapExactOutput` refunds surplus correctly
   * Setup: router spends 1 000 `TOKEN_IN`, sends **2 500** `TOKEN_OUT` with `amountOut` arg = 2 000.
   * Receiver balance increases by 2 500, then leftover 500 is transferred back inside function.
   * Assert receiver net gain 2 500, but function return == 1 000 and contract balance of `TOKEN_OUT` is 0.
2. Revert when router yields < `amountOut`.

### 4. Clean-up of existing suite
* Remove `[NEED-TO-FIX-AUDIT-ISSUE]` prefix from the second test in `OdosSwapUtils.test.ts`.

### Shared utilities
* Re-use existing mocks (`MockOdosRouterV2`, harnesses, token helpers).
* Provide a `beforeEach` fixture that deploys new adapter/logic harness with freshly deployed router & tokens.

### Coverage targets
* ≥ 95 % line & branch coverage across all changed contracts.
* Each revert path in adapters and logic covered at least once.

### CI commands
```bash
make compile
yarn hardhat test test/odos/**/*.ts
```

This plan, once implemented, will fully demonstrate that the branch fixes Audit Issue #17 across all affected layers and eliminates the need for any `[NEED-TO-FIX-AUDIT-ISSUE]` tags. 