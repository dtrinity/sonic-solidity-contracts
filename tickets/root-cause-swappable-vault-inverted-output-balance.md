# Root Cause Analysis – SwappableVault: Inverted Output Balance Check (High Severity)

Date: 2024-06-11

Related Finding: Smart Contract Audit Report 2024-06-11 — Finding 1

Severity: **HIGH**

Module / File: `contracts/common/SwappableVault.sol`

## Summary

The balance-sanity logic in `_swapExactOutput` is inverted. After a successful exact-output swap the vault's balance of the output token **increases**, but the code currently expects it to **decrease** and therefore executes the revert path on every honest swap, rendering every inheriting vault unusable.

## Technical Details

```88:122:contracts/common/SwappableVault.sol
        // Make sure the received output token amount is exactly the amount out
        if (outputTokenBalanceAfter < outputTokenBalanceBefore) {
            uint256 receivedOutputTokenAmount = outputTokenBalanceBefore -
                outputTokenBalanceAfter;
            if (receivedOutputTokenAmount != amountOut) {
                revert ReceivedOutputTokenAmountNotEqualAmountOut(
                    receivedOutputTokenAmount,
                    amountOut
                );
            }
        } else {
            revert OutputTokenBalanceNotIncreasedAfterSwap(
                outputTokenBalanceBefore,
                outputTokenBalanceAfter
            );
        }
```

* `outputTokenBalanceAfter` should be **greater** than `outputTokenBalanceBefore` when the contract receives the tokens resulting from the swap.
* Because the comparison is reversed (`<` instead of `>`), the `else` branch is taken and the custom error `OutputTokenBalanceNotIncreasedAfterSwap` is thrown, denying service to every caller.

## Root Cause

A copy-paste / logic inversion slipped through code-review. The developer mirrored the pattern used for the input-token (which legitimately *decreases*) without adjusting the comparator for the output-token (which *increases*).

## Impact

All contracts that inherit `SwappableVault` and rely on `_swapExactOutput` will **revert 100 % of the time**, blocking minting, redemption, or strategy functions that depend on swaps. Funds are not directly lost but are permanently locked behind an uncallable code-path (Denial-of-Service, SWC-113).

## Suggested Remediation

1. Replace the comparison with `outputTokenBalanceAfter > outputTokenBalanceBefore`.
2. Compute `receivedOutputTokenAmount = outputTokenBalanceAfter - outputTokenBalanceBefore`.
3. Add a unit-test that performs a nominal swap and asserts non-reversion.

## Test Vector (pseudo-code)

```
Given: vault holding 1000 DAI, wants exactly 1 ETH
When : call _swapExactOutput(DAI, ETH, amountOut = 1 ETH …)
Then : function returns without revert and vault ETH balance increases by 1
``` 