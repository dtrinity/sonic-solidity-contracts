# dSTAKE System Design Document

## Overview

dSTAKE is a yield-generating vault system that allows users to stake dSTABLE tokens (like dUSD) to earn yield. The system follows the ERC4626 vault standard and employs a modular architecture that separates concerns between share accounting, asset management, and yield strategy implementation.

## Core Objectives

1. **Yield Generation**: Enable users to earn yield on their dSTABLE holdings through various yield-bearing strategies
2. **Modularity**: Support multiple yield sources through a pluggable adapter system
3. **Upgradability**: Allow strategy changes without disrupting the core vault token
4. **Fee Management**: Implement withdrawal fees that accrue to remaining vault participants
5. **Security**: Minimize attack surface by separating immutable core logic from replaceable strategy components

## Architecture Components

### 1. DStakeToken (Core Vault Token)
**Contract**: `DStakeToken.sol`  
**Type**: ERC4626-compliant upgradeable vault token (e.g., sdUSD)

**Purpose**: 
- Handles share accounting and user interactions
- Implements the ERC4626 standard for deposits/withdrawals
- Manages withdrawal fees
- Delegates complex operations to specialized contracts

**Key Design Decisions**:
- **Minimal Logic**: Contains only essential ERC4626 logic to minimize upgrade risks
- **Withdrawal Fees**: Uses `SupportsWithdrawalFee` abstract contract for consistent fee handling
- **Delegation Pattern**: Delegates asset conversion and management to Router and CollateralVault
- **Dust Tolerance**: Accepts that up to 1 wei of assets may remain when `totalSupply() == 0`, with the first depositor receiving any accumulated value

**State Variables**:
- `collateralVault`: Address of the DStakeCollateralVault holding actual assets
- `router`: Address of the DStakeRouter handling conversions
- `withdrawalFeeBps_`: Withdrawal fee in basis points (max 1%)

**Access Control**:
- `DEFAULT_ADMIN_ROLE`: Can set vault/router addresses and manage roles
- `FEE_MANAGER_ROLE`: Can adjust withdrawal fees up to maximum

### 2. DStakeCollateralVault (Asset Storage)
**Contract**: `DStakeCollateralVault.sol`  
**Type**: Non-upgradeable, replaceable asset management contract

**Purpose**:
- Holds all yield-bearing vault assets
- Calculates total portfolio value in dSTABLE terms
- Manages the list of supported assets
- Provides rescue functions for stuck tokens

**Key Design Decisions**:
- **Non-Upgradeable**: Replaceable via DStakeToken governance instead of upgradeable
- **Asset Agnostic**: Can hold any ERC20 token with a configured adapter
- **Value Aggregation**: Queries router's adapter mappings to calculate total value
- **Griefing Protection**: Removed balance check on asset removal to prevent DoS attacks
- **Recovery Functions**: Includes rescue functions for accidentally sent tokens/ETH

**State Variables**:
- `_supportedAssets`: EnumerableSet of vault assets currently managed
- `router`: Authorized router contract with ROUTER_ROLE
- `dStakeToken`: Associated vault share token
- `dStable`: Underlying dSTABLE asset

**Access Control**:
- `DEFAULT_ADMIN_ROLE`: Can set router and manage roles
- `ROUTER_ROLE`: Can add/remove assets and transfer funds

### 3. DStakeRouterDLend (Logic & Routing)
**Contract**: `DStakeRouterDLend.sol`  
**Type**: Non-upgradeable, replaceable routing contract

**Purpose**:
- Orchestrates deposits and withdrawals
- Manages vault asset conversions via adapters
- Enables rebalancing between different yield sources
- Handles surplus dSTABLE from withdrawals

**Key Design Decisions**:
- **Adapter Pattern**: Each vault asset has a dedicated conversion adapter
- **Default Strategy**: Configurable default asset for new deposits
- **Slippage Protection**: Built-in checks for asset exchanges
- **Surplus Handling**: Automatically recycles excess dSTABLE from withdrawals back into yield-bearing assets
- **Dust Tolerance**: Configurable tolerance (default 1 wei) for value parity checks during exchanges

**State Variables**:
- `vaultAssetToAdapter`: Maps each vault asset to its conversion adapter
- `defaultDepositVaultAsset`: Default asset for deposits
- `dustTolerance`: Acceptable value difference in exchanges (default 1 wei)

**Access Control**:
- `DEFAULT_ADMIN_ROLE`: Manages adapters, default asset, and exchangers
- `DSTAKE_TOKEN_ROLE`: Granted to DStakeToken for deposit/withdraw calls
- `COLLATERAL_EXCHANGER_ROLE`: Can execute asset exchanges/rebalancing

### 4. IDStableConversionAdapter (Interface)
**Interface**: `IDStableConversionAdapter.sol`

**Purpose**:
- Standard interface for converting between dSTABLE and vault assets
- Provides valuation of vault assets in dSTABLE terms

**Key Methods**:
- `convertToVaultAsset()`: Converts dSTABLE to vault asset (e.g., deposit to lending)
- `convertFromVaultAsset()`: Converts vault asset back to dSTABLE (e.g., withdraw from lending)
- `assetValueInDStable()`: Returns current value of vault asset amount in dSTABLE
- `previewConvert*()`: View functions for conversion previews

### 5. WrappedDLendConversionAdapter (Example Implementation)
**Contract**: `WrappedDLendConversionAdapter.sol`

**Purpose**:
- Implements adapter interface for dLEND wrapped aTokens (StaticATokenLM)
- Handles deposits/withdrawals to/from dLEND protocol

**Integration**:
- Uses ERC4626 interface of StaticATokenLM for conversions
- Deposits mint wrapped tokens directly to CollateralVault
- Withdrawals send dSTABLE directly to router's caller

### 6. DStakeRewardManagerDLend (Reward Management)
**Contract**: `DStakeRewardManagerDLend.sol`  
**Type**: Non-upgradeable reward management contract

**Purpose**:
- Claims rewards earned by wrapped dLEND positions
- Compounds provided dSTABLE back into the vault
- Distributes rewards after treasury fees

**Key Design Decisions**:
- **Two-Phase Process**: Caller provides dSTABLE for compounding, then rewards are claimed and distributed
- **Treasury Fees**: Configurable fee on claimed rewards
- **Compounding**: Converts provided dSTABLE to default vault asset via router

**Access Control**:
- `DEFAULT_ADMIN_ROLE`: Can update rewards controller address
- `REWARDS_MANAGER_ROLE`: Can adjust treasury settings

## System Flows

### Deposit Flow
1. User calls `DStakeToken.deposit()` with dSTABLE
2. DStakeToken pulls dSTABLE from user
3. DStakeToken approves Router and calls `router.deposit()`
4. Router uses default deposit asset's adapter
5. Adapter converts dSTABLE to vault asset (e.g., deposits to dLEND)
6. Vault asset is minted/sent directly to CollateralVault
7. DStakeToken mints shares to user

### Withdrawal Flow
1. User calls `DStakeToken.withdraw()` specifying desired net dSTABLE amount
2. DStakeToken calculates gross amount needed (accounting for fees)
3. DStakeToken burns shares and calls `router.withdraw()`
4. Router calculates required vault asset amount via adapter
5. Router pulls vault asset from CollateralVault
6. Adapter converts vault asset to dSTABLE
7. Router sends exact requested amount to user
8. If adapter over-delivers, surplus is recycled back to vault asset

### Asset Exchange Flow (Rebalancing)
1. Authorized exchanger calls `router.exchangeAssets()`
2. Router validates adapters exist for both assets
3. Calculates expected output based on input value
4. Pulls input asset from exchanger
5. Transfers input asset to CollateralVault
6. Sends calculated output asset from CollateralVault to exchanger
7. Validates value parity within dust tolerance

### Total Value Calculation
1. `DStakeToken.totalAssets()` calls `collateralVault.totalValueInDStable()`
2. CollateralVault iterates through all supported assets
3. For each asset, queries router for its adapter
4. Uses adapter to value the vault's balance in dSTABLE terms
5. Returns sum of all asset values

## Security Considerations

### 1. Withdrawal Fee Mechanism
- **Design**: Fees are calculated on gross withdrawal amount and kept in the vault
- **Invariant**: Fee must not exceed maximum (1% by default)
- **Protection**: All fee calculations use precise math (mulDiv) to prevent rounding errors

### 2. Adapter Trust Model
- **Risk**: Malicious adapters could steal funds or misreport values
- **Mitigation**: Only governance can add/update adapters
- **Validation**: Router validates adapter's reported vault asset matches expected

### 3. Value Reporting
- **Risk**: Incorrect valuation could enable arbitrage or unfair share pricing
- **Mitigation**: Each adapter implements standard valuation logic
- **Fallback**: Missing adapters are skipped in total value calculation to preserve liveness

### 4. Surplus Handling
- **Design**: Over-delivered dSTABLE from withdrawals is immediately recycled
- **Fallback**: If recycling fails, surplus is held in router (can be swept by admin)
- **Security**: Prevents value leakage while maintaining withdrawal guarantees

### 5. Dust Tolerance
- **Purpose**: Allows small value differences in exchanges due to rounding
- **Default**: 1 wei tolerance prevents griefing while maintaining economic security
- **Governance**: Adjustable by admin if needed for specific integrations

### 6. Access Control Separation
- **DStakeToken**: Controls its own admin and fee manager roles
- **CollateralVault**: Has separate admin controlling router role
- **Router**: Independent admin managing adapters and exchangers
- **Design Rationale**: Prevents single point of failure, enables granular permissions

### 7. Reentrancy Protection
- **CollateralVault**: Uses ReentrancyGuard on rescue functions
- **DStakeRewardManagerDLend**: Uses ReentrancyGuard on compoundRewards
- **Core Operations**: Protected by checks-effects-interactions pattern

### 8. Asset Restrictions
- **CollateralVault**: Cannot rescue supported vault assets or dSTABLE
- **Purpose**: Prevents governance from accidentally or maliciously withdrawing user funds
- **Transparency**: Provides getter for restricted token list

## Invariants

1. **Share Value**: Share price (assets/supply) should only increase over time (except for withdrawals)
2. **Asset Custody**: All vault assets must be held in CollateralVault
3. **Fee Bounds**: Withdrawal fee cannot exceed maximum (1%)
4. **Adapter Consistency**: Each vault asset can only have one adapter at a time
5. **Value Conservation**: Asset exchanges must maintain value parity within dust tolerance

## Future Considerations

1. **Multi-Asset Withdrawals**: Current design withdraws from default asset only
2. **Rebalancing Strategy**: Manual rebalancing by COLLATERAL_EXCHANGER_ROLE could be automated
3. **Adapter Upgrades**: Consider migration path when updating adapters for existing positions
4. **Fee Distribution**: Withdrawal fees currently benefit all shareholders; could add fee recipient
5. **Emergency Pause**: No pause mechanism; consider adding for critical situations

## Deviations from Original Design

### Notable Changes from Design.md:
1. **Router Naming**: `DStakeRouter` is actually `DStakeRouterDLend` in implementation
2. **Surplus Handling**: Implementation includes sophisticated surplus recycling not detailed in design
3. **Dust Tolerance**: Implementation adds configurable dust tolerance for exchanges
4. **Adapter Validation**: Router validates adapter's vault asset matches expected
5. **Access Control**: More granular role separation than suggested in design
6. **Recovery Functions**: CollateralVault includes rescue functions not mentioned in design
7. **Exchange Functions**: Implementation has both `exchangeAssets` and `exchangeAssetsUsingAdapters`

### Implementation Improvements:
1. Better error handling with custom errors
2. Comprehensive event emission for monitoring
3. View functions for UI integration (getSupportedAssets, getRestrictedRescueTokens)
4. Admin functions for operational flexibility (sweepSurplus, setDustTolerance)

This design provides a flexible, secure foundation for yield generation while maintaining upgradeability and extensibility for future strategies and integrations.