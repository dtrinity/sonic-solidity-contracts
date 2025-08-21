# Step 09: Set up TypeScript Bot Subrepo

## Objective

Configure the TypeScript bot subrepo with proper project structure, dependencies, and configuration files.

## Implementation Tasks

### 1. Create TypeScript Configuration Files

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
    "sourceMap": true,
    "removeComments": false,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitReturns": true,
    "noImplicitThis": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "test",
    "**/*.test.ts"
  ]
}
```

#### bot-typescript/eslint.config.mjs

```javascript
import eslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": eslint,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-expressions": "error",
      "@typescript-eslint/prefer-const": "error",
      "@typescript-eslint/no-var-requires": "error",
      "prefer-arrow-callback": "error",
      "arrow-spacing": "error",
      "eqeqeq": ["error", "always"],
      "curly": ["error", "all"],
      "brace-style": ["error", "1tbs"],
      "comma-dangle": ["error", "always-multiline"],
      "quotes": ["error", "double"],
      "semi": ["error", "always"]
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
```

#### bot-typescript/jest.config.js

```javascript
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test", "<rootDir>/src"],
  testMatch: [
    "**/__tests__/**/*.ts",
    "**/?(*.)+(spec|test).ts"
  ],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/types.ts"
  ],
  coverageDirectory: "coverage",
  coverageReporters: [
    "text",
    "lcov",
    "html"
  ],
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  moduleNameMapping: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testTimeout: 30000,
  verbose: true
};
```

### 2. Create Package Configuration

#### bot-typescript/package.json

```json
{
  "name": "@stably/dloop-reward-compounder-bot",
  "version": "1.0.0",
  "description": "TypeScript bot for DLoop reward compounding",
  "license": "MIT",
  "author": "Stably",
  "main": "dist/runner.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/runner.js",
    "dev": "ts-node src/runner.ts",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint --fix src/**/*.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "clean": "rm -rf dist/",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "ethers": "^6.8.1",
    "@slack/web-api": "^6.9.1",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "@types/jest": "^29.5.8",
    "@types/node": "^18.19.8",
    "@types/node-cron": "^3.0.11",
    "@typescript-eslint/eslint-plugin": "^6.13.1",
    "@typescript-eslint/parser": "^6.13.1",
    "eslint": "^8.54.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  },
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=8.0.0"
  },
  "keywords": [
    "defi",
    "blockchain",
    "ethereum",
    "sonic",
    "dloop",
    "rewards",
    "bot"
  ],
  "packageManager": "yarn@4.0.2"
}
```

### 3. Create Yarn Configuration

#### bot-typescript/.yarnrc.yml

```yaml
nodeLinker: node-modules

yarnPath: .yarn/releases/yarn-4.0.2.cjs
```

### 4. Create Environment Configuration

#### bot-typescript/.env.example

```bash
# Network Configuration
NETWORK=sonic_mainnet
RPC_URL=https://rpc.soniclabs.com
PRIVATE_KEY=0x1234567890123456789012345678901234567890123456789012345678901234

# Contract Addresses (will be filled after deployment)
REWARD_QUOTE_HELPER_ADDRESS=0x0000000000000000000000000000000000000000
REWARD_COMPOUNDER_ADDRESS=0x0000000000000000000000000000000000000000

# Bot Configuration
RUN_INTERVAL_MINUTES=5
MAX_SLIPPAGE_BPS=50
MIN_PROFIT_THRESHOLD=1000000000000000000

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
SLACK_CHANNEL=#dloop-bot-notifications

# Logging
LOG_LEVEL=info
LOG_FILE=logs/bot.log

# Risk Management
MAX_GAS_PRICE_GWEI=1000
CIRCUIT_BREAKER_ENABLED=true
```

### 5. Create TypeScript Source Structure

#### bot-typescript/src/types/index.ts

```typescript
// Global types and interfaces

export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  contracts: {
    rewardQuoteHelper: string;
    rewardCompounder: string;
    dloopCore: string;
    rewardClaimable: string;
    flashLender: string;
    dusd: string;
    sfrxUSD: string;
    odosRouter: string;
  };
}

export interface BotConfig {
  network: string;
  runIntervalMinutes: number;
  maxSlippageBps: number;
  minProfitThreshold: bigint;
  maxGasPriceGwei: number;
  circuitBreakerEnabled: boolean;
}

export interface RewardQuote {
  expectedRewards: bigint;
  grossRewards: bigint;
  requiredCollateral: bigint;
  requiredFlashAmount: bigint;
  flashFee: bigint;
  estimatedProfit: bigint;
  isProfitable: boolean;
  sharesAmount: bigint;
}

export interface TransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  profit?: bigint;
  gasUsed?: bigint;
}

export interface NotificationPayload {
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  data?: any;
  timestamp: number;
}

export enum BotStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  ERROR = 'error'
}
```

#### bot-typescript/src/config/networks/sonic_mainnet.ts

```typescript
import { NetworkConfig } from '../types';

export const sonicMainnetConfig: NetworkConfig = {
  name: 'sonic_mainnet',
  rpcUrl: process.env.RPC_URL || 'https://rpc.soniclabs.com',
  chainId: 1946,
  contracts: {
    rewardQuoteHelper: process.env.REWARD_QUOTE_HELPER_ADDRESS || '0x0000000000000000000000000000000000000000',
    rewardCompounder: process.env.REWARD_COMPOUNDER_ADDRESS || '0x0000000000000000000000000000000000000000',
    dloopCore: '0x...', // Deployed DLoopCoreDLend address
    rewardClaimable: '0x...', // Deployed RewardClaimable address
    flashLender: '0x...', // ERC3156 Flash Lender address
    dusd: '0x...', // dUSD token address
    sfrxUSD: '0x...', // sfrxUSD collateral token address
    odosRouter: '0x...', // Odos router address
  },
};
```

#### bot-typescript/src/config/networks/sonic_testnet.ts

```typescript
import { NetworkConfig } from '../types';

export const sonicTestnetConfig: NetworkConfig = {
  name: 'sonic_testnet',
  rpcUrl: process.env.RPC_URL || 'https://rpc.blaze.soniclabs.com',
  chainId: 1947,
  contracts: {
    rewardQuoteHelper: process.env.REWARD_QUOTE_HELPER_ADDRESS || '0x0000000000000000000000000000000000000000',
    rewardCompounder: process.env.REWARD_COMPOUNDER_ADDRESS || '0x0000000000000000000000000000000000000000',
    dloopCore: '0x...', // Deployed DLoopCoreDLend address
    rewardClaimable: '0x...', // Deployed RewardClaimable address
    flashLender: '0x...', // ERC3156 Flash Lender address
    dusd: '0x...', // dUSD token address
    sfrxUSD: '0x...', // sfrxUSD collateral token address
    odosRouter: '0x...', // Odos router address
  },
};
```

#### bot-typescript/src/config/index.ts

```typescript
import { sonicMainnetConfig } from './networks/sonic_mainnet';
import { sonicTestnetConfig } from './networks/sonic_testnet';
import { NetworkConfig, BotConfig } from './types';

export function getNetworkConfig(network: string): NetworkConfig {
  switch (network) {
    case 'sonic_mainnet':
      return sonicMainnetConfig;
    case 'sonic_testnet':
      return sonicTestnetConfig;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}

export function getBotConfig(): BotConfig {
  return {
    network: process.env.NETWORK || 'sonic_mainnet',
    runIntervalMinutes: parseInt(process.env.RUN_INTERVAL_MINUTES || '5'),
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '50'),
    minProfitThreshold: BigInt(process.env.MIN_PROFIT_THRESHOLD || '1000000000000000000'),
    maxGasPriceGwei: parseInt(process.env.MAX_GAS_PRICE_GWEI || '1000'),
    circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED === 'true',
  };
}
```

### 6. Create Logger Configuration

#### bot-typescript/src/utils/logger.ts

```typescript
import winston from 'winston';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const logFile = process.env.LOG_FILE || 'logs/bot.log';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'dloop-reward-compounder' },
  transports: [
    new winston.transports.File({
      filename: logFile,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

export default logger;
```

### 7. Create Base Service Classes

#### bot-typescript/src/services/base/BaseService.ts

```typescript
import { ethers } from 'ethers';
import logger from '../../utils/logger';
import { NetworkConfig } from '../../types';

export abstract class BaseService {
  protected provider: ethers.Provider;
  protected networkConfig: NetworkConfig;

  constructor(networkConfig: NetworkConfig) {
    this.networkConfig = networkConfig;
    this.provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  }

  protected async getGasPrice(): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();
      return feeData.gasPrice || 1000000000n; // 1 gwei fallback
    } catch (error) {
      logger.warn('Failed to get gas price, using default', error);
      return 1000000000n; // 1 gwei fallback
    }
  }

  protected logError(message: string, error: any): void {
    logger.error(message, {
      error: error.message || error,
      stack: error.stack
    });
  }

  protected logInfo(message: string, data?: any): void {
    logger.info(message, data);
  }
}
```

### 8. Create Makefile

#### bot-typescript/Makefile

```makefile
.PHONY: build run test lint clean install

# Build the project
build:
	yarn tsc

# Run the bot
run:
	@if [ -z "$(network)" ]; then \
		echo "Usage: make run network=<network>"; \
		echo "Example: make run network=sonic_mainnet"; \
		exit 1; \
	fi
	NETWORK=$(network) yarn start

# Run in development mode
dev:
	NETWORK=sonic_testnet yarn dev

# Install dependencies
install:
	yarn install

# Run tests
test:
	yarn test

# Run tests with coverage
test-coverage:
	yarn test:coverage

# Run linter
lint:
	yarn lint

# Fix linting issues
lint-fix:
	yarn lint:fix

# Clean build artifacts
clean:
	yarn clean

# Build Docker image (ARM64)
docker-build-arm64:
	docker build -t dloop-reward-compounder:arm64 -f Dockerfile.arm64 .

# Build Docker image (AMD64)
docker-build-amd64:
	docker build -t dloop-reward-compounder:amd64 -f Dockerfile.amd64 .

# Run Docker container
docker-run:
	@if [ -z "$(network)" ]; then \
		echo "Usage: make docker-run network=<network>"; \
		echo "Example: make docker-run network=sonic_mainnet"; \
		exit 1; \
	fi
	docker run --env-file .env -e NETWORK=$(network) dloop-reward-compounder:arm64

# Show help
help:
	@echo "Available targets:"
	@echo "  build              - Build the TypeScript project"
	@echo "  run               - Run the bot (requires network parameter)"
	@echo "  dev               - Run in development mode"
	@echo "  install           - Install dependencies"
	@echo "  test              - Run tests"
	@echo "  test-coverage     - Run tests with coverage"
	@echo "  lint              - Run linter"
	@echo "  lint-fix          - Fix linting issues"
	@echo "  clean             - Clean build artifacts"
	@echo "  docker-build-arm64 - Build Docker image for ARM64"
	@echo "  docker-build-amd64 - Build Docker image for AMD64"
	@echo "  docker-run        - Run Docker container (requires network parameter)"
```

## Acceptance Criteria

- ✅ TypeScript configuration with strict settings
- ✅ ESLint configuration for code quality
- ✅ Jest configuration for testing
- ✅ Package.json with proper dependencies and scripts
- ✅ Environment configuration template
- ✅ Network-specific configuration files
- ✅ Type definitions and interfaces
- ✅ Logger configuration
- ✅ Base service classes
- ✅ Makefile with all required targets
- ✅ All configurations follow TypeScript best practices

## Next Steps

Proceed to Step 10: Implement bot runner and core logic.
