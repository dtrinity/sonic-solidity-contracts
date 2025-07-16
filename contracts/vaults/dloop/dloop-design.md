# dLoop Leveraged Yield Farming Design Document

## Executive Summary

dLoop is a sophisticated leveraged yield farming system within the dTRINITY protocol that enables users to amplify their yield farming positions through automated leverage management. The system allows users to deposit collateral and automatically leverage it up to a target ratio (e.g., 3x) by borrowing against the collateral in integrated lending protocols. This design document explains the architecture, mechanics, and security considerations of the dLoop system.

## Purpose and Overview

### Core Objectives

1. **Leveraged Yield Farming**: Enable users to multiply their yield farming exposure without manual position management
2. **Automated Rebalancing**: Maintain target leverage ratios through incentivized rebalancing mechanisms
3. **Capital Efficiency**: Maximize capital utilization through optimized borrowing strategies
4. **Modular Integration**: Support multiple lending venues and swap protocols through a flexible architecture

### Key Benefits

- **Enhanced Returns**: Users can amplify their farming yields through leverage
- **Simplified Management**: Automated leverage maintenance reduces operational complexity
- **Risk Management**: Built-in bounds and safety mechanisms protect against extreme market conditions
- **Composability**: ERC4626 vault standard enables easy integration with other DeFi protocols

## Architecture Overview

### Modular Venue System

The dLoop architecture follows a modular design pattern with three main layers:

```
┌─────────────────────────────────────────────────────────┐
│                    User Interface                        │
├─────────────────────────────────────────────────────────┤
│                  Periphery Contracts                     │
│  - DLoopDepositorBase     - DLoopRedeemerBase          │
│  - DLoopIncreaseLeverageBase - DLoopDecreaseLeverageBase│
├─────────────────────────────────────────────────────────┤
│                    Core Contracts                        │
│              DLoopCoreBase (Abstract)                    │
│                        │                                 │
│    ┌───────────────────┴───────────────────┐           │
│    │          Venue Implementations         │           │
│    │  - DLoopCoreDLend (dLend integration) │           │
│    │  - DLoopCoreMock (Testing)           │           │
│    └───────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### Core Layer (DLoopCoreBase)
- **Leverage Management**: Maintains target leverage ratios and handles rebalancing
- **Position Tracking**: Monitors collateral and debt positions
- **Vault Operations**: Implements ERC4626 standard for deposits/withdrawals
- **Safety Checks**: Enforces leverage bounds and validates all operations

#### Venue Implementations
- **DLoopCoreDLend**: Integrates with dLend (Aave v3 fork) for lending operations
- **Venue-Specific Logic**: Handles protocol-specific interactions (supply, borrow, repay, withdraw)
- **Oracle Integration**: Connects to price feeds for position valuation
- **Reward Management**: Claims and distributes protocol rewards

#### Periphery Layer
- **DLoopDepositorBase**: Enables leveraged deposits using flash loans
- **DLoopRedeemerBase**: Handles leveraged withdrawals with flash loan unwinding
- **DLoopIncreaseLeverageBase**: Facilitates leverage increases without additional capital
- **DLoopDecreaseLeverageBase**: Enables leverage reduction with automated debt repayment

## Leverage Mechanics

### Core Leverage Formula

The system maintains leverage according to the formula:

```
Leverage = Total Collateral Value / (Total Collateral Value - Total Debt Value)
```

### Leverage Lifecycle

#### 1. Initial Deposit (Leveraged Entry)
When a user deposits 100 WETH with 3x target leverage:
```
1. User deposits 100 WETH
2. System supplies 300 WETH to lending pool (3x leverage)
3. System borrows equivalent of 200 WETH in debt token
4. User receives shares representing 300 WETH position
5. User receives borrowed debt tokens (200 WETH worth)
```

#### 2. Position Maintenance
The system maintains leverage within bounds:
- **Lower Bound**: e.g., 2.7x (90% of target)
- **Target**: e.g., 3.0x
- **Upper Bound**: e.g., 3.3x (110% of target)

#### 3. Rebalancing Operations

**Increase Leverage** (when below target):
```
1. Supply additional collateral
2. Borrow proportional debt to maintain leverage
3. Caller receives debt tokens + subsidy
```

**Decrease Leverage** (when above target):
```
1. Repay debt using provided tokens
2. Withdraw proportional collateral
3. Caller receives collateral + subsidy
```

### Mathematical Foundations

#### Leverage Maintenance Formula
To maintain constant leverage when depositing:
```
Borrow Amount = Supply Amount × (Leverage - 1) / Leverage
```

#### Rebalancing Calculations
For reaching target leverage T from current position:
```
Change Amount = (T × (C - D) - C) / (1 + T × k)
```
Where:
- C = Total Collateral
- D = Total Debt
- k = Subsidy rate
- T = Target leverage

## Risk Management

### Leverage Bounds and Safety Mechanisms

1. **Strict Leverage Limits**
   - Enforces upper and lower bounds around target leverage
   - Prevents deposits/withdrawals when leverage is out of bounds
   - Protects against extreme leverage scenarios

2. **Slippage Protection**
   - All rebalancing operations include minimum output amounts
   - Protects against adverse price movements during transactions
   - Configurable slippage tolerances for different operations

3. **Oracle Safety**
   - Validates non-zero prices from oracles
   - Supports multiple oracle sources (API3, Chainlink, Redstone)
   - Fails safely on oracle errors

4. **Balance Validation**
   - Strict pre/post operation balance checks
   - Tolerance for minor rounding differences (1 wei)
   - Prevents unexpected token movements

### Liquidation Risks

Users must understand that leveraged positions carry liquidation risk:

1. **Collateral Value Decline**: If collateral value drops, leverage increases
2. **Debt Value Increase**: If debt token appreciates, leverage increases
3. **Interest Accumulation**: Borrowing costs gradually increase leverage
4. **Liquidation Threshold**: Underlying lending protocol may liquidate if health factor drops

### Subsidy Mechanism

The rebalancing subsidy incentivizes maintenance of target leverage:

```
Subsidy % = min(MaxSubsidy, |Current Leverage - Target| / Target × 100)
```

This creates a market-driven rebalancing mechanism where:
- Larger deviations offer higher rewards
- Arbitrageurs profit from maintaining system health
- Users benefit from stable leverage ratios

## Integration Patterns

### Flash Loan Integration

Periphery contracts use flash loans for capital-efficient operations:

#### Leveraged Deposit Flow
```
1. Flash loan debt tokens
2. Swap to collateral tokens
3. Deposit leveraged amount to core
4. Receive debt tokens from core
5. Repay flash loan + fee
6. Transfer shares to user
```

#### Leveraged Withdrawal Flow
```
1. Flash loan collateral tokens
2. Redeem shares for unleveraged assets
3. Swap portion to debt tokens
4. Repay flash loan + fee
5. Transfer remaining assets to user
```

### Swap Integration (Odos)

The system integrates with Odos for token swaps:
- Supports exact output swaps for precise leverage targeting
- Validates swap data and amounts
- Handles swap failures gracefully

### Venue Modularity

New lending venues can be integrated by implementing:
```solidity
- getTotalCollateralAndDebtOfUserInBase()
- _getAssetPriceFromOracleImplementation()
- _supplyToPoolImplementation()
- _borrowFromPoolImplementation()
- _repayDebtToPoolImplementation()
- _withdrawFromPoolImplementation()
```

## Security Considerations

### 1. Reentrancy Protection
- All public functions use `nonReentrant` modifier
- State changes before external calls
- Checks-effects-interactions pattern

### 2. Access Control
- Owner-only functions for parameter updates
- Immutable core parameters (leverage, tokens)
- Role-based access for admin functions

### 3. Oracle Manipulation
- Price validation and sanity checks
- Multiple oracle source support
- Fails safely on suspicious prices

### 4. Flash Loan Safety
- Validates flash loan initiator
- Ensures sufficient funds for repayment
- Strict callback validation

### 5. Token Handling
- Uses SafeERC20 for all transfers
- Validates token balances pre/post operations
- Handles token decimals correctly

### 6. Mathematical Precision
- Uses basis points (10,000 = 100%) for percentages
- Implements rounding-safe arithmetic
- Accounts for precision loss in calculations

## Key Risk Factors for Auditors

1. **Leverage Calculation Accuracy**
   - Verify leverage formulas match implementation
   - Check for edge cases (zero collateral/debt)
   - Validate bounds enforcement

2. **Flash Loan Attack Vectors**
   - Ensure flash loans can't manipulate leverage
   - Verify callback security
   - Check for sandwich attack possibilities

3. **Oracle Dependencies**
   - Assess oracle manipulation risks
   - Verify price feed reliability
   - Check for stale price handling

4. **Liquidation Cascades**
   - Understand liquidation thresholds
   - Assess systemic risk scenarios
   - Verify user protection mechanisms

5. **Integration Risks**
   - Validate venue implementations
   - Check for protocol-specific vulnerabilities
   - Assess upgrade risks

6. **Economic Attacks**
   - Verify subsidy mechanism can't be gamed
   - Check for MEV extraction opportunities
   - Assess griefing attack possibilities

## Conclusion

dLoop represents a sophisticated approach to leveraged yield farming that balances automation, capital efficiency, and risk management. The modular architecture enables integration with multiple lending venues while maintaining consistent user experience and safety guarantees. However, the complexity of leveraged positions and cross-protocol interactions creates numerous risk vectors that require careful consideration by both users and auditors.

The system's strength lies in its automated rebalancing and incentive alignment, but users must understand the inherent risks of leverage, including potential liquidation and the amplification of both gains and losses. Proper risk management and continuous monitoring are essential for safe operation of leveraged positions.