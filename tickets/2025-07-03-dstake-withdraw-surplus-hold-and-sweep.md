# DStake Router – Hold-and-Sweep Surplus Mitigation

## Context / Motivation

ERC-4626 `withdraw` flows in `DStakeToken` → `DStakeRouterDLend` attempt to **re-deposit any surplus dSTABLE** returned by the adapter back into the vault asset.  
Today that step is **mandatory**.  If the downstream adapter's `convertToVaultAsset()` reverts (e.g. reserve paused, frozen, supply-cap full, or surplus < 1 share), the **entire withdrawal reverts**, causing a Denial-of-Service (DoS) for _all_ users.

We control the underlying dLEND fork, but real-world ops still pause / cap reserves and rounding-to-zero can happen at any time.  Hence we need a graceful fallback that removes the DoS risk without leaking value.

## Proposed Solution

1. **Attempt** to reinvest the surplus (`adapter.convertToVaultAsset(surplus)`).
2. **If** that call reverts, catch the error and **hold** the surplus dSTABLE inside the router contract instead of reverting or gifting it to the withdrawer.
3. Add a small **`sweepSurplus()`** function (governed) that converts the accumulated dSTABLE back into the default vault asset when deposits are allowed again.

This "hold-and-sweep" pattern:
* Preserves NAV accuracy (surplus value is eventually reinvested for _all_ shareholders).
* Guarantees withdrawals can never be blocked by paused / capped reserves or rounding errors.
* Avoids value-leak to active withdrawers.
* Adds only ~260 gas on the happy path.

## Tasks

- [ ] Modify `DStakeRouterDLend.withdraw()`
  - Wrap the surplus reinvestment in `try/catch`.  
  - On failure: transfer the `surplus` to `address(this)` (the router) and emit `SurplusHeld(uint256 amount)`.
- [ ] Add new governed function `sweepSurplus(uint256 maxAmount)`
  - Pull up to `maxAmount` (or all) dSTABLE held by the router.  
  - Re-attempt `convertToVaultAsset()` into the default vault asset.
  - Emit `SurplusSwept(uint256 amount, address vaultAsset)`.
- [ ] Unit tests
  - Withdrawal succeeds when underlying reserve is paused/frozen and surplus is held.  
  - Sweep reinvests successfully once reserve un-paused.  
  - NAV (`totalAssets()`) increases by the swept amount.
- [ ] Gas snapshot update.
- [ ] Update docs / README for router behaviour.

## Acceptance Criteria

1. **No withdrawal** can revert solely because surplus reinvestment fails.
2. Surplus held in router is observable (`SurplusHeld` events & `IERC20.balanceOf`).
3. Governance can recover and reinvest ≥99.99 % of held surplus via `sweepSurplus`.
4. Existing tests pass; new tests cover failure and sweep paths.

## Risk Discussion

* Surplus accumulating in router is **non-interest-bearing** until swept → keeper run at reasonable cadence (e.g. daily) recommended.
* `sweepSurplus()` must respect existing `dustTolerance` / slippage checks.
* Ensure router cannot be griefed into holding excessive dSTABLE (governance-rate-limited `maxAmount` param helps).

---
*Created 2025-07-03* 