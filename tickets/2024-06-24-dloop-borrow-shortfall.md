# dLoop vault borrow-shortfall DoS guard

**Date:** 2024-06-24

## Context
While analysing `DLoopCoreBase.deposit` we found that the function assumes the vault receives **exactly** the amount that it requests when calling `_borrowFromPool`.  The wrapper `_borrowFromPool` only checks that the observed balance delta is within ±1 wei of the requested amount.  If the lending pool returns `amount − 1` wei, the wrapper permits it and the vault subsequently reverts when trying to forward `amount` to the user, causing a permanent denial-of-service for `deposit`.

Our in-tree regression test `rounding-borrow-shortfall-test.ts` reproduces the failure using a purpose-built mock that transfers `amount − 1` wei.

Originally brought up here: https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/85
And here: https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/88

## Impact
The same assumption is used both when **borrowing** (during `deposit`) and when **withdrawing collateral** (during `withdraw`).  A 1-wei shortfall on either side will make the vault attempt to forward more tokens than it owns and revert, permanently bricking the user action.

* **Current deployment (Aave V3)** – _not exploitable_.  Aave V3 transfers/withdraws the exact amount requested, does not apply origination fees, and contains no rounding that would cause a 1-wei shortfall.
* **Future integrations** – the assumption _is brittle_.  Any money-market adapter that:
  * charges a tiny on-chain fee, or
  * supports fee-on-transfer tokens,
  * or simply rounds down in its accounting
  could trigger the DoS condition in **deposit** or **withdraw**.

## Proposed fix
1. **Use observed delta** – change `_depositToPoolImplementation` to return the _actual_ balance delta computed in `_borrowFromPool` instead of the requested amount.  `_deposit` will then forward the precise amount received.
2. **Stricter tolerance** – alternatively, remove the `+1 / ‑1` tolerance (set `BALANCE_DIFF_TOLERANCE = 0`) so that any shortfall reverts immediately inside the wrapper instead of later in the flow.
3. **Regression guard** – keep the new rounding-shortfall unit tests (both *deposit* and *withdraw*) to ensure future adapters do not introduce this behaviour unnoticed.

## Tasks
- [ ] Decide on preferred fix (observed-delta vs strict-tolerance).
- [ ] Implement the change in `DLoopCoreBase` (and any overriding mocks).
- [ ] Update existing tests; ensure rounding-shortfall test passes with the new logic.
- [ ] Add changelog entry and bump contract version if we change byte-code.

## Priority
Low for current Aave deployment, but **medium** for maintainability / future integrations. 