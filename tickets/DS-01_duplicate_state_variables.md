# Ticket: DS-01 – Duplicate State Variables Collide with OpenZeppelin Storage

**Severity:** High

**Component:** `ERC20StablecoinUpgradeable.sol`

## Problem Statement
`ERC20StablecoinUpgradeable` declares the following state variables:
```solidity
string private _name;
string private _symbol;
```
These storage slots already exist in the parent contract `ERC20Upgradeable`.  Redeclaring them causes the compiler to **reuse the same storage locations** for the new variables, resulting in:
1. In-memory / view functions reading the *child* variables while other inherited logic (e.g., `ERC20Upgradeable::_mint`) continues to read the *parent* variables.
2. Silent corruption of important metadata (`name`, `symbol`) across upgrades or even at initial deployment if the contract is proxy-deployed.
3. Increased risk that future upgrades accidentally overwrite additional OpenZeppelin storage slots, bricking the token or blocking further upgrades.

Because the issue is fundamental to the storage layout, it **cannot be fixed retro-actively** once the contract is deployed.  Immediate remediation is required before main-net deployment.

## Impact
• Incorrect metadata visible to wallets & explorers.
• Potential storage collisions in later upgrades, leading to corrupted balances or total supply.
• Proxy upgrade may fail at runtime, halting the token's mint / transfer functionality.

## Suggested Remediation
1. **Remove the duplicate declarations** and rely on `ERC20Upgradeable`'s internal `_name` and `_symbol` variables.
2. If custom behaviour is absolutely required, rename the new variables (e.g., `private _customName`) and override the public `name()` / `symbol()` getters to use them.
3. Add a unit test that deploys via proxy, calls `name()` / `symbol()`, and confirms values match constructor inputs.
4. Guard future upgrades with the **OpenZeppelin Storage Gap** pattern and Slither's `storage-layout` detector during CI.

## Acceptance Criteria
- [ ] Contract compiles without duplicate variable warnings on `solc 0.8.x`.
- [ ] Unit test verifies correct `name` and `symbol` after proxy deployment.
- [ ] Slither `storage-order` / `storage-shadowing` detectors pass.
- [ ] README updated to document storage-layout discipline.

## References
- OpenZeppelin Docs: Upgrades – [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable)
- Solidity docs: [Inheritance and Storage Layout](https://docs.soliditylang.org/en/v0.8.20/contracts.html#storage-inheritance) 