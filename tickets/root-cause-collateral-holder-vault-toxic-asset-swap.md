# Root Cause Analysis – CollateralHolderVault.exchangeCollateral Toxic-Asset Swap (High Severity)

Date: 2024-06-11

Related Finding: Smart Contract Audit Report 2024-06-11 — Finding 4

Severity: **HIGH**

Module / File: `contracts/dstable/CollateralHolderVault.sol`

## Summary

`exchangeCollateral()` validates only the *destination* collateral (`toCollateral`) against the whitelist, but omits the same check for the *source* token (`fromCollateral`). A malicious actor can therefore deposit **any** ERC-20, provided the oracle returns a (manipulated) price, and withdraw legitimate, whitelisted collateral of equal _oracle value_, draining the vault of good assets while leaving behind toxic or illiquid tokens that the system purposely does not account for.

## Technical Details

```32:48:contracts/dstable/CollateralHolderVault.sol
    function exchangeCollateral(
        uint256 fromCollateralAmount,
        address fromCollateral,
        uint256 toCollateralAmount,
        address toCollateral
    ) public onlyRole(COLLATERAL_STRATEGY_ROLE) {
        // We must take in a collateral that is supported
        require(
            _supportedCollaterals.contains(toCollateral),
            "Unsupported collateral"
        );
        uint256 maxAmount = maxExchangeAmount(
            fromCollateralAmount,
            fromCollateral,
            toCollateral
        );
```

The corresponding whitelist for `fromCollateral` is **missing**. As long as an oracle entry exists for `fromCollateral`, `maxExchangeAmount()` will happily compute a high USD value and allow the swap.

## Attack Scenario

1. Attacker manipulates (or flash-loans) the oracle price of a thin-liquidity token `SHITCOIN` to $1 000 000.
2. Calls `exchangeCollateral(1 SHITCOIN, from = SHITCOIN, toCollateralAmount = 900 000 USDC, to = USDC)`.
3. Check passes, vault releases 900 000 USDC; `SHITCOIN` is now stranded in the vault and ignored by collateral accounting because it is not in `_supportedCollaterals`.
4. System loses $900 000 in real collateral.

## Root Cause

Logic oversight: the developer assumed that only the token being *received* by the caller requires validation. However, with bilateral exchange functions both directions matter because value is flowing *out* of the vault.

## Impact

* **Direct economic loss** equal to the amount of supported collateral withdrawn minus any real market value of the toxic asset deposited.
* Collateral metrics become inaccurate, potentially breaking invariants checked elsewhere.

## Suggested Remediation

1. Require **both** `fromCollateral` *and* `toCollateral` to be present in `_supportedCollaterals`.
2. Add slippage checks or TWAP median pricing to mitigate oracle manipulation.
3. Add unit-tests that try exchanging with an unsupported `fromCollateral` and expect a revert.

## Test Vector (pseudo-code)

```
Supported: {USDC}
SHITCOIN oracle price skewed to $1 000 000.

expectRevert:
  exchangeCollateral(1e18 SHITCOIN, SHITCOIN, 900_000e6 USDC, USDC)
``` 