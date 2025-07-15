# Bug: Double-counting of `additionalCollateralFromUser` in `DLoopIncreaseLeverageBase::increaseLeverage`

**Date opened:** 2025-06-27  
**Discovered by:** Hats audit report – [Issue #192](https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/192)

## Summary
`contracts/vaults/dloop/periphery/DLoopIncreaseLeverageBase.sol` mis-calculates the amount of collateral already available inside the helper contract when deciding whether a flash-loan is required. The code currently does:

```solidity
uint256 collateralFromUser = additionalCollateralFromUser + collateralToken.balanceOf(address(this));
```
`additionalCollateralFromUser` has **already** been transferred to `address(this)` a few lines earlier, therefore `balanceOf(address(this))` already reflects that value. Adding it again double-counts the user's fresh collateral.

### Effect
1. `collateralFromUser` is overstated by `additionalCollateralFromUser`.
2. If `requiredCollateralAmount` lies between the true balance and the overstated balance, the helper thinks it can proceed *without* a flash-loan and enters the "direct increase" branch.
3. `DLoopCoreBase.increaseLeverage` later attempts to supply more collateral than the helper actually holds → fails with `ERC20InsufficientBalance`, effectively a DoS for users in that state.

## Reproduction
A dedicated regression test `test/dloop/DLoopIncreaseLeverageMock/double-counting-bug-test.ts` now reproduces the bug:

* Raise collateral price so leverage < target.
* Supply exactly `requiredCollateralAmount` via the helper.
* Transaction reverts because helper skipped flash-loan logic.

## Severity
Medium – causes incorrect leverage decisions and denial-of-service for affected users.

## Proposed Fix
Replace the calculation with the correct balance check:

```solidity
// OLD (buggy)
uint256 collateralFromUser = additionalCollateralFromUser + collateralToken.balanceOf(address(this));

// NEW (fixed)
uint256 collateralFromUser = collateralToken.balanceOf(address(this));
```

## Work Items
1. [ ] Patch `DLoopIncreaseLeverageBase.sol` as above (ensure no other branches double-count).
2. [ ] Run `yarn hardhat test` – the new regression test should **fail** before the patch and **pass** after.
3. [ ] Audit related periphery helpers (`DLoopDepositor*`, `DLoopRedeemer*`, etc.) for similar patterns.
4. [ ] Deploy patched contracts / prepare migration if already deployed.
5. [ ] Update documentation / CHANGELOG.

## Test Coverage
Regression test added in PR: `double-counting-bug-test.ts` – will fail until fix is applied, ensuring future protection.

---
*Feel free to extend this ticket with additional context or implementation notes.* 