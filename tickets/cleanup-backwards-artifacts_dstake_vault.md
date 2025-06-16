# Ticket: Cleanup Back-Compat Adapter Logic from DStakeCollateralVault

## Context
We recently refactored dSTAKE so that the `DStakeRouterDLend` is the **sole** source of truth for the `vaultAsset → adapter` mapping.

During migration we temporarily re-added several legacy items to the vault to keep old deployment scripts & tests compiling. These artefacts are no longer required now that deployment/scripts/tests have been updated.

## Scope
Remove all backwards-compatibility code from:
* `contracts/vaults/dstake/DStakeCollateralVault.sol`
* `contracts/vaults/dstake/interfaces/IDStakeCollateralVault.sol`
* Any tests or scripts still referencing the removed items.

### Items to delete
1. `mapping(address => address) adapterForAsset`
2. View `adapterForAsset()`
3. Admin functions `addAdapter()` / `removeAdapter()`
4. Events `AdapterAdded` / `AdapterRemoved`
5. Errors `InvalidAdapter`, `AdapterMismatch` (only used by deleted funcs)
6. Associated code branches in `sendAsset` and constructor checks.

### Code that must remain
* `supportedAssets` array & helper `_isSupported()`
* `sendAsset`, `totalValueInDStable`, `setRouter`
* Events: `RouterSet`, `SupportedAssetAdded`, `SupportedAssetRemoved`

### Test Updates
* Remove vault-level adapter management tests.
* Ensure router tests cover adapter add/remove functionality and event emission.
* Replace any `adapterForAsset` references with `router.vaultAssetToAdapter`.

### Acceptance Criteria
- Hardhat tests run with `yarn hardhat test` show zero failures.
- Deployment script `08_dstake/03_configure_dstake.ts` operates exclusively via router.
- Grep for `adapterForAsset(`, `.addAdapter(`, `.removeAdapter(` on vault shows no matches.

## Priority
Medium – cleans technical debt and reduces attack surface.

## Owner
TBD

## Estimate
~1 dev-day (code + test cleanup + review)

## Status
Completed – legacy adapter mapping, view and events removed from vault & interface; tests and scripts updated. All `yarn hardhat test` pass with 0 failures. 