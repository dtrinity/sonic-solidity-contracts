# Ticket: Total Assets Manipulation via Foreign Collateral Supply

## Summary
`DLoopCoreBase.totalAssets()` incorrectly counts **all** collateral positions held by the vault address in the lending pool.  An attacker can deliberately supply an _unauthorised_ reserve (e.g. WETH) to the pool on behalf of the vault, inflating the collateral figure, pushing leverage calculations out-of-bounds and effectively _freezing_ deposits / withdrawals.

The new test `test/dloop/DLoopCoreMock/foreign-collateral-supply-test.ts` reproduces this behaviour on the mock implementation.

## Root Cause
`totalAssets()` relies on `getTotalCollateralAndDebtOfUserInBase(address(this))`, which aggregates every reserve's collateral for the user address.  The vault logic assumes the only collateral token is `collateralToken`, but Aave treats the vault as a regular user: anyone can send additional collateral with `supply(token, amt, vault, …)`.

## Impact
1. `totalAssets()` becomes inflated.
2. `getCurrentLeverageBps()` falls outside the configured bounds → `isTooImbalanced()` is `true`.
3. Every ERC-4626 interface (`deposit`, `withdraw`, `redeem`, `mint`) reverts because `maxDeposit/maxWithdraw` return `0`.
4. `increaseLeverage()` can be abused to borrow excessive debt at a subsidy, extracting value while locking the system.

This is a permanent DoS / grief attack that can also lead to bad accounting and possible liquidation.

## Proof-of-Concept
See the new Hardhat test: `foreign-collateral-supply-test.ts`.  Steps:
1. Legitimate user deposits 1 000 units of the authorised collateral.
2. Attacker transfers **debtToken** to the vault and calls `supply` on behalf of the vault.
3. `vault.totalAssets()` skyrockets and `isTooImbalanced()` turns `true`.
4. Further deposits revert with `ERC4626ExceededMaxDeposit`; withdrawals revert with `ERC4626ExceededMaxWithdraw`.

## Proposed Fix
Count **only** the authorised collateral token position when reporting assets.  Two complementary actions:
1. Replace `totalAssets()` implementation with direct aToken balance query of the designated collateral reserve, e.g.
   ```solidity
   function totalAssets() public view override returns (uint256) {
       return getDTokenBalance(address(collateralToken));
   }
   ```
   (For dLend this is the `aToken` of the collateral reserve.)
2. Audit all usages of `getTotalCollateralAndDebtOfUserInBase` and ensure leverage / subsidy maths are based exclusively on the authorised reserve.

## Tasks
- [ ] Implement filtered `totalAssets()` (and possibly `getCurrentLeverageBps`) in **core** contracts.
- [ ] Update any math that assumed aggregated collateral.
- [ ] Add negative unit test ensuring external supply of foreign token no longer affects accounting.
- [ ] Run full Hardhat + Foundry test suites.
- [ ] Update documentation / README where relevant.

---
_created: 2024-06-25_ 