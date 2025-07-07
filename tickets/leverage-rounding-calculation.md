# TASK ‑ Round-up leverage calculation to prevent residual-debt DoS

## Background
We currently compute leverage and subsidy values in **basis-points (1 bp = 1 / 10 000 ≈ 0.01 %)** and use Solidity’s integer division which *truncates* toward zero.  Any fractional remainder is lost.

Example that triggers a failure (see Issue #306):
* Collateral = `120e18`
* Debt = `80.001e18`
* True leverage ≈ `3.000075002×` → `30000.75002 bp`
* We store `30000 bp`.

When the first depositor exits, parity errors leave ≈ 0.001 debt outstanding.  The second depositor can no longer exit because `_repayDebtToPool` leaves non-zero debt, so withdrawing the remaining collateral violates Aave’s HF check.

## Objective
Eliminate the downward-rounding error by **rounding leverage *up* instead of down** (ceiling division) whenever it is converted to basis-points.  That guarantees users repay *at least* their fair share of debt and that the vault remains over-collateralised.

## Deliverables
1. Replace every division of the form `A * ONE_HUNDRED_PERCENT_BPS / B` with a safe-math helper that performs **ceiling division**.
   * Introduce `MathUtils.ceilDiv256(uint256 x, uint256 y)` or reuse an existing lib.
2. Audit all files that read or write `leverageBps` or `subsidyBps`, especially in `contracts/vaults/dloop/core/DLoopCoreBase.sol`, and migrate them to the new helper.
3. Unit tests:
   * Reproduce the scenario from Issue #306 and show that after the change both users can withdraw completely.
   * Property test: for any `(C, D)` with `C ≥ D`, calculated leverage must satisfy `C/(C-D) ≤ leverageBps/10 000 < C/(C-D) + 1 bp` (i.e. no downward error).
4. Update any docs that mention leverage precision.

## Acceptance Criteria
* No existing tests fail.
* New tests demonstrating the fix pass.
* Gas increase is < 0.5 % per increase/decreaseLeverage call.

---
**Priority:** Medium
**Labels:** `needs-fix`, `needs-test`, `precision`, `dloop` 