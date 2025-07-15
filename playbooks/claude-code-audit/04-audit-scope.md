# dTRINITY Protocol Security Audit Scope Document

## Overview

This document defines the security audit scope for the dTRINITY Protocol on Sonic blockchain. The protocol consists of multiple interconnected DeFi modules providing stablecoin issuance, lending, leveraged yield farming, staking, and liquidity management functionality.

## Audit Scope Summary

### In-Scope Modules
1. **dStable** - Decentralized stablecoin system
2. **dStake** - ERC4626-based staking vaults
3. **dLoop** - Leveraged yield farming
4. **dPool** - Liquidity pool management
5. **Oracle Aggregator** - Multi-source price feed system
6. **Common** - Shared utilities and base contracts
7. **External Integrations** - Odos and Pendle integrations

### Out-of-Scope
1. **bot/** - All liquidation bot contracts and scripts
2. **contracts/dlend/** - Entire Aave v3 fork (audited separately)
3. **contracts/testing/** - All test contracts and mocks
4. **contracts/mocks/** - All mock implementations
5. **contracts/vaults/atoken_wrapper/** - Static AToken wrapper (external dependency)

---

## Module 1: dStable - Stablecoin System

### Core Contracts (In-Scope)
```
contracts/dstable/
├── ERC20StablecoinUpgradeable.sol      # Main stablecoin implementation
├── Issuer.sol                          # Minting mechanism
├── Redeemer.sol                        # Basic redemption logic
├── RedeemerWithFees.sol                # Redemption with fee handling
├── CollateralVault.sol                 # Collateral management vault
├── CollateralHolderVault.sol           # Collateral holding logic
├── AmoManager.sol                      # Automated Market Operations manager
├── AmoVault.sol                        # AMO vault implementation
└── OracleAware.sol                     # Oracle integration base
```

### Entry Points
- `Issuer.issue()` - Mint stablecoins against collateral
- `Redeemer.redeem()` / `RedeemerWithFees.redeem()` - Burn stablecoins for collateral
- `AmoManager` administrative functions
- `CollateralVault` deposit/withdrawal functions

### Dependencies
- Oracle Aggregator (for price feeds)
- OpenZeppelin upgradeable contracts
- Common utilities

### Upgrade Pattern
- Uses OpenZeppelin's upgradeable proxy pattern
- `ERC20StablecoinUpgradeable` is the main upgradeable contract

---

## Module 2: dStake - Staking Vaults

### Core Contracts (In-Scope)
```
contracts/vaults/dstake/
├── DStakeToken.sol                     # ERC4626 staking token
├── DStakeCollateralVault.sol           # Collateral management
├── DStakeRouterDLend.sol               # dLend integration router
├── adapters/
│   └── WrappedDLendConversionAdapter.sol
├── rewards/
│   └── DStakeRewardManagerDLend.sol    # Reward distribution
└── interfaces/
    ├── IDStableConversionAdapter.sol
    ├── IDStakeCollateralVault.sol
    └── IDStakeRouter.sol

contracts/dstake/
└── DStakeProxyAdmin.sol               # Proxy administration
```

### Entry Points
- `DStakeToken.deposit()` / `mint()` - Stake assets
- `DStakeToken.withdraw()` / `redeem()` - Unstake assets
- `DStakeRouterDLend` routing functions
- `DStakeRewardManagerDLend.claimRewards()`

### Security Note
- **CRITICAL**: Active security issue in `tickets/in-progress/hats-2-missing-approval-check-dstake.md`
- Missing allowance check in `DStakeToken._withdraw` could allow unauthorized withdrawals

### Dependencies
- dLend protocol (for yield generation)
- ERC4626 standard implementation
- Common vault utilities

### Upgrade Pattern
- Uses proxy pattern with `DStakeProxyAdmin`
- Upgradeable implementation contracts

---

## Module 3: dLoop - Leveraged Yield Farming

### Core Contracts (In-Scope)
```
contracts/vaults/dloop/
├── core/
│   ├── DLoopCoreBase.sol              # Base implementation
│   └── venue/
│       ├── dlend/
│       │   └── DLoopCoreDLend.sol     # dLend venue implementation
│       └── mock/
│           └── DLoopCoreMock.sol      # Mock venue (exclude)
└── periphery/
    ├── DLoopDepositorBase.sol         # Deposit logic base
    ├── DLoopRedeemerBase.sol          # Redemption logic base
    ├── DLoopIncreaseLeverageBase.sol  # Leverage increase base
    ├── DLoopDecreaseLeverageBase.sol  # Leverage decrease base
    └── venue/
        └── odos/
            ├── DLoopDepositorOdos.sol
            ├── DLoopRedeemerOdos.sol
            ├── DLoopIncreaseLeverageOdos.sol
            ├── DLoopDecreaseLeverageOdos.sol
            └── OdosSwapLogic.sol
```

### Entry Points
- Depositor contracts: `deposit()` functions
- Redeemer contracts: `redeem()` functions
- Leverage contracts: `increaseLeverage()` / `decreaseLeverage()`
- Flash loan callbacks

### Dependencies
- dLend protocol (for leveraged positions)
- Odos router (for swapping)
- ERC3156 flash loan interfaces

### Venue System
- Modular architecture supporting multiple lending venues
- Currently supports dLend venue
- Mock venues should be excluded from audit

---

## Module 4: dPool - Liquidity Pool Management

### Core Contracts (In-Scope)
```
contracts/vaults/dpool/
├── core/
│   ├── DPoolVaultLP.sol               # LP token vault base
│   ├── DPoolVaultCurveLP.sol          # Curve-specific LP vault
│   └── interfaces/
│       ├── IDPoolVaultLP.sol
│       └── ICurveStableSwapNG.sol
└── periphery/
    ├── DPoolCurvePeriphery.sol        # Curve integration periphery
    └── interfaces/
        └── IDPoolPeriphery.sol
```

### Entry Points
- `DPoolVaultLP.deposit()` / `withdraw()`
- `DPoolCurvePeriphery` zap functions
- Reward claiming functions

### Dependencies
- Curve StableSwap NG pools
- Common vault utilities
- Reward distribution system

---

## Module 5: Oracle Aggregator

### Core Contracts (In-Scope)
```
contracts/oracle_aggregator/
├── OracleAggregator.sol               # Main aggregator contract
├── chainlink/
│   ├── ChainlinkCompositeAggregator.sol
│   └── ChainlinkDecimalConverter.sol
├── wrapper/
│   ├── API3Wrapper.sol
│   ├── API3WrapperWithThresholding.sol
│   ├── API3CompositeWrapperWithThresholding.sol
│   ├── RedstoneChainlinkWrapper.sol
│   ├── RedstoneChainlinkWrapperWithThresholding.sol
│   ├── RedstoneChainlinkCompositeWrapperWithThresholding.sol
│   ├── HardPegOracleWrapper.sol
│   └── ThresholdingUtils.sol
└── interface/
    ├── IOracleWrapper.sol
    ├── api3/
    │   ├── BaseAPI3Wrapper.sol
    │   └── IProxy.sol
    └── chainlink/
        ├── BaseChainlinkWrapper.sol
        ├── IAggregatorV3Interface.sol
        └── IPriceFeed.sol
```

### Entry Points
- `OracleAggregator.price()` functions
- Individual wrapper `latestAnswer()` calls

### Oracle Sources
- API3 data feeds
- Chainlink price feeds
- Redstone oracle integration
- Composite oracle support with thresholding

---

## Module 6: Common Utilities

### Core Contracts (In-Scope)
```
contracts/common/
├── BasisPointConstants.sol            # Basis point constants
├── Erc20Helper.sol                   # ERC20 utility functions
├── RescuableVault.sol                # Vault rescue functionality
├── SupportsWithdrawalFee.sol         # Withdrawal fee support
├── SwappableVault.sol                # Swappable vault base
└── IAaveOracle.sol                   # Oracle interface
```

### Key Functionality
- Shared constants and utilities
- Base vault implementations
- Fee handling mechanisms
- Token rescue functionality

---

## Module 7: External Integrations

### Odos Integration (In-Scope)
```
contracts/odos/
├── OdosSwapUtils.sol                  # Odos swap utilities
└── interface/
    └── IOdosRouterV2.sol             # Odos router interface
```

### Pendle Integration (In-Scope)
```
contracts/pendle/
├── PendleChainlinkOracleFactory.sol   # Oracle factory for Pendle
└── PendleSwapUtils.sol               # Pendle swap utilities
```

---

## External Dependencies

### Major External Protocols
1. **Aave V3 (dLend)** - Forked and modified lending protocol
2. **Curve Finance** - For liquidity pool management
3. **Odos** - DEX aggregator for optimal swapping
4. **Pendle** - Yield tokenization protocol
5. **OpenZeppelin** - Standard contract libraries

### Oracle Dependencies
1. **API3** - Decentralized API network
2. **Chainlink** - Price feed oracles
3. **Redstone** - Alternative oracle solution

---

## Integration Points Map

```
┌─────────────────┐
│    dStable      │
│  (Stablecoin)   │
└────────┬────────┘
         │ Collateral
         ▼
┌─────────────────┐     ┌─────────────────┐
│     dStake      │◄────│  Oracle Aggr.   │
│   (Staking)     │     │  (Price Feeds)  │
└────────┬────────┘     └────────┬────────┘
         │ Deposits              │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│     dLend       │◄────│     dLoop       │
│   (Lending)     │     │  (Leveraged)    │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │      Odos       │
                        │  (Swapping)     │
                        └─────────────────┘
```

---

## Access Control Patterns

### Common Roles
- `DEFAULT_ADMIN_ROLE` - Protocol administration
- `PAUSER_ROLE` - Emergency pause functionality
- Module-specific roles (e.g., `ISSUER_ROLE`, `REDEEMER_ROLE`)

### Upgrade Control
- Proxy admin contracts for each upgradeable module
- Multi-signature requirement for upgrades (verify in deployment)

---

## Key Security Considerations

1. **Oracle Manipulation** - Multiple oracle sources with thresholding
2. **Flash Loan Attacks** - Used extensively in dLoop for leverage
3. **Reentrancy** - Check all external calls and state changes
4. **Decimal Handling** - Various token decimals and oracle decimals
5. **Access Control** - Role-based permissions throughout
6. **Upgrade Safety** - Storage layout compatibility
7. **Integration Risks** - External protocol dependencies

---

## Excluded from Audit

### Test Infrastructure
```
contracts/testing/
contracts/mocks/
contracts/*/mocks/
```

### Bot Infrastructure
```
bot/
```

### External Dependencies
```
contracts/dlend/              # Entire Aave V3 fork
contracts/vaults/atoken_wrapper/  # Static AToken wrapper
```

### Mock Implementations
```
contracts/vaults/dloop/core/venue/mock/
contracts/vaults/dloop/periphery/venue/mock/
```

---

## Audit Recommendations

1. **Priority Areas**:
   - dStake withdrawal authorization bug (CRITICAL)
   - Cross-module integration points
   - Oracle aggregation logic
   - Leverage mechanisms in dLoop

2. **Testing Focus**:
   - Flash loan attack vectors
   - Oracle manipulation scenarios
   - Upgrade compatibility
   - Emergency pause mechanisms

3. **Documentation Review**:
   - Verify all external assumptions
   - Check mathematical invariants
   - Review access control matrices