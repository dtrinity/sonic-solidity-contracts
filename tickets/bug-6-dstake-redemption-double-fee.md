# Ticket: Bug #6 – DStakeToken redeem() charges withdrawal fee twice

**Status:** Open

## Summary
`DStakeToken.redeem()` returns fewer assets than `previewRedeem()` predicts when a withdrawal fee is configured. The net assets transferred to the user are reduced by the fee **two times**.

## Steps to Reproduce
1. Deploy/mint a `DStakeToken` with a positive withdrawal fee (e.g. 1 % = 10 000 BPS according to `BasisPointConstants`).
2. A user deposits _x_ dSTABLE via `deposit()` → receives shares _s_.
3. The user calls `previewRedeem(s)` – it shows _x_ − fee as the return value.
4. The user calls `redeem(s, …)` – the actual balance increase is **_x_ − 2 × fee**.

A minimal Hardhat test reproducing the issue lives at `test/dstake/RedeemDoubleFee.ts` (see attached PR/branch).

## Root Cause Analysis
OpenZeppelin's `ERC4626Upgradeable` is designed so that:
* `redeem()` → `previewRedeem()` → calls internal `_withdraw(assets, shares)` where **`assets` is expected to be the *net* amount actually delivered to the receiver**.

`DStakeToken` overrides only two pieces:
* `previewRedeem()` – returns *net* assets (`_getNetAmountAfterFee`). ✅
* `_withdraw()` – *expects `assets` to be the **gross** amount*, calculates the fee again and transfers the remainder. ❌

Because `redeem()` passes the already-net `assets` value into `_withdraw()`, `_withdraw()` deducts the fee a second time, resulting in the observed shortfall.

`withdraw()` does not suffer from this bug because it is fully re-implemented to translate the net `assets` input to the gross amount before calling `_withdraw()`.

## Impact
Users calling `redeem()` lose an extra `withdrawalFeeBps` proportion of their assets. For a 1 % fee they lose ~2 % of their position.

## Proposed Fix
Adopt the same pattern used in `withdraw()` for the redeem path:
1. **Override `redeem()`** so that it:
   * Computes `grossAssets = convertToAssets(shares)`.
   * Calls internal `_withdraw(caller, receiver, owner, grossAssets, shares)`.
   * Returns the *net* assets `netAssets = _getNetAmountAfterFee(grossAssets)`.

```solidity
function redeem(
    uint256 shares,
    address receiver,
    address owner
) public virtual override returns (uint256 assets) {
    uint256 grossAssets = convertToAssets(shares); // shares → assets before fee
    _withdraw(_msgSender(), receiver, owner, grossAssets, shares);
    assets = _getNetAmountAfterFee(grossAssets);   // value effectively received
    return assets;
}
```

2. **Unit test**: extend the failing test so it passes after the fix (received amount equals `previewRedeem()`).

## Tasks
- [x] Implement `redeem()` override in `DStakeToken.sol` as above.
- [x] Add/adjust unit test `RedeemDoubleFee.ts` to assert equality between `previewRedeem()` and actual received assets.
- [ ] Run full test suite & slither to ensure no regressions.
- [ ] Deploy upgraded DStakeToken if live contracts are affected.

---
*Created automatically by o3-assistant.* 