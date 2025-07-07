# 🐞 Issue 325 – Unlimited dStable Minting Exploit

Date: 2025-07-04

## Summary
A holder of `INCENTIVES_MANAGER_ROLE` can mint an arbitrary amount of **un-collateralised dStable** by calling `Issuer.issueUsingExcessCollateral()` with the AMO Manager address as the receiver. Because dStable held by the AMO Manager is excluded from `circulatingDstable()`, the post-mint collateral ratio check never fails. While this does let the incentives manager grow the AMO’s internal balance indefinitely, the tokens are **not part of circulating supply** and cannot be redeemed or transferred to users without additional AMO privileges. Consequently the issue is a _permissions-boundary leak_ rather than a direct economic threat.

## Impact (Low)
* Incentives manager can increase `totalSupply` and the AMO Manager’s un-backed holdings at will.
* No insolvency or peg risk **unless** the same entity also controls AMO allocation / withdrawal roles.
* Breaks the intended separation of duties and complicates accounting / TVL metrics.

## Reproduction Steps
1. Deploy the system with any collateral in the `CollateralVault` so it starts fully-backed.
2. Grant an EOA the `INCENTIVES_MANAGER_ROLE` (and optionally `AMO_ALLOCATOR_ROLE`).
3. From that EOA call:
   ```solidity
   Issuer.issueUsingExcessCollateral(address(amoManager), 1_000_000 ether);
   ```
   The transaction succeeds; `totalSupply` increases but `circulatingDstable()` stays the same.
4. Execute step 3 repeatedly – it always succeeds.
5. (Optional) Use AMO functions such as `allocateAmo` or `decreaseAmoSupply` to move or burn those tokens, putting them into circulation.

## Technical Details
* `Issuer.issueUsingExcessCollateral()` mints first and checks collateral **afterwards**.
* `circulatingDstable()` subtracts `amoManager.totalAmoSupply()` from `totalSupply`.
* When the receiver **is** the AMO Manager, both quantities rise equally, so the invariant `collateralInDstable >= circulatingDstable` still holds, irrespective of mint size.

## Suggested Fix
- Disallow `receiver == address(amoManager)` (and possibly any AMO vault) inside `issueUsingExcessCollateral`, **or**
- Pre-check the collateral ratio _before_ minting so the allocation is bounded by excess collateral.

Either change is sufficient; the first is simpler given the business logic that AMO supply should grow only through `increaseAmoSupply` (which already enforces a no-change-in-circulation invariant).

## Test Plan
* Add a unit test under `test/dstable/Issuer.ts` that:
  1. Grants the incentives role to the test user.
  2. Calls `issueUsingExcessCollateral(amoManager, X)`.
  3. Expects a **revert** after the fix is implemented.

## References
* Original report: <https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/325>

---
_Assignee: TBD_ 