# CLAUDE.md - Memento Protocol Router

This file serves as a minimal router for Claude Code. Instructions are loaded on-demand from the .memento directory.

## Available Commands

🚨 IMPORTANT: Always Check for Mode First. 
WHEN YOU START A MODE please output: `Mode: [mode-name]`
WHEN YOU START A WORKFLOW please output: `Workflow: [workflow-name]`
### What to do at the start of every fresh session
0. **Default Mode**: IF NO MODE IS SPECIFIED OR IMPLIED: Load and activate "autonomous-project-manager" mode automatically at session start
1. Check if user requested a different mode → Load mode file
2. Check if task or mode matches a workflow → Load workflow file
3. Check for relevant tickets → Load ticket context
4. Proceed with task

### Activate a Mode
When prompted explicitly (e.g. "act as [mode]") or when the user's intention aligns with a specific role (e.g. "please review feature X") you can take on one of modes in `.memento/modes`
- `ai-debt-maintainer`
- `architect`
- `autonomous-project-manager`
- `engineer`
- `reviewer`

Each mode includes specific example commands and use cases - check the mode file for details.

### Execute a Workflow
There are battle tested step-by-step flows in `.memento/workflows`. You must execute these when asked, or when you think it will increase task reliability. You can treat these as additional tools at your disposal.
Example workflow invocations: `execute summarize` / `execute summarize workflow` / `workflow summarize` / `summarize workflow` - These should all trigger `./memento/workflows/summarize.md`
The full list of workflows is in the `.memento/workflows` directory. When asked to execute a workflow, check there for available workflows and pick up the one that matches.

### Work with Tickets
To manage complex or long running work, please persist context in `.memento/tickets/`
- Tickets are in 3 directories, `next` `done` and `in-progress`
- You must move tickets to their respective directory based on status at the end of a run
- You should use tickets to share context between sub-agents or to coordinate parallel agents
- Each agent must add their updates to their respective ticket before finishing

## Component Location
All components are in the `.memento/` directory:
- **Modes**: `.memento/modes/[mode-name].md`
- **Workflows**: `.memento/workflows/[workflow-name].md`
- **Tickets**: `.memento/tickets/[status]/[ticket-id]/`

---
# Project-Specific Instructions
---
<!-- Project-specific content below this line --> 

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
Decentralized stablecoin system. 

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

## Development Environment

### Build System
- **Framework**: Hardhat with TypeScript
- **Package Manager**: Yarn 4.5.0
- **Solidity Version**: 0.8.20

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
- **Sonic Mainnet**: Production deployment - DO NOT ATTEMPT TO DEPLOY TO MAINNET. You do not have the keys for it anyways.
- **Sonic Testnet**: Testing and development
- **Localhost**: Local development with mocks

## Common Development Patterns

### Contract Upgrades
Most contracts use OpenZeppelin's upgradeable patterns with proper initialization and storage gaps.

### Access Control
Consistent use of role-based access control with DEFAULT_ADMIN_ROLE, PAUSER_ROLE, and custom roles.

### Integration Testing
Complex integration tests using fixtures that simulate full protocol deployment and interactions.

### Error Handling
Custom error types for gas-efficient reverts and clear error messages.
