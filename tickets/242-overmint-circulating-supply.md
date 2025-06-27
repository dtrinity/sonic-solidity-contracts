# Ticket: Prevent Over-Minting via Circulating-Supply Mismatch (GitHub #242)

## Summary
`Issuer.issueUsingExcessCollateral()` relies on an incorrect formula for *circulating dStable*.  Because the value it subtracts (`AmoManager.totalAmoSupply()` = `freeBalance + totalAllocated`) is not the actual on-chain token balance but contains bookkeeping entries, the function can **under-count** circulating supply and let a privileged address mint un-backed dStable.

The AMO flow envisages that:
1. `allocateAmo` or `increaseAmoSupply` mints un-backed dStable to the AMO.  
2. AMO sells it on a DEX and later sweeps earned collateral back to the vault.  
3. During the period where collateral is off-vault, the amount of *protocol debt* is `totalAllocated`.

The bug: `circulatingDstable = totalSupply − (freeBalance + totalAllocated)` treats `totalAllocated` as if those tokens were not circulating, even though they are in the market as soon as the AMO moves them out of its contract.

## Root Cause
`totalAllocated` is an accounting figure ("dStable debt") but is used as if it were a token balance.  Once included in the subtraction, circulating supply is understated by up to the entire un-backed dStable amount.

## Proposed Fix
Introduce a *debt–versus–backing* check that never looks at AMO token balances:

1. Keep existing `totalAllocated` and `freeBalance` bookkeeping unchanged.  
2. Add helper to `Issuer` (or a library) that computes:
   ```solidity
   protocolDebt   = amoManager.totalAmoSupply(); // freeBalance + totalAllocated
   backedSupply   = dstable.totalSupply() - protocolDebt; // must be collateral-backed
   requiredBase   = backedSupply * UNIT / 10**dstable.decimals();
   backingBase    = collateralVault.totalValue();
   excessBase     = backingBase > requiredBase ? backingBase - requiredBase : 0;
   excessDstable  = excessBase * 10**dstable.decimals() / UNIT;
   ```
3. In `issueUsingExcessCollateral()` **pre-check**
   ```solidity
   require(dstableAmount <= excessDstable, "insufficient excess collateral");
   dstable.mint(receiver, dstableAmount);
   ```
4. No changes to AMO flow are required; `totalAllocated` continues to track debt and drops when collateral is swept back.

## Migration / Upgrade Path
* Deploy new Issuer logic library (or upgradeable proxy) with the revised calculation.
* No state migration needed; relies only on existing `totalAllocated` and collateral vault values.

## Tests
Add Hardhat tests under `test/dstable/issuer.excess.ts` (mirroring directory structure).

### Happy paths
1. **Fully-backed mint:** User deposits collateral, receives dStable; `excess` is zero.
2. **AMO neutral cycle:**
   * Mint 1000 un-backed dStable to AMO (`allocateAmo`).
   * Deposit 1000 collateral to AMO (`transferFromHoldingVaultToAmoVault`).
   * Attempt `issueUsingExcessCollateral(→100)` → **revert** (no excess).
   * Sweep 1000 collateral back (`transferFromAmoVaultToHoldingVault`).
   * Attempt `issueUsingExcessCollateral(→100)` → **success** (excess regained).

### Attack simulation (regression test for #242)
1. Re-implement *old* logic inside a helper to show that prior to the fix the same steps above would allow over-minting.
2. Ensure new logic reverts.

### Edge cases
* Collateral value ≈ required backing (off-by-one): ensure no excess reported.
* Large collateral inflows creating >2²⁵⁶-1 potential overflow – use `SafeCast` / checked math.

### Fuzzing
* Random sequences of
  * issue(), allocateAmo(), transfer (in & out), withdrawProfits()  
  * Periodically call `issueUsingExcessCollateral()` with random amounts.  
  → Property: never succeeds when system is under-collateralised.

## Acceptance Criteria
- [ ] New computation is implemented and covered by 100 % tests added above.
- [ ] All existing tests pass.
- [ ] Slither & Mythril report no new issues.
- [ ] Documentation in `contracts/dstable/Issuer.sol` updated to explain new logic.

## References
* Audit issue hats #242: "Incorrect Circulating Supply Calculation Enables Overminting of dStable" (link). 