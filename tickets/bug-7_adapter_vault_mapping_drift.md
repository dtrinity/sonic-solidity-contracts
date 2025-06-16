# Bug #7 – Adapter / Vault Mapping Drift Freeze

## Status
Open – Needs design & implementation

## Contracts / Modules Affected
- `DStakeCollateralVault`
- `DStakeRouterDLend`
- `IDStakeCollateralVault` interface (and any other router / vault variants)

## Severity
**High** – Denial-of-service that can permanently block user withdrawals and, by extension, redemptions of the dSTAKE token.

## Summary
`DStakeCollateralVault` stores its own `adapterForAsset` mapping while `DStakeRouterDLend` stores a **separate** `vaultAssetToAdapter` mapping.  These mappings are expected to remain identical but are **updated independently via different admin functions**.  If either mapping is modified without mirroring the change on the other contract, the system becomes inconsistent and user actions revert.

### Example failure flow
1. Governance removes an adapter from the **vault** (`removeAdapter` on `DStakeCollateralVault`).
2. The same adapter is **not** removed on the router.
3. `DStakeRouterDLend.withdraw()` succeeds in the router's pre-checks, then calls `collateralVault.sendAsset()`.
4. `sendAsset()` reverts with `AssetNotSupported`, freezing withdrawals for every user whose deposit relies on that adapter.

The opposite order (router first, vault unchanged) causes the router to revert with `AdapterNotFound` and has the same DoS effect.

## Root Cause
The system keeps **two authoritative sources** for the same piece of state (vault-asset → adapter address).  There is no synchronisation mechanism or invariant check that guarantees they stay aligned, so an incomplete governance action can permanently diverge them.

## Proposed Remediation
Create a **single source of truth** for the mapping and make the other contract a thin view.

Option A (recommended – matches existing recommendation): Router authoritative
* Keep `vaultAssetToAdapter` mapping in `DStakeRouterDLend` only.
* Expose a `getAdapterForAsset(address) external view returns (address)` helper.
* In `DStakeCollateralVault`:
  * Remove the `adapterForAsset` state variable.
  * Replace any direct reads with `router.getAdapterForAsset(asset)` (or the public mapping getter).
  * Deprecate `addAdapter/removeAdapter` functions; governance should call the router only.
* Update `totalValueInDStable()` and `sendAsset()` to rely on the router for adapter look-ups.
* Adjust `IDStakeCollateralVault` to either:
  * expose a passthrough view `adapterForAsset` that forwards to the router, or
  * drop the view entirely and migrate callers.

Option B (alternative): Vault authoritative – inverse of A.

## Migration / Backwards Compatibility
A one-time migration script will:
1. Enumerate existing mappings on both contracts.
2. Assert they are identical – if not, abort and ask governance to reconcile.
3. Initialise the new single mapping with the reconciled data.
4. Disable/deprecate the redundant admin functions.

## Testing Plan
- Unit test that adapter add/remove through the single entry point immediately affects both router behaviour and vault valuation.
- Fuzz or invariant test: after any sequence of `addAdapter`/`removeAdapter` calls via governance, deposits and withdrawals must never revert with `AdapterNotFound` or `AssetNotSupported`.
- Regression test reproducing the original DoS scenario on old code and showing it is impossible on the patched version.

## References
Internal Bug Report "bug#7 – Adapter / Vault mapping drift".

---
Owner: TBD
Priority: High
Target Release: vNext 