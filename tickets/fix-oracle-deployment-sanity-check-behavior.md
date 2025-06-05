# Fix Dangerous Oracle Deployment Sanity Check Behavior

## Problem
The oracle deployment helpers have dangerous behavior where sanity check failures don't halt the deployment. Instead, they continue with partial success, which can lead to inconsistent states.

### Current Issues:
1. **`setupRedstoneCompositeFeedsForAssets`** and **`setupRedstoneSimpleFeedsForAssets`** return boolean success values
2. When sanity checks fail, they set `allSuccessful = false` but continue processing other assets
3. The main deployment script combines these boolean results with `&&` operators
4. This allows "partially successful deployments" to continue, which is dangerous

### Files Affected:
- `typescript/dlend/setup-oracle.ts` - Contains the setup functions with dangerous behavior
- `deploy/12_dlend_weth_sceth_wstksceth_reserves/01_setup_chainlink_price_feeds.ts` - Uses the setup functions
- Multiple other deployment files have similar patterns with `performOracleSanityChecks`

## Solution
1. **Make sanity checks throw errors instead of returning booleans**
   - `performOracleSanityChecks` should only throw or succeed (no return value)
   - Setup functions should throw on any failure instead of returning false
   - Remove all boolean success tracking and combining logic

2. **Update deployment scripts to not handle partial success**
   - Remove `overallSuccess` tracking
   - Let errors bubble up to halt deployment immediately
   - Either deployment fully succeeds or fails idempotently

## Benefits
- No more "partially successful deployments"
- Fail-fast behavior prevents inconsistent states
- Simpler code without complex boolean logic
- Forces developers to fix issues before proceeding

## Status
- [x] Fix `performOracleSanityChecks` to throw instead of return (already correct)
- [x] Fix `setupRedstoneCompositeFeedsForAssets` to throw on failure
- [x] Fix `setupRedstoneSimpleFeedsForAssets` to throw on failure  
- [x] Update main deployment script to remove boolean success handling
- [x] Check other deployment files for similar patterns

## Summary of Changes Made

### Fixed Files:
1. **`typescript/dlend/setup-oracle.ts`**:
   - Removed boolean return values from `setupRedstoneCompositeFeedsForAssets` and `setupRedstoneSimpleFeedsForAssets`
   - Removed `allSuccessful` tracking variables
   - Changed `continue` statements to `throw` statements on errors
   - Removed try-catch around sanity checks to let errors bubble up

2. **`deploy/12_dlend_weth_sceth_wstksceth_reserves/01_setup_chainlink_price_feeds.ts`**:
   - Removed `overallSuccess` tracking
   - Removed boolean combining logic with `&&` operators
   - Let setup functions throw errors directly

3. **`deploy/06_dlend_wstkscusd_reserve/00_setup_wstkscusd_chainlink_price_feed.ts`**:
   - Changed `return false` on errors to `throw new Error()`

4. **`deploy/12_dlend_weth_sceth_wstksceth_reserves/02_add_reserves.ts`**:
   - Removed try-catch that returned false on errors
   - Let `setupInitialReserves` throw errors directly

5. **`deploy/06_dlend_wstkscusd_reserve/01_add_wstkscUSD_reserve.ts`**:
   - Removed try-catch that returned false on errors
   - Let `setupInitialReserves` throw errors directly

### Files Checked (No Changes Needed):
- `deploy/01_ds_ecosystem/03_setup_s_redstone_oracle_wrappers.ts` - Already correct
- `deploy/02_dusd_ecosystem/02_setup_usd_redstone_oracle_wrappers.ts` - Already correct
- `deploy/05_dlend_odos_adapters/01_add_odos_swap_adapters.ts` - Valid early exit pattern
- `deploy/04_assign_roles_to_multisig/04_transfer_oracle_wrapper_roles_to_multisig.ts` - Valid early exit pattern

## Result
All dangerous "partial success" patterns have been eliminated. Deployments now fail fast on any error, preventing inconsistent states and forcing developers to fix issues before proceeding. 