# Audit Scope (LLM-Optimized)

## ✅ In-Scope Contracts

### dStable (8 contracts)
```
contracts/dstable/
├── ERC20StablecoinUpgradeable.sol  # UUPS, mint/burn
├── Issuer.sol                      # Entry: issue()
├── Redeemer[WithFees].sol         # Entry: redeem()
├── CollateralVault.sol            # Base vault
├── CollateralHolderVault.sol      # Collateral logic
├── AmoManager.sol                 # AMO control
└── AmoVault.sol                   # AMO vault
```
**Key Risks**: Oracle manipulation, admin powers, AMO losses

### dStake (6 contracts)
```
contracts/vaults/dstake/
├── DStakeToken.sol                # ⚠️ KNOWN: withdrawal bug
├── DStakeCollateralVault.sol      # Collateral mgmt
├── DStakeRouterDLend.sol         # Router pattern
├── DStakeRewardManagerDLend.sol  # Rewards
└── adapters/*.sol                # Trust boundary
```
**Key Risks**: Router bypass, surplus extraction, adapter trust

### dLoop (15+ contracts)
```
contracts/vaults/dloop/
├── base/                         # Core leverage
├── periphery/                    # User entry
├── venues/dlend/                # Flash loans
└── venues/odos/                 # Swaps
```
**Key Risks**: Leverage precision, flash loan attacks, MEV

### dPool (3 contracts)
```
contracts/vaults/dpool/
├── DPoolVaultLP.sol             # LP vault
├── DPoolCurvePeriphery.sol      # Curve integration
└── DPoolCurveGauge.sol         # Gauge logic
```
**Key Risks**: LP manipulation, Curve integration

### Oracle Aggregator (10+ contracts)
```
contracts/oracle_aggregator/
├── OracleAggregatorV2.sol       # Main aggregator
├── oracles/                     # API3, Chainlink, Redstone
└── wrappers/                    # Composite wrappers
```
**Key Risks**: Price manipulation, staleness, decimal errors

### Common & External
```
contracts/common/               # Utilities
contracts/odos/                # Swap integration
contracts/pendle/              # Yield tokens
```

## ❌ Out-of-Scope

- `bot/` - Liquidation bots
- `contracts/dlend/` - Aave fork
- `contracts/mocks/` - Test contracts
- `contracts/testing/` - Test helpers

## 🔗 Critical Dependencies

### Oracle → Everything
All modules depend on oracle prices. Manipulation = systemic failure.

### Module Interactions
```
dStable ← uses → dStake (as collateral)
dStake ← integrates → dLend (for yield)
dLoop ← uses → dLend (flash loans) + Odos (swaps)
dPool ← integrates → Curve
```

### Admin Controls
- Most contracts have `DEFAULT_ADMIN_ROLE`
- No timelocks observed
- Single point of failure

## 🎯 Audit Priorities

1. **Oracle Security** - Affects all modules
2. **Cross-Module Attacks** - Cascading failures
3. **Admin Privilege Abuse** - No timelocks
4. **Economic Exploits** - Flash loans, MEV
5. **Integration Risks** - External protocols