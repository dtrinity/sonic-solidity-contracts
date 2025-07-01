# Ticket: DLoop share pricing ignores debt – net-asset accounting fix required

## Context / Summary
The `DLoopCoreBase` implementation of `totalAssets()` returns **only the collateral value** of the vault position and silently discards the outstanding debt that was borrowed to create leverage.

Because ERC-4626 helpers (`convertToShares`, `previewDeposit`, `previewRedeem`, etc.) all derive from `totalAssets()`, the emitted share price is inflated by up to `(leverage-1)/leverage` (e.g. 67 % at 3×).  Internally the vault keeps matching accounting, so user deposits and withdrawals do not break *inside* dLoop, but any **external** contract or oracle that relies on the ERC-4626 view functions will be mis-led.

Concrete abuse paths include:
1. Using the overpriced share token as collateral in other lending protocols (over-collateralised borrowing attack).
2. Mis-valuation in vault-of-vaults, on-chain price feeds, or dashboards which leads to bad rebalances or arbitrage.

## Severity
High – economic loss is unbounded once the share token is accepted by external protocols.  Internally it is an accounting bug that violates ERC-4626 invariants.

## Reproduction / Proof-of-Concept
1. Deploy a DLoop vault with 3× target leverage.
2. Deposit 1 WETH; vault borrows ~0.667 dUSD and mints 1 share.
3. Observe: `await vault.totalAssets()` → `1 WETH` even though net equity is `0.333 WETH`.
4. A third-party lending market that trusts that view will allow ≈0.9 WETH borrowing against the share, enabling the attacker to drain >0.5 WETH.

## Recommended fix
1. Change `totalAssets()` to return **net** assets = `totalCollateralBase – totalDebtBase` (clamp to zero if debt exceeds collateral).
2. Verify/fix `convertToShares`, `convertToAssets`, and any other overrides so that ERC-4626 invariants hold (`previewDeposit` ⇔ `deposit`, etc.).
3. Update periphery helpers (`DLoopDepositorBase`, `DLoopRedeemerBase`, `DLoopIncreaseLeverageBase`, …) and tests – they currently assume "assets = collateral".
4. Add regression tests that:
   • Assert `previewRedeem(shares)` equals actual assets received after redeeming (when debt repayment supplied).
   • Assert `convertToShares(convertToAssets(x)) == x` across various leverage states.
5. Document explicitly that redeeming requires supplying the proportional debt token.

## Work plan / tasks
- [ ] Update `contracts/vaults/dloop/core/DLoopCoreBase.sol` (`totalAssets`, and possibly internal helpers).
- [ ] Propagate change to `convertToShares`, `convertToAssets`, `preview*` if needed.
- [ ] Refactor periphery contract slippage calculations to use new net-asset logic.
- [ ] Adjust unit tests that rely on old behaviour; add new regression cases.
- [ ] Security review: ensure no division-by-zero or negative scenarios; clamp to zero for under-collateralised edge cases.
- [ ] Update README / docs describing vault accounting.

## References
GitHub issue: https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/300
Lines:
```610:640:contracts/vaults/dloop/core/DLoopCoreBase.sol
function totalAssets() public view virtual override returns (uint256) {
    (uint256 totalCollateralBase, ) = getTotalCollateralAndDebtOfUserInBase(address(this));
    return convertFromBaseCurrencyToToken(totalCollateralBase, address(collateralToken));
}
``` 