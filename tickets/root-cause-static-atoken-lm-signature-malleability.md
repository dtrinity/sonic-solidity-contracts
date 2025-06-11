# Root Cause Analysis – StaticATokenLM Meta-Tx Signature Malleability (High Severity)

Date: 2024-06-11

Related Finding: Smart Contract Audit Report 2024-06-11 — Finding 12

Severity: **HIGH**

Module / File: `contracts/vaults/atoken_wrapper/StaticATokenLM.sol`

## Summary

`metaDeposit()` and `metaWithdraw()` verify off-chain signatures with a raw call to `ecrecover` but **fail to enforce** the EIP-2 / EIP-2098 constraints on the `s` and `v` values (`s <= secp256k1n/2` and `v ∈ {27,28}`). As a result, every valid signature has a second, *malleable* form `(s' = n – s, v' = 27 ⨁ 1)` that is also accepted. Attackers can replay or front-run transactions with the alternate form, enabling denial-of-service or griefing scenarios where the original user's meta-transaction reverts due to state changes performed by the malleated twin.

## Technical Details

```132:154:contracts/vaults/atoken_wrapper/StaticATokenLM.sol
            require(
                depositor ==
                    ecrecover(digest, sigParams.v, sigParams.r, sigParams.s),
                StaticATokenErrors.INVALID_SIGNATURE
            );
```

(The same pattern appears again in `metaWithdraw()` around line ~170.)

* OpenZeppelin's `ECDSA.recover()` performs the extra `s`-range & `v` checks; using bare `ecrecover` does **not**.
* Because `nonces[depositor]` increments **before** the signature check, a malleated replay can be front-run to consume the nonce, causing the original transaction to revert (`INVALID_SIGNATURE`). Funds may remain locked until the user re-signs a new meta-tx.

## Root Cause

Developer opted for a gas-cheaper primitive (`ecrecover`) without replicating the full ECDSA validation open-sourced by OpenZeppelin, overlooking malleability considerations.

## Impact

* **Front-Running & DoS:** Attackers monitoring mempool can take a signed meta-tx, flip the signature to its malleable pair, and submit it with higher gas.
    * User's original tx will fail due to nonce mismatch, leading to stuck UX or potential loss if deposit parameters were tailored for a specific block state.
* **Replay Across Systems:** If other chains or contracts share the same domain separator (unlikely but possible in test deployments), the malleated signature may be used elsewhere.

## Suggested Remediation

1. Replace custom `ecrecover` logic with `address recovered = ECDSA.recover(digest, v, r, s);` which guards against malleability.
2. Alternatively, retain `ecrecover` but add explicit checks:
   * `require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);`
   * `require(v == 27 || v == 28);`
3. Add unit tests that craft a valid `(r,s,v)` pair and its malleated twin to ensure only one is accepted.

## Test Vector (pseudo-code)

```
(sig.r, sig.s, sig.v)  = sign(metaDepositHash, privKey)
(sigMal.r, sigMal.s, sigMal.v) = (sig.r, N - sig.s, sig.v ^ 1)

sendTransaction(metaDeposit, sigMal)  // should succeed pre-fix, revert post-fix
sendTransaction(metaDeposit, sig)     // should revert pre-fix (nonce used), succeed post-fix
``` 