# Ticket: Remove redundant internal functions in DLoopRedeemerBase.sol (Issue #310)

## Context
The GitHub report hats-finance/dTRINITY#310 highlights that three internal helper functions declared in `contracts/vaults/dloop/periphery/DLoopRedeemerBase.sol` are never invoked:

* `_handleLeftoverCollateralTokens`
* `_validateSharesBurned`
* `_finalizeRedeemAndTransfer`

Their full logic is duplicated inside the public `redeem()` function.  Keeping the helpers unused bloats byte-code (extra ~0.8-1 kB) and adds maintenance overhead.

## Goal
Restructure the contract so there is only a single implementation of this logic.

## Scope / Tasks
1. Decide strategy
   * **Option A – Delete helpers** (simplest)
   * Option B – Refactor `redeem()` to call `_finalizeRedeemAndTransfer()` (and via it the smaller helpers)
2. Apply chosen change to `DLoopRedeemerBase.sol` (and derived implementations if any changes propagate).
3. Re-compile; ensure byte-code shrinks and all tests pass.
4. Update/extend tests if behaviour changes (none expected).
5. Run static-analysis (slither, mythril) to confirm no new issues.
6. Update docs / README if needed.

## Acceptance criteria
* Contract compiles; unit & integration tests green.
* `pnpm hardhat size-contracts` (or manual artifact inspection) shows reduced byte-code size for `DLoopRedeemer*`.
* No unused-function warnings for the three helpers.

## References
* Report: https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/310

---
_Assignee: @dinosaurchi  |  Severity: Low_ 