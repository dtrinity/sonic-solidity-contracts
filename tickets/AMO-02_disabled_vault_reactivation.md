# Ticket: AMO-02 – Disabled Vaults Can Be Reactivated via `transferFromAmoVaultToHoldingVault`

**Severity:** Medium

**Component:** `AmoManager.sol`

## Problem Statement
The AMO Manager tracks collateral vaults and their active status. Governance may *disable* a vault (e.g., due to risk). However the function
```solidity
function transferFromAmoVaultToHoldingVault(address vault, address token, uint256 amount) external onlyOwner {
    // ...
    _transferFromAmoVaultToHoldingVault(vault, token, amount);
}
```
contains a comment *"this will re-activate the vault"* but performs no explicit status check.  Internally the helper marks the vault as active when collateral is moved back to the holding vault.

An attacker compromising the owner, or a governance blunder, could unintentionally or maliciously **reactivate a vault that was deliberately disabled**, bypassing community safeguards.

## Impact
• Reactivation of unsafe or deprecated vaults without explicit governance vote.
• Exposure to collateral loss if the vault was disabled due to security flaws.
• Undermines transparency – observers may assume vault remains disabled.

## Suggested Remediation
1. **Require Vault Active Flag:**
   - Modify the function to `require(isVaultActive[vault], "VaultInactive");` or similar.
   - Perform reactivation via a dedicated `reactivateVault()` governance‐timelocked function.
2. Emit a **ReactivateVault** event when status changes, ensuring clear audit trail.
3. Update unit/integration tests to cover:
   - Attempted transfer from inactive vault reverts.
   - Explicit reactivation path succeeds only after timelock.
4. Consider **two-step process**: governance proposal schedules reactivation, executed after delay, aligning with other config changes.

## Acceptance Criteria
- [ ] Inactive vault cannot be implicitly re-enabled by fund transfer.
- [ ] Reactivation requires explicit, time-delayed governance action.
- [ ] Events emitted for status changes.
- [ ] Backwards-compatible migrations/scripts provided.

## References
- OpenZeppelin TimelockController: [Delayed Governance Actions](https://docs.openzeppelin.com/contracts/4.x/governance) 