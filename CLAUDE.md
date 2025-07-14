# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

dTRINITY Sonic Contracts is a comprehensive DeFi protocol on Sonic blockchain providing decentralized stablecoin issuance, lending, leveraged yield farming, and staking functionality. The codebase consists of multiple interconnected smart contract modules built with Hardhat and TypeScript.

## Essential Commands

### Core Development
```bash
make lint                    # Run all linters (ESLint + Solhint + Prettier)
make test                    # Run all tests
make compile                 # Compile contracts
make deploy                  # Deploy contracts
make clean                   # Clean artifacts
```

### Security Analysis
```bash
make slither                 # Run Slither static analysis
make mythril                 # Run Mythril security analysis
make audit                   # Run full security analysis
```

### Network Operations
```bash
make explorer.verify.sonic_mainnet    # Verify contracts on Sonic mainnet
make explorer.verify.sonic_testnet    # Verify contracts on Sonic testnet
```

### Testing Individual Components
```bash
# Run specific test files
npx hardhat test test/dstable/test.ts
npx hardhat test test/dlend/test.ts
npx hardhat test test/vaults/dstake/test.ts
```

## Architecture Overview

The codebase is organized into five main modules:

### 1. dStable (`contracts/dstable/`)
Decentralized stablecoin system with:
- `ERC20StablecoinUpgradeable.sol` - Core stablecoin implementation
- `Issuer.sol` - Minting mechanism
- `Redeemer.sol` / `RedeemerWithFees.sol` - Redemption with fee handling
- `AmoManager.sol` - Automated Market Operations
- `CollateralVault.sol` - Collateral management

### 2. dLend (`contracts/dlend/`)
Aave v3 fork providing lending/borrowing with:
- Core lending pool functionality
- Interest rate strategies and liquidation
- Flash loans and rewards system
- Extensive adapter system for external integrations

### 3. dStake (`contracts/vaults/dstake/`)
ERC4626-based staking vaults with:
- `DStakeToken.sol` - Main staking token
- `DStakeCollateralVault.sol` - Collateral management
- `DStakeRouterDLend.sol` - dLend integration
- `DStakeRewardManagerDLend.sol` - Reward distribution

### 4. dLoop (`contracts/vaults/dloop/`)
Leveraged yield farming with modular venue system:
- Core contracts for base functionality
- Periphery contracts for user interactions
- Venue-specific implementations (dlend, mock, odos)

### 5. dPool (`contracts/vaults/dpool/`)
Liquidity pool management with Curve integration:
- `DPoolVaultLP.sol` - LP token vault
- `DPoolCurvePeriphery.sol` - Curve pool integration

## Key Infrastructure

### Oracle Aggregator (`contracts/oracle_aggregator/`)
Price feed aggregation supporting API3, Chainlink, and Redstone oracles with composite wrappers and thresholding mechanisms.

### External Integrations
- **Odos** (`contracts/odos/`) - DEX aggregation for optimal swapping
- **Pendle** (`contracts/pendle/`) - Yield tokenization support

## Development Environment

### Build System
- **Framework**: Hardhat with TypeScript
- **Package Manager**: Yarn 4.5.0
- **Solidity Version**: 0.8.20 with IR optimization
- **Networks**: Sonic mainnet, Sonic testnet, localhost

### Testing
- **Framework**: Hardhat with Chai matchers
- **Organization**: Modular by component in `test/` directory
- **Fixtures**: Comprehensive setup for integration testing

### Code Quality
- **Linting**: ESLint + Solhint + Prettier
- **Static Analysis**: Slither + Mythril
- **Type Safety**: TypeChain for contract interactions

## Deployment

### Network Configuration
- **Sonic Mainnet**: Production deployment
- **Sonic Testnet**: Testing and development
- **Localhost**: Local development with mocks

### Deployment Process
- **Staged Deployment**: 14 deployment phases
- **Role Management**: Multi-signature governance
- **Contract Verification**: Automated with manual fallback

## Security Considerations

### Current Security Issue
There's an active security ticket (`tickets/in-progress/hats-2-missing-approval-check-dstake.md`) regarding a missing allowance check in `DStakeToken._withdraw` that could allow unauthorized withdrawals.

### Security Tools
- Slither for static analysis
- Mythril for symbolic execution
- Comprehensive test coverage
- Role-based access control throughout

## Common Development Patterns

### Contract Upgrades
Most contracts use OpenZeppelin's upgradeable patterns with proper initialization and storage gaps.

### Access Control
Consistent use of role-based access control with DEFAULT_ADMIN_ROLE, PAUSER_ROLE, and custom roles.

### Integration Testing
Complex integration tests using fixtures that simulate full protocol deployment and interactions.

### Error Handling
Custom error types for gas-efficient reverts and clear error messages.

## Ticket Management

Active tickets are tracked in `tickets/in-progress/` and completed tickets in `tickets/done/`. Each ticket includes context, requirements, and expected outcomes.