# Step 10: Implement Bot Runner and Core Logic

## Objective

Implement the main bot runner and core orchestration logic that coordinates all bot activities.

## Implementation Tasks

### 1. Create Main Runner

#### bot-typescript/src/runner.ts

```typescript
import 'dotenv/config';
import cron from 'node-cron';
import { ethers } from 'ethers';
import { getNetworkConfig, getBotConfig } from './config';
import { BotStatus } from './types';
import { RewardCompounderBot } from './services/RewardCompounderBot';
import { NotificationManager } from './services/NotificationManager';
import logger from './utils/logger';

class BotRunner {
  private bot: RewardCompounderBot;
  private notificationManager: NotificationManager;
  private status: BotStatus = BotStatus.IDLE;
  private cronJob: cron.ScheduledTask | null = null;

  constructor() {
    const networkConfig = getNetworkConfig(process.env.NETWORK || 'sonic_mainnet');
    const botConfig = getBotConfig();

    this.notificationManager = new NotificationManager();
    this.bot = new RewardCompounderBot(networkConfig, botConfig, this.notificationManager);

    this.setupSignalHandlers();
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting DLoop Reward Compounder Bot');

      // Initialize bot
      await this.bot.initialize();

      // Start scheduled execution
      this.startScheduler();

      this.status = BotStatus.RUNNING;
      logger.info('Bot started successfully');

      // Send startup notification
      await this.notificationManager.notify({
        type: 'info',
        title: 'Bot Started',
        message: `DLoop Reward Compounder Bot started on ${process.env.NETWORK}`,
        timestamp: Date.now()
      });

    } catch (error) {
      this.status = BotStatus.ERROR;
      logger.error('Failed to start bot', error);

      await this.notificationManager.notify({
        type: 'error',
        title: 'Bot Startup Failed',
        message: `Failed to start bot: ${error.message}`,
        data: { error: error.message },
        timestamp: Date.now()
      });

      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping DLoop Reward Compounder Bot');

      if (this.cronJob) {
        this.cronJob.stop();
        this.cronJob = null;
      }

      await this.bot.shutdown();
      this.status = BotStatus.IDLE;

      logger.info('Bot stopped successfully');

      await this.notificationManager.notify({
        type: 'info',
        title: 'Bot Stopped',
        message: 'DLoop Reward Compounder Bot stopped gracefully',
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('Error stopping bot', error);
      throw error;
    }
  }

  /**
   * Start the cron scheduler
   */
  private startScheduler(): void {
    const botConfig = getBotConfig();
    const cronExpression = `*/${botConfig.runIntervalMinutes} * * * *`;

    logger.info(`Scheduling bot runs every ${botConfig.runIntervalMinutes} minutes`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      if (this.status === BotStatus.RUNNING) {
        try {
          await this.executeCycle();
        } catch (error) {
          logger.error('Error in scheduled execution', error);
        }
      }
    });
  }

  /**
   * Execute one bot cycle
   */
  async executeCycle(): Promise<void> {
    const cycleId = Date.now().toString();

    try {
      logger.info(`Starting execution cycle ${cycleId}`);

      const result = await this.bot.executeCycle(cycleId);

      if (result.success) {
        logger.info(`Cycle ${cycleId} completed successfully`, {
          profit: result.profit?.toString(),
          txHash: result.txHash
        });
      } else {
        logger.warn(`Cycle ${cycleId} completed with issues`, {
          error: result.error
        });
      }

    } catch (error) {
      logger.error(`Cycle ${cycleId} failed`, error);

      await this.notificationManager.notify({
        type: 'error',
        title: 'Execution Cycle Failed',
        message: `Cycle ${cycleId} failed: ${error.message}`,
        data: { cycleId, error: error.message },
        timestamp: Date.now()
      });
    }
  }

  /**
   * Get bot status
   */
  getStatus(): BotStatus {
    return this.status;
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      this.stop().finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
      this.stop().finally(() => process.exit(1));
    });
  }
}

// Main execution
async function main() {
  try {
    const runner = new BotRunner();

    // Handle manual execution if requested
    if (process.argv.includes('--once')) {
      await runner.start();
      await runner.executeCycle();
      await runner.stop();
    } else {
      await runner.start();

      // Keep the process running
      setInterval(() => {
        // Periodic health check
        const status = runner.getStatus();
        logger.debug(`Bot health check - Status: ${status}`);
      }, 60000); // Every minute
    }

  } catch (error) {
    logger.error('Bot execution failed', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { BotRunner };
```

### 2. Create Core Bot Service

#### bot-typescript/src/services/RewardCompounderBot.ts

```typescript
import { ethers } from 'ethers';
import { NetworkConfig, BotConfig, TransactionResult, RewardQuote } from '../types';
import { BaseService } from './base/BaseService';
import { RewardQuotingService } from './RewardQuotingService';
import { CompoundExecutionService } from './CompoundExecutionService';
import { NotificationManager } from './NotificationManager';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import logger from '../utils/logger';

export class RewardCompounderBot extends BaseService {
  private wallet: ethers.Wallet;
  private rewardQuotingService: RewardQuotingService;
  private compoundExecutionService: CompoundExecutionService;
  private notificationManager: NotificationManager;
  private circuitBreaker: CircuitBreaker;
  private botConfig: BotConfig;

  constructor(
    networkConfig: NetworkConfig,
    botConfig: BotConfig,
    notificationManager: NotificationManager
  ) {
    super(networkConfig);

    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }

    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
    this.botConfig = botConfig;
    this.notificationManager = notificationManager;
    this.circuitBreaker = new CircuitBreaker(5, 300000); // 5 failures, 5 min reset

    this.rewardQuotingService = new RewardQuotingService(networkConfig, this.wallet);
    this.compoundExecutionService = new CompoundExecutionService(
      networkConfig,
      this.wallet,
      botConfig
    );
  }

  /**
   * Initialize the bot
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Reward Compounder Bot');

      // Validate network connection
      const network = await this.provider.getNetwork();
      logger.info(`Connected to network: ${network.name} (${network.chainId})`);

      // Validate wallet
      const balance = await this.provider.getBalance(this.wallet.address);
      logger.info(`Wallet balance: ${ethers.formatEther(balance)} ETH`);

      if (balance < ethers.parseEther('0.1')) {
        throw new Error('Insufficient wallet balance');
      }

      // Initialize services
      await this.rewardQuotingService.initialize();
      await this.compoundExecutionService.initialize();

      logger.info('Bot initialized successfully');

    } catch (error) {
      this.logError('Failed to initialize bot', error);
      throw error;
    }
  }

  /**
   * Execute one compounding cycle
   */
  async executeCycle(cycleId: string): Promise<TransactionResult> {
    try {
      logger.info(`Executing cycle ${cycleId}`);

      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        logger.warn(`Circuit breaker is open, skipping cycle ${cycleId}`);
        return {
          success: false,
          error: 'Circuit breaker is open'
        };
      }

      // Step 1: Get reward quote
      logger.debug(`Step 1: Getting reward quote for cycle ${cycleId}`);
      const quote = await this.rewardQuotingService.getRewardQuote(0); // Use exchange threshold

      if (!quote.isProfitable) {
        logger.info(`No profitable opportunities found in cycle ${cycleId}`);
        return {
          success: false,
          error: 'No profitable opportunities'
        };
      }

      // Step 2: Validate profitability
      if (quote.estimatedProfit < this.botConfig.minProfitThreshold) {
        logger.info(`Profit below threshold in cycle ${cycleId}`, {
          profit: quote.estimatedProfit.toString(),
          threshold: this.botConfig.minProfitThreshold.toString()
        });
        return {
          success: false,
          error: 'Profit below threshold'
        };
      }

      // Step 3: Execute compounding
      logger.debug(`Step 3: Executing compounding for cycle ${cycleId}`);
      const result = await this.compoundExecutionService.executeCompounding(
        quote,
        cycleId
      );

      if (result.success) {
        logger.info(`Compounding successful in cycle ${cycleId}`, {
          profit: result.profit?.toString(),
          txHash: result.txHash
        });

        // Reset circuit breaker on success
        this.circuitBreaker.reset();

        // Send success notification
        await this.notificationManager.notify({
          type: 'success',
          title: 'Reward Compounding Successful',
          message: `Successfully compounded rewards in cycle ${cycleId}`,
          data: {
            cycleId,
            profit: result.profit?.toString(),
            txHash: result.txHash
          },
          timestamp: Date.now()
        });

      } else {
        logger.warn(`Compounding failed in cycle ${cycleId}`, {
          error: result.error
        });

        // Record failure in circuit breaker
        this.circuitBreaker.recordFailure();

        // Send error notification
        await this.notificationManager.notify({
          type: 'error',
          title: 'Reward Compounding Failed',
          message: `Failed to compound rewards in cycle ${cycleId}: ${result.error}`,
          data: {
            cycleId,
            error: result.error
          },
          timestamp: Date.now()
        });
      }

      return result;

    } catch (error) {
      this.logError(`Cycle ${cycleId} execution failed`, error);

      // Record failure in circuit breaker
      this.circuitBreaker.recordFailure();

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Shutdown the bot
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down Reward Compounder Bot');

      await this.rewardQuotingService.shutdown();
      await this.compoundExecutionService.shutdown();

      logger.info('Bot shutdown completed');

    } catch (error) {
      this.logError('Error during bot shutdown', error);
    }
  }

  /**
   * Get bot statistics
   */
  getStats() {
    return {
      circuitBreakerState: this.circuitBreaker.getState(),
      network: this.networkConfig.name,
      walletAddress: this.wallet.address
    };
  }
}
```

### 3. Create Circuit Breaker Utility

#### bot-typescript/src/utils/CircuitBreaker.ts

```typescript
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly resetTimeoutMs: number
  ) {}

  /**
   * Check if circuit breaker is open
   */
  isOpen(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return false;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if we should transition to half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }
}
```

### 4. Create Health Check Service

#### bot-typescript/src/services/HealthCheckService.ts

```typescript
import { ethers } from 'ethers';
import { NetworkConfig } from '../types';
import { BaseService } from './base/BaseService';

export interface HealthStatus {
  network: boolean;
  contracts: boolean;
  wallet: boolean;
  overall: boolean;
  details: {
    rpcReachable: boolean;
    contractsDeployed: boolean;
    walletBalance: bigint;
    gasPrice: bigint;
    lastBlock: number;
  };
}

export class HealthCheckService extends BaseService {
  private wallet: ethers.Wallet;

  constructor(networkConfig: NetworkConfig, wallet: ethers.Wallet) {
    super(networkConfig);
    this.wallet = wallet;
  }

  /**
   * Perform comprehensive health check
   */
  async checkHealth(): Promise<HealthStatus> {
    const status: HealthStatus = {
      network: false,
      contracts: false,
      wallet: false,
      overall: false,
      details: {
        rpcReachable: false,
        contractsDeployed: false,
        walletBalance: 0n,
        gasPrice: 0n,
        lastBlock: 0
      }
    };

    try {
      // Check network connectivity
      status.details.lastBlock = await this.provider.getBlockNumber();
      status.details.rpcReachable = true;
      status.network = true;

      // Check wallet balance
      status.details.walletBalance = await this.provider.getBalance(this.wallet.address);
      status.wallet = status.details.walletBalance > ethers.parseEther('0.01');

      // Check gas price
      const feeData = await this.provider.getFeeData();
      status.details.gasPrice = feeData.gasPrice || 0n;

      // Check contract deployments (simplified check)
      const code = await this.provider.getCode(this.networkConfig.contracts.rewardCompounder);
      status.details.contractsDeployed = code !== '0x';
      status.contracts = status.details.contractsDeployed;

      // Overall health
      status.overall = status.network && status.contracts && status.wallet;

    } catch (error) {
      this.logError('Health check failed', error);
    }

    return status;
  }

  /**
   * Get quick health status
   */
  async isHealthy(): Promise<boolean> {
    const status = await this.checkHealth();
    return status.overall;
  }
}
```

## Acceptance Criteria

- ✅ Main bot runner with cron scheduling
- ✅ Core bot service with cycle execution
- ✅ Circuit breaker for fault tolerance
- ✅ Health check service
- ✅ Proper error handling and logging
- ✅ Graceful shutdown handling
- ✅ Signal handlers for process management
- ✅ Notification integration

## Next Steps

Proceed to Step 11: Implement reward quoting and decision logic.
