# Step 02: Set up Solidity Contracts Subrepo with Hardhat

## Objective

Configure the Solidity contracts subrepo with Hardhat, including all necessary configuration files, dependencies, and project setup.

## Implementation Tasks

### 1. Create Hardhat Configuration

#### bot-solidity-contracts/hardhat.config.ts

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
      forking: {
        url: process.env.MAINNET_RPC_URL || "https://rpc.soniclabs.com",
        blockNumber: 12345678, // Update with appropriate block number
      },
    },
    sonic_mainnet: {
      url: process.env.SONIC_MAINNET_RPC_URL || "https://rpc.soniclabs.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 1946,
    },
    sonic_testnet: {
      url: process.env.SONIC_TESTNET_RPC_URL || "https://rpc.blaze.soniclabs.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 1947,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
  },
  mocha: {
    timeout: 40000,
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
};

export default config;
```

### 2. Create Solhint Configuration

#### bot-solidity-contracts/.solhint.json

```json
{
  "extends": ["solhint:recommended"],
  "plugins": ["prettier"],
  "rules": {
    "compiler-version": ["error", "^0.8.20"],
    "func-visibility": ["warn", { "ignoreConstructors": true }],
    "modifier-name-mixedcase": "off",
    "not-rely-on-time": "off",
    "avoid-suicide": "error",
    "avoid-sha3": "warn",
    "state-visibility": "warn",
    "var-name-mixedcase": "off",
    "imports-on-top": "error",
    "ordering": "warn",
    "visibility-modifier-order": "warn",
    "no-global-import": "off",
    "prettier/prettier": "error",
    "max-line-length": ["error", 120],
    "no-empty-blocks": "warn",
    "no-unused-vars": "warn",
    "not-rely-on-time": "off",
    "avoid-low-level-calls": "warn",
    "func-name-mixedcase": "off"
  }
}
```

#### bot-solidity-contracts/.solhintignore

```
node_modules/
artifacts/
cache/
typechain-types/
```

### 3. Create Prettier Configuration

#### bot-solidity-contracts/.prettierrc

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": false,
  "printWidth": 120,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "avoid"
}
```

#### bot-solidity-contracts/.prettierignore

```
node_modules/
artifacts/
cache/
typechain-types/
coverage/
```

### 4. Create Environment Configuration

#### bot-solidity-contracts/.env.example

```bash
# RPC URLs
SONIC_MAINNET_RPC_URL=https://rpc.soniclabs.com
SONIC_TESTNET_RPC_URL=https://rpc.blaze.soniclabs.com
MAINNET_RPC_URL=https://rpc.soniclabs.com

# Private Key (for deployments)
PRIVATE_KEY=0x1234567890123456789012345678901234567890123456789012345678901234

# Optional: CoinMarketCap API Key for gas reporting
COINMARKETCAP_API_KEY=your_coinmarketcap_api_key

# Optional: Etherscan API Key for contract verification
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### 5. Create Makefile

#### bot-solidity-contracts/Makefile

```makefile
.PHONY: compile test lint clean deploy-contracts.sonic_mainnet deploy-contracts.sonic_testnet

# Compile contracts
compile:
	npx hardhat compile

# Run tests
test:
	npx hardhat test

# Run linter
lint:
	npx solhint 'contracts/**/*.sol'

# Fix linting issues
lint-fix:
	npx solhint --fix 'contracts/**/*.sol'

# Clean build artifacts
clean:
	npx hardhat clean
	rm -rf typechain-types

# Generate TypeChain types
typechain:
	npx hardhat typechain

# Deploy to Sonic mainnet
deploy-contracts.sonic_mainnet:
	npx hardhat run deploy/main.ts --network sonic_mainnet

# Deploy to Sonic testnet
deploy-contracts.sonic_testnet:
	npx hardhat run deploy/main.ts --network sonic_testnet

# Run gas reporter
gas-report:
	REPORT_GAS=true npx hardhat test

# Run coverage
coverage:
	npx hardhat coverage

# Install dependencies
install:
	yarn install

# Format code
format:
	npx prettier --write "contracts/**/*.sol" "test/**/*.ts" "deploy/**/*.ts" "*.ts"
```

### 6. Create Jest Configuration for Hardhat Tests

#### bot-solidity-contracts/jest.config.ts

```typescript
import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: [
    "test/**/*.ts",
    "!test/**/*.d.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: [],
  moduleNameMapping: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testTimeout: 30000,
};

export default config;
```

### 7. Create Yarn Configuration

#### bot-solidity-contracts/.yarnrc.yml

```yaml
nodeLinker: node-modules

yarnPath: .yarn/releases/yarn-4.0.2.cjs
```

### 8. Create ESLint Configuration for TypeScript Files

#### bot-solidity-contracts/eslint.config.mjs

```javascript
import eslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: parser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": eslint,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
];
```

### 9. Create Initial Contract Structure

#### bot-solidity-contracts/contracts/interfaces/IDLoopCoreDLend.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDLoopCoreDLend {
    function compoundRewards(uint256 amount, address[] calldata rewardTokens, address receiver) external;
    function exchangeThreshold() external view returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);
    function previewMint(uint256 shares) external view returns (uint256);
    function mint(uint256 shares, address receiver) external returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256);
}
```

#### bot-solidity-contracts/contracts/interfaces/IRewardClaimable.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRewardClaimable {
    function treasuryFeeBps() external view returns (uint256);
    function exchangeThreshold() external view returns (uint256);
    function getTreasuryFee(uint256 amount) external view returns (uint256);
}
```

#### bot-solidity-contracts/contracts/interfaces/IERC3156FlashLender.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC3156FlashBorrower.sol";

interface IERC3156FlashLender {
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);

    function maxFlashLoan(address token) external view returns (uint256);
    function flashFee(address token, uint256 amount) external view returns (uint256);
}
```

#### bot-solidity-contracts/contracts/interfaces/IERC3156FlashBorrower.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC3156FlashBorrower {
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}
```

### 10. Create Network Configuration Files

#### bot-solidity-contracts/config/networks/sonic_mainnet.ts

```typescript
export const sonicMainnetConfig = {
  // DLoop Core Contracts
  DLOOP_CORE_DLEND: "0x...", // Deployed DLoopCoreDLend address
  REWARD_CLAIMABLE: "0x...", // Deployed RewardClaimable address

  // dLEND Protocol Contracts
  DLEND_POOL: "0x...", // dLEND Pool address
  DLEND_REWARDS_CONTROLLER: "0x...", // RewardsController address
  DLEND_ADDRESS_PROVIDER: "0x...", // PoolAddressesProvider address

  // Flashloan Providers
  FLASH_LENDER: "0x...", // ERC3156 Flash Lender address

  // Tokens
  DUSD: "0x...", // dUSD token address
  SFrxUSD: "0x...", // sfrxUSD collateral token address

  // DEX Aggregators
  ODOS_ROUTER: "0x...", // Odos router address
};

export type SonicMainnetConfig = typeof sonicMainnetConfig;
```

#### bot-solidity-contracts/config/networks/sonic_testnet.ts

```typescript
export const sonicTestnetConfig = {
  // DLoop Core Contracts
  DLOOP_CORE_DLEND: "0x...", // Deployed DLoopCoreDLend address
  REWARD_CLAIMABLE: "0x...", // Deployed RewardClaimable address

  // dLEND Protocol Contracts
  DLEND_POOL: "0x...", // dLEND Pool address
  DLEND_REWARDS_CONTROLLER: "0x...", // RewardsController address
  DLEND_ADDRESS_PROVIDER: "0x...", // PoolAddressesProvider address

  // Flashloan Providers
  FLASH_LENDER: "0x...", // ERC3156 Flash Lender address

  // Tokens
  DUSD: "0x...", // dUSD token address
  SFrxUSD: "0x...", // sfrxUSD collateral token address

  // DEX Aggregators
  ODOS_ROUTER: "0x...", // Odos router address
};

export type SonicTestnetConfig = typeof sonicTestnetConfig;
```

### 11. Create Initial Deployment Script Structure

#### bot-solidity-contracts/deploy/main.ts

```typescript
import { ethers } from "hardhat";
import { sonicMainnetConfig } from "../config/networks/sonic_mainnet";
import { sonicTestnetConfig } from "../config/networks/sonic_testnet";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", await deployer.getAddress());

  const network = process.env.HARDHAT_NETWORK || "hardhat";
  const config = network === "sonic_mainnet" ? sonicMainnetConfig : sonicTestnetConfig;

  console.log("Network:", network);
  console.log("Config:", config);

  // TODO: Deploy contracts
  // 1. Deploy RewardQuoteHelperDLend
  // 2. Deploy RewardCompounderDLendOdos

  console.log("Deployment completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

### 12. Update package.json with Additional Scripts

Update the package.json to include the new Makefile targets:

```json
{
  "scripts": {
    "compile": "make compile",
    "test": "make test",
    "lint": "make lint",
    "lint:fix": "make lint-fix",
    "clean": "make clean",
    "typechain": "make typechain",
    "deploy:sonic_mainnet": "make deploy-contracts.sonic_mainnet",
    "deploy:sonic_testnet": "make deploy-contracts.sonic_testnet",
    "gas-report": "make gas-report",
    "coverage": "make coverage"
  }
}
```

## Acceptance Criteria

- ✅ Hardhat configuration created with proper network settings
- ✅ Solhint configuration created with Solidity linting rules
- ✅ Prettier configuration for code formatting
- ✅ Environment configuration template created
- ✅ Makefile with all required targets created
- ✅ Jest configuration for Hardhat tests
- ✅ ESLint configuration for TypeScript files
- ✅ Initial contract interfaces created
- ✅ Network configuration files created
- ✅ Deployment script structure created
- ✅ All configurations follow the parent repo patterns

## Verification

Run these commands to verify the setup:

```bash
cd bot-solidity-contracts
make compile  # Should compile without errors
make lint     # Should pass linting checks
```

## Next Steps

Proceed to Step 03: Implement base contracts and interfaces.
