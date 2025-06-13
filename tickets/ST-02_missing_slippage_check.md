# Ticket: ST-02 – Deposit Path Lacks Slippage Check in `DStakeRouterDLend`

**Severity:** Medium

**Component:** `DStakeRouterDLend.sol`

## Problem Statement
`DStakeRouterDLend.deposit()` converts the user's `dStable` into `vaultAsset` via an external adapter:
```solidity
uint256 received = IAdapter(adapter).convertToVaultAsset(dStableAmount);
// no verification of `received` vs expectation
```
No assertion verifies that `received` meets an acceptable **minimum output**. If the adapter misprices (bug), is malicious, or an oracle/manipulation event skews exchange rates, the router will under-deposit collateral while still crediting full shares to the user.

## Impact
• Users' deposits credited at a favourable rate, diluting other vault participants.
• Potential under-collateralisation of dStable backing.
• Attackers can profit by exploiting discrepancy repeatedly.

## Suggested Remediation
1. Add a view helper `previewConvertToVaultAsset(dStableAmount)` (already exists in some adapters) and require:
   ```solidity
   uint256 minExpected = previewConvertToVaultAsset(dStableAmount);
   require(received >= minExpected * (BPS - maxSlippageBps) / BPS, "SlippageExceeded");
   ```
2. `maxSlippageBps` should be configurable per asset pair by governance; default 100 (1 %).
3. Emit an event `DepositSlippage` logging parameters.
4. Unit tests:
   - Normal path within slippage passes.
   - Path with under-delivery reverts.
   - Governance can update `maxSlippageBps`.

## Acceptance Criteria
- [ ] Slippage check implemented with configurable threshold.
- [ ] Tests cover pass/fail scenarios.
- [ ] Event emitted on successful deposit.
- [ ] Docs updated with guidance on slippage parameter tuning.

## References
- Uniswap V3 Router `exactInput` minAmount pattern. 