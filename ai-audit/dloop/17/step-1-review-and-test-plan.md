# Step 1 – Review of `phong/issue-17` branch and Test-plan

## 1. Changes compared with `main`

*Scope = contracts only (`bot/dlend-liquidator` changes are intentionally out-of-scope).*  
`git diff main..phong/issue-17` shows modifications in 8 Solidity files, all related to Odos swap logic:

1. `contracts/odos/OdosSwapUtils.sol`
2. `contracts/dlend/periphery/adapters/odos/BaseOdosBuyAdapter.sol`
3. `contracts/dlend/periphery/adapters/odos/BaseOdosSellAdapter.sol`
4. `contracts/vaults/dloop/periphery/venue/odos/OdosSwapLogic.sol`
5. `contracts/mocks/MockOdosSwapper.sol`
6-8. two Aave-v3 liquidator contracts + `bot/dlend-liquidator/contracts/odos/OdosSwapUtils.sol` (duplications for bot package – ignored here).

Key code-level changes
* `OdosSwapUtils.executeSwapOperation()` signature changed → now receives both `inputToken` & `outputToken`, returns **actualAmountSpent** instead of **actualAmountOut** and verifies the received output tokens via balance accounting.
* `BaseOdosBuyAdapter._buyExactAmount()` & `BaseOdosSellAdapter._sellExactAmount()` redesigned to use the new Utils interface and correct accounting (removed manual _slippage buffer_ & balance-difference calc errors called out in audit issue #17/#124).
* `OdosSwapLogic.swapFrom()` updated to forward new parameters, return `amountSpent`, and refund any output surplus to `receiver`.

## 2. Current test situation
* No new or modified test files were added in this branch (`test/…` tree unchanged; `test/odos/` directory still **empty**).
* `make compile` succeeds.
* There are therefore **no automated tests covering the new logic nor the audit issue**.

## 3. Mapping to audit issues
Audit Issues under review
* [Issue 17](https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/17)  
* [Issue 124] – duplicate of 17

Issue 17 describes wrong accounting of sold / received amounts when using Odos router, allowing surplus tokens or under-delivery without revert.  The refactor above aims to fix it, but without tests we cannot be certain.

Because **no tests exist**, we are in **Case 1**.

---

## 4. Detailed Test-Plan (Case 1)
The goal is to implement a comprehensive test-suite inside **`test/odos/`** that both verifies the fix and prevents regressions.

### 4.1 General setup
1. Deploy fresh Hardhat network for every test (fixture recommended).
2. Create three ERC20 mock tokens with 18 decimals: `TOKEN_IN`, `TOKEN_OUT`, `EXTRA_TOKEN` (for negative-case noise).
3. Deploy a **MockOdosRouterV2** contract that
   * Accepts forced approval & records allowance.
   * Provides a `setSwapBehaviour()` helper to define: `amountSpent`, `amountReceived`, `shouldRevert`, `revertReason`.
   * When called with `swapData` it will
     * `transferFrom` `inputToken` → router
     * `transfer` `outputToken` → caller equal to `amountReceived`
     * return abi-encoded `amountSpent` (matching prod router behaviour).
4. Deploy contracts under test via Hardhat upgrades:
   * `OdosSwapUtils` (library linked).
   * Minimal proxy wrappers for `BaseOdosBuyAdapter`, `BaseOdosSellAdapter`, and `OdosSwapLogic` exposing public test functions that call the internal logic (can reuse existing mocks if available).
5. Fund the adapter contracts with large balances of `TOKEN_IN` / `TOKEN_OUT` as needed.

### 4.2 Test groups & cases
Each *it()* below should live in its own `.ts` file under `test/odos/` and follow the Arrange-Act-Assert pattern.  Cases that purposely reproduce the original audit bug must be tagged with
`[NEED-TO-FIX-AUDIT-ISSUE]` as per guideline.

#### A. OdosSwapUtils
1. *Happy path* – exact output met
   * Configure router to spend 1 000 `TOKEN_IN`, deliver 2 000 `TOKEN_OUT`.
   * Call `executeSwapOperation(maxIn=1_500, exactOut=2_000)`.
   * Assert return == 1 000 and caller’s `TOKEN_OUT` increased by 2 000.
   * Assert router allowance reset to 0 afterwards.
2. *Reverts when output < exactOut* `[NEED-TO-FIX-AUDIT-ISSUE]`
   * Router delivers only 1 500 `TOKEN_OUT` (vs 2 000 expected).
   * Expect revert `InsufficientOutput` with correct values.
3. *Propagates router failure*
   * Router `shouldRevert=true` with reason.
   * Expect the same revert bubble-up.

#### B. BaseOdosBuyAdapter
1. *Buys exact amount* – returns sold amount correctly
   * Pre-fund adapter with 10 000 `TOKEN_IN`.
   * Router configured to spend 1 000 `TOKEN_IN` for 2 000 `TOKEN_OUT`.
   * Call `_buyExactAmount(maxAmountToSwap=2_000, amountToReceive=2_000)`.
   * Verify:
     * Function returns / emits `Bought` with sold=1 000, recv=2 000.
     * Adapter balance delta: −1 000 `TOKEN_IN`, +2 000 `TOKEN_OUT`.
2. *Reverts if router output smaller than requested* `[NEED-TO-FIX-AUDIT-ISSUE]`
   * Router delivers 1 900 `TOKEN_OUT`.
   * Expect revert `InsufficientOutput`.
3. *Reverts when maxAmountToSwap exceeded*
   * Router attempts to spend 2 500 `TOKEN_IN` while max is 2 000.
   * Expect revert from router allowance / our check.

#### C. BaseOdosSellAdapter
1. *Sells exact amount* – returns received amount correctly (mirror of buy).
2. *Reverts when adapter has insufficient balance*.
3. *Reverts if received < minAmountToReceive* `[NEED-TO-FIX-AUDIT-ISSUE]`.

#### D. OdosSwapLogic (vault context)
1. *Swap and refund surplus* – verify leftover is sent to receiver and `amountSpent` returned.
2. *No leftover path* – when output == amountOut nothing is refunded.

### 4.3 Test utilities
* Create `helpers/odos.ts` with factory functions for tokens, router, and default swapData bytes.
* Use `ethers.provider.getSigner(0)` as default deployer.
* Prefer `chai` matchers with `expect(...).to.be.revertedWithCustomError` for custom errors.

### 4.4 Coverage goals
* 100 % branch coverage on new `OdosSwapUtils` logic.
* At least one regression test tagged `[NEED-TO-FIX-AUDIT-ISSUE]` per audited bug path (3 total).

### 4.5 Directory structure (proposal)
```
 test/odos/
   utils/
     odosRouterMock.ts
     tokens.ts
   OdosSwapUtils.test.ts
   BaseOdosBuyAdapter.test.ts
   BaseOdosSellAdapter.test.ts
   OdosSwapLogic.test.ts
```

### 4.6 CI instructions
1. `make lint.solidity` – ensure no lint errors after code changes.
2. `make compile`  – should pass.
3. `npx hardhat test test/odos/**/*.ts` – run new suite only.

---

## 5. Outcome of Step 1
* **Case 1** confirmed → no tests exist for the fix.
* Detailed test-plan written above for an AI agent to implement.
* Proceed to Step 2: implement the test suite. 