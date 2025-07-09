# Issue 332 – Replace naive `a * b / c` math with `Math.mulDiv` to prevent 256-bit overflow

## Context
Recent analysis of the DStakeToken withdrawal-fee calculation (see GitHub issue 332) highlighted that several places in the codebase still perform **multiply-then-divide** operations in plain 256-bit arithmetic.  When the first multiplicand can be supplied by an attacker (e.g. `type(uint256).max`) this pattern can overflow and revert, violating ERC-4626 preview guarantees and potentially locking user funds.

The OpenZeppelin `Math.mulDiv(x, y, denominator)` helper performs the same operation using a full 512-bit intermediate product, eliminating that risk.  We should migrate every vulnerable instance to `mulDiv`.

## Scope – files & lines to update
(The list was produced with a repo-wide grep for `* … /`, followed by manual inspection; line numbers refer to the current `hats/332` branch.)

| Contract                                                                            | Instance(s)                                                                                                                                                                                                      | Why it is unsafe                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `contracts/common/SupportsWithdrawalFee.sol`                                        | `_calculateWithdrawalFee`, `_getGrossAmountRequiredForNet`                                                                                                                                                       | Multiplying user-supplied asset amount by `withdrawalFeeBps_` (up to 1 000 000) before the divide. |
| `contracts/dstable/RedeemerWithFees.sol`                                            | `dstableAmountToBaseValue` and fee calculations in `redeem()`                                                                                                                                                    | Multiplication by `BASE_UNIT` (1e8/1e18) and by `currentFeeBps`.                                   |
| `contracts/vaults/dloop/core/DLoopCoreBase.sol`                                     | `getLeveragedAssets`, `getUnleveragedAssets`, `getRepayAmountThatKeepCurrentLeverage`, `getBorrowAmountThatKeepCurrentLeverage`, plus several helper conversions that multiply price or decimals before dividing | All accept external amounts; multiply by leverage BPS or price constants before dividing.          |
| `contracts/vaults/dloop/periphery/DLoopDepositorBase.sol`                           | `_applySlippage`, `preview*` helpers where `(amount * (100% ± bps)) / 100%`                                                                                                                                      | User controlled `amount` times BPS.                                                                |
| `contracts/vaults/dloop/periphery/DLoopRedeemerBase.sol`                            | Same pattern as above.                                                                                                                                                                                           |
| `contracts/vaults/dpool/periphery/DPoolCurvePeriphery.sol`                          | `calculateMinAmount*` helpers use `(amount * (100% – slippage)) / 100%`.                                                                                                                                         |
| `contracts/testing/dex/SimpleDEXMock.sol`                                           | `_applyExecutionSlippage`, `_reverseExecutionSlippage`, and decimal normalisation helpers (`amount * 10 ** x`)                                                                                                   | Although used only in mocks, worth updating for completeness.                                      |
| `contracts/vaults/atoken_wrapper/RayMathExplicitRounding.sol`                       | `rayMul` & `rayDiv` (`(a * RAY) / b`)                                                                                                                                                                            | Multiplies by 1e27 constant – replace with `mulDiv` for safety.                                    |
| `contracts/dstable/*` (`CollateralVault.sol`, `AmoManager.sol`, etc.)               | Conversions using `(value * 10 ** decimals) / price`                                                                                                                                                             | Value can be large.                                                                                |
| `contracts/dstable/Redeemer.sol`                                                    | `dstableAmountToBaseValue` conversion (`(dstableAmount * BASE_UNIT) / 10 ** dstableDecimals`)                                                                                                                    | User-supplied `dstableAmount` multiplied by a large constant can overflow and block redemptions.   |
| `contracts/vaults/rewards_claimable/RewardClaimable.sol`                            | `getTreasuryFee` (`(amount * treasuryFeeBps) / ONE_HUNDRED_PERCENT_BPS`)                                                                                                                                         | Caller-controlled `amount` times BPS may overflow, halting reward compounding.                     |
| Any other spot matching `(<var> * BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) / …` | Same overflow vector.                                                                                                                                                                                            |

## Acceptance criteria
1. Every multiply-then-divide that can receive an untrusted 256-bit input is replaced by `Math.mulDiv` (or `mulDivRoundingUp` where appropriate).
2. All affected contracts compile against OZ ≥5.0 where `Math` resides.
3. Unit tests and fuzz tests pass with no behavioural change besides removal of overflow reverts.
4. Gas impact is negligible or documented.

## Suggested implementation steps
1. Import `using Math for uint256;` or `import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";` in each affected file.
2. Replace patterns:
   * `amount * feeBps / ONE_HUNDRED_PERCENT_BPS` → `Math.mulDiv(amount, feeBps, ONE_HUNDRED_PERCENT_BPS)`
   * `amount * 10 ** decimals / price` → `Math.mulDiv(amount, 10 ** decimals, price)`
3. Run `forge test` / `pnpm test` to verify.
4. Write regression test exercising `type(uint256).max` cases (should succeed instead of reverting).

---

Owner: @dtrinity-devs  
Priority: High (security hardening)  
Labels: `needs-fix`, `math`, `mulDiv` 