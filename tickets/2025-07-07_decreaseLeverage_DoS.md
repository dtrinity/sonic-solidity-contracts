# DoS in `increaseLeverage()` / `decreaseLeverage()` caused by external token transfers

## Context / Problem Statement

The `DLoopCoreBase.decreaseLeverage()` path relies on
`_getRequiredDebtTokenAmountToRebalance()` which **adds the vault’s current
`debtToken.balanceOf(address(this))` to the caller-supplied
`additionalDebtTokenAmount`**:

```solidity
uint256 debtTokenBalanceInVault = debtToken.balanceOf(address(this));
return debtTokenBalanceInVault + additionalDebtTokenAmount;
```

⚠️  **Important nuance:** the ERC-20 `debtToken` (dUSD) that sits in the
vault is *not* the same thing as Aave’s non-transferable
`VariableDebtToken` that records the protocol’s outstanding debt.  Therefore
sending extra dUSD to the vault does **not** change the debt balance tracked
by Aave or counted in leverage calculations.

What it *does* change is the *repayment quota* computed above.  Because the
helper blindly assumes every dUSD held by the vault must be used for debt
repayment, a malicious donation inflates the required repayment amount used
later in the leverage simulation.

An attacker can front-run or grief the system by transferring arbitrary
amounts of dUSD to the vault, inflating `debtTokenBalanceInVault`.  When a
keeper subsequently calls `decreaseLeverage()`, the function simulates
repaying this exaggerated amount; the computed `newLeverageBps` drops **below**
`targetLeverageBps`, triggering `DecreaseLeverageOutOfRange` and reverting the
transaction.

The vault has no mechanism to sweep or refund these unsolicited tokens, so the
attack results in a **permanent denial-of-service** until governance
intervenes with a rescue or upgrade.

## Severity
High – DoS of a core rebalancing function puts the vault at liquidation risk
if leverage cannot be reduced when needed.

## Reproduction Steps (Hardhat / Foundry)
1. Deploy a concrete `DLoopCore*` vault with leverage > `targetLeverageBps`.
2. Attacker executes `debtToken.transfer(vault, X)` where `X` ≫ normal
   repayment amounts.
3. Keeper attempts `decreaseLeverage(required, 0)`.
4. Call reverts with `DecreaseLeverageOutOfRange`, blocking all further
   deleveraging.

## Suggested Remedy
* **Do not automatically use the vault’s passive debt-token balance when
  computing `requiredDebtTokenAmount`.**  Instead:
  * Calculate the theoretical debt amount needed to reach the target leverage
    (via `_getDebtTokenAmountToReachTargetLeverage`).
  * Set `requiredDebtTokenAmount` to **`max(calculated, additionalDebtTokenAmount)`**;
    i.e. ignore any excess balance that is already in the vault.
  * Treat unsolicited tokens as donations that *reduce protocol debt* once a
    valid deleverage call is made, **but never allow them to push leverage
    below the target**.

Alternative: impose an upper-bound cap so that
`newLeverageBps >= targetLeverageBps` is always enforced *before* the
`DecreaseLeverageOutOfRange` check, refunding the surplus to the caller if
necessary.

### Implementation To-Dos
- [ ] Refactor `_getRequiredDebtTokenAmountToRebalance()` to exclude
      `debtTokenBalanceInVault` from the required amount, or to cap the value
      such that the post-reduction leverage cannot fall below target.
- [ ] Add/extend unit tests:
  - [ ] **Grief-token** scenario: extra tokens in vault must *not* revert
        deleverage.
  - [ ] Normal path still behaves identically (no regression).
- [ ] Consider helper to intentionally *donate* excess debt-tokens and call a
      new `processDebtDonations()` that repays debt without violating
      leverage bounds (nice-to-have).
- [ ] Run slither & mythril static-analysis to confirm issue is fixed.
- [ ] Update relevant documentation (vault design docs & README).

## References
* Internal source: `contracts/vaults/dloop/core/DLoopCoreBase.sol` lines
  ~1370-1386.
* Original bug report: <https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/302>

## Parallel Exploit: DoS in `increaseLeverage()` via external collateral-token transfers

### Context / Problem Statement

`increaseLeverage()` suffers from the **mirror-image bug** discussed above, but on the collateral side.  Its helper
`_getRequiredCollateralTokenAmountToRebalance()` naïvely does:

```solidity
uint256 collateralTokenBalanceInVault = collateralToken.balanceOf(address(this));
return collateralTokenBalanceInVault + additionalCollateralTokenAmount;
```

Any user can grief the vault by donating arbitrary amounts of the collateral ERC-20 (e.g. WETH).  These unsolicited
funds do **not** affect the borrower’s accounting inside Aave, yet the helper assumes the entire balance must be
supplied in the upcoming leverage operation.  When a keeper calls `increaseLeverage()`, the simulated post-action
leverage shoots **above** `targetLeverageBps`, so the function reverts with `IncreaseLeverageOutOfRange`.

The vault lacks a mechanism to burn or refund the stray collateral, rendering `increaseLeverage()` unusable until
governance intervenes.

### Severity
High – Denial-of-service of the opposite rebalancing direction; together with the debt-token variant it can freeze
both leverage adjustments entirely.

### Reproduction Steps (Hardhat / Foundry)
1. Deploy a `DLoopCore*` vault whose leverage is **below** `targetLeverageBps`.
2. Attacker executes `collateralToken.transfer(vault, X)` where `X` is large.
3. Keeper attempts `increaseLeverage(required, 0)`.
4. Call reverts with `IncreaseLeverageOutOfRange`, blocking all further lever-ups.

### Suggested Remedy
* Apply the *same* fix pattern: ignore or cap unsolicited collateral when computing `requiredCollateralTokenAmount` so
  the simulated leverage can **never** exceed `targetLeverageBps`.
* Recommended implementation: make both `_getRequiredDebtTokenAmountToRebalance()` and
  `_getRequiredCollateralTokenAmountToRebalance()` return `max(calculated, additionalAmount)` rather than summing the
  vault’s token balance.

### Additional To-Dos
- [ ] Unit test the collateral-token grief scenario.
- [ ] Ensure shared helper logic covers both paths without regression.

## References (additional)
* Internal source: `contracts/vaults/dloop/core/DLoopCoreBase.sol` lines ~1320-1336.
* Original bug report: <https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/303>

---
Owner: TBD  
Priority: P1  
Labels: security, DoS, needs-fix, needs-test 