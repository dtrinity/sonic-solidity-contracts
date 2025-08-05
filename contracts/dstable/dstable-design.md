# dStable System Design Document

## Overview

dStable is a decentralized stablecoin system built on the Sonic blockchain that maintains price stability through a combination of overcollateralization, algorithmic market operations (AMOs), and dynamic fee mechanisms. The system allows users to mint stablecoins by depositing collateral and redeem stablecoins for collateral, while maintaining protocol stability through automated market operations.

## System Goals

1. **Price Stability**: Maintain a 1:1 peg between dStable tokens and the base currency unit (e.g., USD)
2. **Capital Efficiency**: Enable protocol-controlled liquidity through AMO mechanisms to improve capital efficiency
3. **Decentralization**: Support multiple collateral types with oracle-based valuation
4. **Risk Management**: Ensure overcollateralization and provide mechanisms for managing bad debt
5. **Flexibility**: Allow protocol governance to adjust parameters and manage system operations

## Core Components

### 1. ERC20StablecoinUpgradeable
- **Purpose**: The core stablecoin token implementation
- **Key Features**:
  - Upgradeable ERC20 token with 18 decimals across all chains
  - Pausable functionality for emergency situations
  - Permit functionality for gasless approvals
  - Flash loan support for arbitrage and liquidations
  - Minter role restricted to authorized contracts (Issuer)

### 2. Issuer
- **Purpose**: Manages the minting of dStable tokens
- **Key Functions**:
  - `issue()`: Public function allowing users to mint dStable by depositing collateral
  - `issueUsingExcessCollateral()`: Protocol-only function to mint against excess collateral
  - `increaseAmoSupply()`: AMO-specific minting that doesn't affect circulating supply
- **Trust Model**: Relies on oracle prices for collateral valuation

### 3. Redeemer / RedeemerWithFees
- **Purpose**: Manages the redemption of dStable tokens for collateral
- **Key Differences**:
  - `Redeemer`: Protocol-only redemptions without fees
  - `RedeemerWithFees`: Public redemptions with configurable fees (up to 5% max)
- **Fee Structure**:
  - Default fee rate applies to all collateral types
  - Per-collateral fee rates can override the default
  - Fees collected go to a designated fee receiver address

### 4. CollateralVault (Abstract)
- **Purpose**: Base contract for managing collateral assets
- **Key Features**:
  - Whitelist of supported collateral types
  - Role-based access control for deposits/withdrawals
  - Oracle integration for valuation
  - Minimum of one collateral must always be supported

### 5. CollateralHolderVault
- **Purpose**: Simple implementation of CollateralVault for holding protocol collateral
- **Additional Features**:
  - `exchangeCollateral()`: Swap between collateral types at oracle prices
  - Used by AMO system to manage collateral

### 6. AmoManager
- **Purpose**: Coordinates Algorithmic Market Operations across multiple AMO vaults
- **Key Mechanisms**:
  - Tracks dStable allocations to each AMO vault
  - Manages collateral movement between AMO vaults and holder vault
  - Calculates and withdraws profits from AMO operations
  - Maintains invariant: AMO operations don't change circulating supply

### 7. AmoVault (Abstract)
- **Purpose**: Base contract for AMO vault implementations
- **Key Features**:
  - Holds both dStable and collateral
  - Integrates with AmoManager for allocation tracking
  - Recovery functions for stuck tokens (except vault assets)

## Economic Model

### Collateralization Ratio
```
Collateralization Ratio = Total Collateral Value / Circulating dStable Supply
```

Where:
- **Total Collateral Value** = Value in CollateralVault + Value in AMO vaults
- **Circulating dStable Supply** = Total Supply - AMO Supply

### AMO Supply Accounting
The system carefully tracks "AMO supply" separately from circulating supply:
1. When dStable is allocated to an AMO vault, it's considered non-circulating
2. When collateral is withdrawn from AMO vaults, the equivalent dStable becomes circulating
3. This ensures AMO operations are capital-neutral from a backing perspective

### Stability Mechanisms

1. **Overcollateralization**: Users must deposit collateral worth more than the dStable they mint
2. **Redemption Arbitrage**: If dStable trades below peg, users can profit by redeeming at face value
3. **AMO Operations**: Protocol can deploy capital to DEXs/lending markets to maintain peg
4. **Dynamic Fees**: Redemption fees can be adjusted to discourage bank runs during stress

## Key Invariants

1. **Backing Invariant**: `Collateral Value ≥ Circulating dStable Value`
2. **AMO Supply Invariant**: AMO operations must not change the circulating supply calculation
3. **Collateral Support**: At least one collateral type must always be supported
4. **Oracle Dependency**: All valuations depend on oracle price feeds being accurate
5. **Role Separation**: Minting, redemption, and AMO operations require different roles

## Security Properties

### Access Control Hierarchy
```
DEFAULT_ADMIN_ROLE (Super Admin)
├── PAUSER_ROLE (Emergency pause)
├── MINTER_ROLE (Mint dStable)
├── REDEMPTION_MANAGER_ROLE (Fee-free redemptions)
├── INCENTIVES_MANAGER_ROLE (Mint using excess collateral)
├── AMO_MANAGER_ROLE (Manage AMO supply)
├── AMO_ALLOCATOR_ROLE (Allocate to AMO vaults)
├── FEE_COLLECTOR_ROLE (Withdraw AMO profits)
├── COLLATERAL_MANAGER_ROLE (Add/remove collateral types)
├── COLLATERAL_WITHDRAWER_ROLE (Withdraw collateral)
├── COLLATERAL_STRATEGY_ROLE (Exchange collateral)
└── RECOVERER_ROLE (Recover stuck tokens)
```

### Trust Assumptions

1. **Oracle Trust**: The system fully trusts oracle price feeds
   - No secondary validation or sanity checks
   - Oracle manipulation could lead to undercollateralized mints

2. **Admin Trust**: Admin roles can significantly impact the system
   - Can pause all transfers
   - Can change critical addresses (vaults, oracles)
   - Can modify fee parameters

3. **AMO Trust**: AMO vaults are trusted to:
   - Not lose funds through bad strategies
   - Accurately report their holdings
   - Allow withdrawals when requested

4. **Collateral Trust**: Assumes collateral tokens:
   - Follow standard ERC20 behavior
   - Don't have transfer fees or rebasing mechanisms
   - Maintain reasonable liquidity for redemptions

## External Dependencies

1. **Price Oracles**: Currently supports Aave-compatible oracle interface
   - Must provide prices in base currency units
   - No fallback oracles or circuit breakers

2. **Collateral Tokens**: Any ERC20 token with:
   - Standard decimals() function
   - No transfer restrictions
   - Oracle price feed available

3. **AMO Venues**: External protocols where AMO vaults deploy capital
   - DEXs for liquidity provision
   - Lending protocols for yield generation
   - Must allow withdrawal of funds

## Risk Scenarios

### 1. Oracle Failure/Manipulation
- **Impact**: Incorrect collateral valuation leading to bad debt
- **Mitigation**: Multi-oracle support planned, admin can update oracle

### 2. Collateral Crash
- **Impact**: System becomes undercollateralized
- **Mitigation**: Overcollateralization buffer, multi-collateral support

### 3. Bank Run
- **Impact**: Rapid redemptions depleting specific collateral
- **Mitigation**: Redemption fees up to 5%, multi-collateral pools

### 4. AMO Losses
- **Impact**: Reduced protocol profits or actual losses
- **Mitigation**: Conservative AMO strategies, profit buffer before withdrawal

### 5. Contract Bugs
- **Impact**: Loss of funds or system dysfunction
- **Mitigation**: Upgradeability for critical contracts, thorough testing

## Upgrade Paths

The system uses OpenZeppelin's upgradeable pattern for the stablecoin contract, allowing:
- Bug fixes without token migration
- Feature additions while preserving state
- Emergency patches if vulnerabilities found

Other contracts are non-upgradeable but can be replaced by admin action:
- Issuer/Redeemer can be swapped by updating roles
- CollateralVault can be migrated with collateral transfer
- Oracle can be updated while maintaining base currency unit

## Conclusion

dStable implements a robust stablecoin system balancing decentralization with capital efficiency. The AMO mechanism allows the protocol to actively manage liquidity while maintaining full backing. Multiple layers of access control and safety mechanisms protect against various failure modes, though the system maintains critical dependencies on oracle accuracy and admin governance.