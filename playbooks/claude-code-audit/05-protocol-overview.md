# dTRINITY Protocol Overview - Audit Documentation

## Executive Summary

dTRINITY is the world's first subsidized stablecoin protocol designed to enhance on-chain credit markets by redirecting reserve earnings to borrowers instead of passive holders. The protocol effectively "pays users to borrow," creating novel economic incentives in DeFi lending.

**Key Innovation**: Traditional stablecoins generate yield for holders; dTRINITY inverts this model by subsidizing borrowers, driving higher capital efficiency and protocol utilization.

## Protocol Architecture

### Core Components

1. **Decentralized Stablecoins (dSTABLE)**
   - **Current**: dUSD (USD-pegged), dS (Sonic-pegged)
   - **Planned**: dETH, dBTC
   - **Backing**: Exogenous, yield-bearing reserves
   - **Unique Feature**: Reserve earnings fund borrower interest rebates

2. **dLEND** - Native Lending Protocol
   - Fork of Aave v3 architecture (based on codebase analysis)
   - Offers subsidized stablecoin loans
   - Integrates with external lending platforms (Silo, Fraxlend)
   - Key differentiator: Interest rebates for borrowers

3. **dSTAKE** - Staking Vaults
   - ERC4626-based implementation
   - Automated yield generation strategies
   - Integration with dLEND for capital efficiency

4. **dLOOP** - Leveraged Yield Farming
   - Automated leverage strategies
   - Modular venue system for different yield sources
   - Risk-adjusted position management

5. **dPOOL** - Liquidity Pool Management
   - Curve pool integration
   - LP token vaults
   - Facilitates low-slippage swaps and liquidations

## Economic Model

### Credit Flywheel Mechanism

The protocol operates on a self-reinforcing economic cycle:

1. **Bull Market Dynamics**:
   - Users supply collateral → borrow dUSD
   - Increased borrowing → higher protocol utilization
   - High yields → more dUSD issuance and deposits
   - Trading volume and liquidity increase

2. **Bear Market Dynamics**:
   - Protocol rewards/emissions retain lenders
   - Maintains consistent trading volume
   - Prevents total economic contraction
   - Debt repayment converts demand-side credit to supply-side liquidity

### Key Economic Parameters

**Collateral Assets** (for dUSD):
- frxUSD, sfrxUSD
- DAI, sDAI
- USDC, USDT

**Critical Metrics**:
- Health Factor < 1.00 triggers liquidation
- LTV (Loan-to-Value) must be actively managed
- Oracle price updates affect collateral values

## Risk Parameters & Security Considerations

### Liquidation Mechanics
- **Trigger**: Health factor below 1.00
- **Risk Factors**:
  - Oracle updates and price volatility
  - Collateral value reduction
  - Rounding and slippage considerations

### Oracle Architecture
Based on codebase analysis:
- Aggregated price feeds from multiple sources
- Support for API3, Chainlink, and Redstone oracles
- Composite wrappers with thresholding mechanisms
- USD OracleAggregator deployed on both Fraxtal and Sonic

### Known Security Considerations
From codebase analysis:
- Active security issue in `DStakeToken._withdraw` - missing allowance check could allow unauthorized withdrawals
- Upgradeable contract patterns using OpenZeppelin standards
- Role-based access control (DEFAULT_ADMIN_ROLE, PAUSER_ROLE)

## Governance Structure

### TRIN Token
- Utility and governance token
- Vote-escrowed model (veTRIN) for governance participation
- Controls protocol parameters and upgrades

### Governance Process
1. Discussion forums for proposal development
2. Formal proposal submission
3. veTRIN voting mechanism
4. Delegation system for voting power
5. Community-driven parameter updates

## External Integrations & Trust Boundaries

### Key Dependencies
1. **Oracle Providers**: API3, Chainlink, Redstone
2. **DEX Integration**: Curve, Beets (on Sonic)
3. **External Lending**: Silo, Fraxlend partnerships
4. **DEX Aggregation**: Odos for optimal swapping
5. **Yield Tokenization**: Pendle support

### Trust Assumptions
- Oracle price feed accuracy and availability
- External protocol security (Curve, lending partners)
- Cross-chain bridge security (for multi-chain deployment)
- Smart contract upgrade mechanisms

## Critical Invariants for Auditors

1. **Collateralization**: dSTABLE tokens must maintain backing by approved collateral assets
2. **Liquidation Safety**: Health factor calculations must accurately reflect liquidation risk
3. **Interest Subsidy**: Borrower rebates must not exceed protocol earnings
4. **Oracle Resilience**: System must handle oracle failures gracefully
5. **Access Control**: Administrative functions must be properly restricted

## Attack Surface Analysis

### Economic Attacks
1. **Oracle Manipulation**: Price feed attacks could trigger unfair liquidations
2. **Flash Loan Exploits**: Borrowing/liquidation mechanism manipulation
3. **Governance Attacks**: veTRIN accumulation for malicious proposals
4. **Interest Rate Manipulation**: Gaming the subsidy mechanism

### Technical Vulnerabilities
1. **Reentrancy**: In lending/borrowing operations
2. **Integer Overflow**: In interest calculations
3. **Access Control**: Unauthorized function calls
4. **Upgrade Risks**: Storage collision in upgradeable contracts

## Protocol Deployment Status

- **Live Networks**: Fraxtal (Dec 2024), Sonic (May 2025)
- **Planned**: Ethereum mainnet and other L2s
- **Contract Verification**: Automated with manual fallback

## Audit Recommendations Focus Areas

1. **Interest Subsidy Mechanism**: Verify economic sustainability
2. **Oracle Integration**: Test failure modes and manipulation resistance
3. **Liquidation Logic**: Ensure fair and efficient liquidations
4. **Cross-Protocol Interactions**: dLEND ↔ dSTAKE ↔ dLOOP dependencies
5. **Upgrade Security**: Storage layout and initialization patterns
6. **Emergency Procedures**: Pause mechanisms and recovery paths

## Conclusion

dTRINITY represents a novel approach to stablecoin design with unique economic incentives. The protocol's security depends on careful management of oracle dependencies, liquidation mechanisms, and the sustainability of its borrower subsidy model. Auditors should pay particular attention to the economic flywheel dynamics and potential attack vectors arising from the inverted yield distribution model.