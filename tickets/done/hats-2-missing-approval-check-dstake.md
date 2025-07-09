# Ticket: Missing allowance check in `DStakeToken._withdraw`

## Status
in-progress

## Summary
The private `_withdraw` function in `contracts/vaults/dstake/DStakeToken.sol` lacks an allowance check between `caller` and `owner`. This omission allows any address to withdraw or redeem another user’s shares without having been granted approval, provided they specify that user as the `owner` parameter and an attacker-controlled `receiver`.

## Verified Root Cause
```205:215:contracts/vaults/dstake/DStakeToken.sol
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets, // This is now the GROSS amount
        uint256 shares
    ) internal virtual override {
        if (
            address(router) == address(0) ||
            address(collateralVault) == address(0)
        ) {
            revert ZeroAddress(); // Router or Vault not set
        }

        uint256 fee = _calculateWithdrawalFee(assets); // <-- no caller/allowance check before burning
        // ... existing code ...
```

Contrast with `DPoolVaultLP` which performs the necessary allowance enforcement:
```256:270:contracts/vaults/dpool/core/DPoolVaultLP.sol
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 grossLpAmount,
        uint256 shares
    ) internal virtual override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        // ... existing code ...
```

Because `DStakeToken._withdraw` never validates that `caller == owner` **or** that the caller has been granted allowance via `approve`, any external account can transfer away a victim’s shares and receive the underlying assets.

## Impact
High – full unauthorized liquidation of user positions in the DStake vault.

## Other Locations Reviewed
A project-wide grep for `function _withdraw(` revealed four other custom implementations. All of them include an explicit allowance or `msg.sender` check:

1. `DPoolVaultLP` – safe (`_spendAllowance`).
2. `DLoopCoreBase` – safe (`_spendAllowance`).
3. `StaticATokenLM` – safe (updates `allowance` when `msg.sender != owner`).
4. `CollateralVault` – not ERC4626 based; withdrawals gated by `COLLATERAL_WITHDRAWER_ROLE`.

No additional instances lacking the check were identified.

## Next Steps (implementation to be done separately)
- Add allowance logic to `DStakeToken._withdraw` mirroring `DPoolVaultLP`.
- Introduce regression test that ensures unauthorized withdrawals revert (the PoC supplied in the Hats issue).
- Review any future vault contracts for the same pattern.

---
Generated from Hats issue https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/2 