# Root Cause Analysis – Issuer.issue() Allows Unsupported Collateral (High Severity)

Date: 2024-06-11

Related Finding: Smart Contract Audit Report 2024-06-11 — Finding 3

Severity: **HIGH**

Module / File: `contracts/dstable/Issuer.sol`

## Summary

The `issue()` function bypasses the `CollateralVault`'s validation and accounting by transferring collateral **directly** to the vault contract instead of calling `deposit`. This means the incoming token never passes through the `_supportedCollaterals` check enforced inside `CollateralVault`, allowing users to mint `dStable` against *any* ERC-20 for which an oracle price exists, even if governance never approved that token as collateral.

## Technical Details

```58:78:contracts/dstable/Issuer.sol
        // Transfer collateral directly to vault
        IERC20Metadata(collateralAsset).safeTransferFrom(
            msg.sender,
            address(collateralVault),
            collateralAmount
        );
```

* `CollateralVault.deposit()` (not shown) performs:
  * `require(_supportedCollaterals.contains(asset), "Unsupported collateral")`
  * Book-keeping in `_totalValueOfSupportedCollaterals()`
* By sending the tokens directly, the value of the deposit is **ignored** by the vault's internal accounting, yet the oracle value is still credited to the minter via `dstableAmount` calculation earlier in the function.

## Root Cause

A convenience refactor inadvertently skipped the critical `deposit()` pathway. The developer assumed the vault would automatically account for ERC-20 transfers, but its design relies on an explicit function call to whitelist and record each asset.

## Impact

1. **Under-Collateralisation:** An attacker can supply a toxic or obsolete token that is not in `_supportedCollaterals` but still has an inflated oracle price, minting `dStable` that appears fully backed.
2. **Silent Accounting Drift:** The vault's `totalValue()` excludes the rogue asset, so system-wide collateral metrics underestimate liabilities, risking bank-runs at redemption time.

## Suggested Remediation

1. Replace the raw transfer with a safe call to `collateralVault.deposit(collateralAmount, collateralAsset, msg.sender)` (or equivalent signature) so that the internal whitelist is enforced.
2. Add a defensive `require(collateralVault.isCollateralSupported(collateralAsset), …)` inside `issue()` for immediate clarity.
3. Write regression tests that attempt to issue with an unsupported token and expect a revert.

## Test Vector (pseudo-code)

```
Setup: collateralVault supports USDC only.
AttackerToken = deploy new ERC-20 with 18 decimals and manipulated oracle price = $1e9.

Attempt: Issuer.issue(collateralAmount = 1 AttackerToken, collateralAsset = AttackerToken, minDStable = 0)
Expected: revert (after fix). Current behaviour: success, under-collateralises system.
``` 