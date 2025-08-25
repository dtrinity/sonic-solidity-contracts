# Step 01: Initialize Git Repository and Directory Structure

## Objective

Set up the Git repository structure for the DLoop reward compounder bot with two independent sub-repositories.

## Directory Structure

```
bot/dloop-reward-compounder/
├── .git/                           # Main Git repository
├── bot-solidity-contracts/         # Solidity contracts subrepo
│   ├── contracts/
│   ├── test/
│   ├── deploy/
│   ├── config/
│   ├── scripts/
│   ├── .git/                      # Independent Git repo
│   ├── package.json
│   ├── hardhat.config.ts
│   ├── tsconfig.json
│   ├── .solhint.json
│   ├── .solhintignore
│   ├── .yarnrc.yml
│   ├── .yarn/
│   ├── .env.example
│   └── README.md
│
└── bot-typescript/               # TypeScript bot subrepo
    ├── src/
    │   ├── runner.ts
    │   ├── config/
    │   ├── services/
    │   ├── types/
    │   └── utils/
    ├── test/
    ├── config/
    │   ├── networks/
    │   │   ├── sonic_mainnet.ts
    │   │   └── sonic_testnet.ts
    │   └── types.ts
    ├── .git/                      # Independent Git repo
    ├── Dockerfile
    ├── Makefile
    ├── package.json
    ├── tsconfig.json
    ├── eslint.config.mjs
    ├── jest.config.js
    ├── .yarnrc.yml
    ├── .yarn/
    ├── .env.example
    └── README.md
```

## Implementation Tasks

### 1. Initialize Main Repository

```bash
# Create main directory
mkdir -p bot/dloop-reward-compounder
cd bot/dloop-reward-compounder

# Initialize Git
git init

# Create .gitignore
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
.yarn/

# Environment files
.env
.env.local

# Build outputs
artifacts/
cache/
dist/
build/

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Hardhat
cache/
artifacts/
EOF
```

### 2. Create Sub-repository Structure

```bash
# Create bot-solidity-contracts subrepo
mkdir -p bot-solidity-contracts/{contracts,test,deploy,config,scripts}

# Create bot-typescript subrepo
mkdir -p bot-typescript/{src,test,config}
mkdir -p bot-typescript/src/{config,services,types,utils}
mkdir -p bot-typescript/config/networks
```

### 3. Initialize Sub-repositories

```bash
# Initialize bot-solidity-contracts as independent repo
cd bot-solidity-contracts
git init
git config core.sparseCheckout false

# Create .gitignore for Solidity repo
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
.yarn/

# Environment files
.env
.env.local

# Build outputs
artifacts/
cache/
typechain-types/

# IDE files
.vscode/
.idea/

# OS files
.DS_Store

# Logs
*.log

# Hardhat
cache/
artifacts/
EOF

# Initialize bot-typescript as independent repo
cd ../bot-typescript
git init

# Create .gitignore for TypeScript repo
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
.yarn/

# Environment files
.env
.env.local

# Build outputs
dist/
build/

# IDE files
.vscode/
.idea/

# OS files
.DS_Store

# Logs
*.log
logs/

# Coverage
coverage/
EOF
```

### 4. Create Initial Package.json Files

#### bot-solidity-contracts/package.json

```json
{
  "name": "@stably/dloop-reward-compounder-contracts",
  "version": "1.0.0",
  "description": "Solidity contracts for DLoop reward compounder bot",
  "license": "MIT",
  "scripts": {
    "compile": "hardhat compile",
    "test": "hardhat test",
    "lint": "solhint 'contracts/**/*.sol'",
    "lint:fix": "solhint --fix 'contracts/**/*.sol'",
    "clean": "hardhat clean",
    "typechain": "hardhat typechain"
  },
  "devDependencies": {
    "@nomiclabs/hardhat-ethers": "^2.2.3",
    "@nomiclabs/hardhat-waffle": "^2.0.6",
    "@typechain/ethers-v5": "^10.2.1",
    "@typechain/hardhat": "^6.1.6",
    "@types/chai": "^4.3.11",
    "@types/mocha": "^10.0.6",
    "@types/node": "^18.19.8",
    "chai": "^4.4.1",
    "ethereum-waffle": "^4.0.10",
    "hardhat": "^2.19.4",
    "hardhat-gas-reporter": "^1.0.9",
    "prettier": "^3.1.1",
    "prettier-plugin-solidity": "^1.3.1",
    "solhint": "^4.0.0",
    "solhint-plugin-prettier": "^0.0.5",
    "ts-node": "^10.9.2",
    "typechain": "^8.3.2",
    "typescript": "^5.3.3"
  },
  "packageManager": "yarn@4.0.2"
}
```

#### bot-typescript/package.json

```json
{
  "name": "@stably/dloop-reward-compounder-bot",
  "version": "1.0.0",
  "description": "TypeScript bot for DLoop reward compounding",
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "start": "node dist/runner.js",
    "dev": "ts-node src/runner.ts",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint --fix src/**/*.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "clean": "rm -rf dist/"
  },
  "dependencies": {
    "ethers": "^6.8.1",
    "@slack/web-api": "^6.9.1",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/jest": "^29.5.8",
    "@types/node": "^18.19.8",
    "@typescript-eslint/eslint-plugin": "^6.13.1",
    "@typescript-eslint/parser": "^6.13.1",
    "eslint": "^8.54.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  },
  "packageManager": "yarn@4.0.2"
}
```

### 5. Create TypeScript Configuration Files

#### bot-solidity-contracts/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./"
  },
  "include": [
    "./deploy/**/*.ts",
    "./scripts/**/*.ts",
    "./test/**/*.ts",
    "./hardhat.config.ts"
  ],
  "exclude": ["node_modules", "dist"]
}
```

#### bot-typescript/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 6. Create Initial README Files

#### bot-solidity-contracts/README.md

```markdown
# DLoop Reward Compounder - Solidity Contracts

This sub-repository contains the Solidity contracts for the DLoop reward compounder bot.

## Contracts

- **RewardCompounderDLendBase.sol**: Abstract base contract for flashloan-based reward compounding
- **RewardCompounderDLendOdos.sol**: Odos-specific implementation
- **RewardQuoteHelperBase.sol**: Abstract base contract for reward quoting
- **RewardQuoteHelperDLend.sol**: DLend-specific reward quoting implementation
- **Mock contracts**: Testing contracts with mocked external dependencies

## Setup

```bash
yarn install
```

## Usage

```bash
# Compile contracts
make compile

# Run tests
make test

# Run linter
make lint

# Deploy to Sonic mainnet
make deploy-contracts.sonic_mainnet

# Deploy to Sonic testnet
make deploy-contracts.sonic_testnet
```

## Testing

Tests use mock contracts to avoid external dependencies. Run with:

```bash
make test
```
```

#### bot-typescript/README.md

```markdown
# DLoop Reward Compounder - TypeScript Bot

This sub-repository contains the TypeScript bot logic for the DLoop reward compounder.

## Architecture

- **Runner**: Main bot execution loop
- **Services**: Core business logic (reward quoting, compounding)
- **Config**: Network-specific configurations
- **Utils**: Helper functions and utilities

## Setup

```bash
yarn install
```

## Usage

```bash
# Build the bot
make build

# Run the bot on Sonic mainnet
make run network=sonic_mainnet

# Run the bot on Sonic testnet
make run network=sonic_testnet

# Run tests
make test

# Run linter
make lint
```

## Docker

```bash
# Build Docker image
make docker.build.arm64

# Run Docker container
make docker.run network=sonic_mainnet
```

## Testing

Tests use mocked external dependencies. Run with:

```bash
make test
```
```

### 7. Create Initial Commit

```bash
# Add all files and commit
git add .
git commit -m "Initial scaffold and directory structure"
```

## Acceptance Criteria

- ✅ Main Git repository initialized with proper .gitignore
- ✅ Two independent sub-repositories created (bot-solidity-contracts, bot-typescript)
- ✅ Proper directory structure created for both subrepos
- ✅ Package.json files created with correct dependencies
- ✅ TypeScript configuration files created
- ✅ Initial README files created
- ✅ All files committed to Git

## Next Steps

Proceed to Step 02: Set up Solidity contracts subrepo with Hardhat configuration.
