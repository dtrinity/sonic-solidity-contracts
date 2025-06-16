# Ticket: Bug #8 – `DStakeRouterDLend.withdraw()` over-pays user on positive slippage

**Status:** Open

## Summary
When a **conversion adapter** returns more dSTABLE than requested (e.g. because yield accrued between the `previewWithdraw()` call and the actual on-chain conversion), `DStakeRouterDLend.withdraw()` forwards the **entire** amount it received to the user.  The function only checks that the amount is *at least* the requested `dStableAmount`, it does **not** cap the transfer to that amount.  Any *positive slippage* therefore benefits the withdrawing user at the expense of the remaining vault share-holders.

## Steps to Reproduce
A dedicated Hardhat unit-test (`test/dstake/WithdrawPositiveSlippage.ts`) was added that:
1. Deposits 100 dSTABLE into a `DStakeToken` (normal path).
2. Re-configures the router to use a **`PositiveSlippageAdapter`** (testing stub) that deliberately over-pays by 10 % on `convertFromVaultAsset()`.
3. Calls `router.withdraw(100, user, user)` impersonating the `DStakeToken` contract (the same pattern used in existing router tests).
4. Observes that the user balance increases by **> 100** dSTABLE – the bonus ends up in the user's wallet.

The test passes, confirming the issue is real.

## Root Cause Analysis
Contract: `contracts/vaults/dstake/DStakeRouterDLend.sol`
```46:101:DStakeRouterDLend.sol
        uint256 receivedDStable = adapter.convertFromVaultAsset(vaultAssetAmount);
        IERC20(dStable).safeTransfer(receiver, receivedDStable);

        // Sanity check: Ensure received amount is sufficient
        if (receivedDStable < dStableAmount) {
            revert InsufficientDStableFromAdapter(...);
        }
```
1. The router asks the adapter for `vaultAssetAmount` that should correspond to **exactly** `dStableAmount` using the current exchange-rate.
2. If the adapter returns **more** than `dStableAmount`, the router forwards the full `receivedDStable` to the receiver (`safeTransfer(receiver, receivedDStable)`).
3. The subsequent check only guards the *lower* bound (`>= dStableAmount`).

Hence positive slippage leaks protocol yield to the withdrawing user.

## Impact
* **Economic:** Withdrawal requests can siphon accrued yield, slightly eroding APY for remaining share-holders.  The impact grows with the magnitude and frequency of slippage.
* **Severity:** Low-to-Medium – does not break accounting, but unfairly redistributes yield.

## Proposed Fix
Cap the amount sent to the user and keep any excess in the collateral vault for the benefit of all share-holders.

```solidity
uint256 receivedDStable = adapter.convertFromVaultAsset(vaultAssetAmount);

uint256 amountToUser = receivedDStable > dStableAmount
    ? dStableAmount
    : receivedDStable;
IERC20(dStable).safeTransfer(receiver, amountToUser);

// Handle excess: forward to collateral vault (simple) or re-deposit via adapter (better)
if (receivedDStable > dStableAmount) {
    uint256 excess = receivedDStable - dStableAmount;
    // Option A – leave dStable idle in vault:
    IERC20(dStable).safeTransfer(address(collateralVault), excess);
    // Option B – auto-re-deposit via adapter for compounding (requires extra logic).
}
```

### Unit Tests
* Extend existing router withdrawal tests to assert **exact equality** between `received` and `dStableAmount` after the fix.
* Keep the new positive-slippage test to ensure excess is no longer leaked.

## Tasks
- [ ] Implement the fix in `DStakeRouterDLend.sol`.
- [ ] Decide on excess-handling strategy (simple vault transfer vs automatic re-deposit).
- [ ] Update/extend unit tests: `WithdrawPositiveSlippage.ts` should expect equality.
- [ ] Run full test-suite & static-analysis.
- [ ] Prepare migration script if contracts have been deployed to live networks.

---
*Created automatically by o3-assistant.* 