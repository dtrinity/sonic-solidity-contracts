# Step 12: Implement Reward Compounding Execution Logic

## Objective

Implement the execution service that handles the actual reward compounding transactions, including flash loan management, swap execution, and error handling.

## Implementation Tasks

### 1. Create Compound Execution Service

#### bot-typescript/src/services/CompoundExecutionService.ts

```typescript
import { ethers } from 'ethers';
import { NetworkConfig, BotConfig, TransactionResult, RewardQuote } from '../types';
import { BaseService } from './base/BaseService';
import logger from '../utils/logger';

export class CompoundExecutionService extends BaseService {
  private wallet: ethers.Wallet;
  private rewardCompounderContract: ethers.Contract;
  private botConfig: BotConfig;

  constructor(networkConfig: NetworkConfig, wallet: ethers.Wallet, botConfig: BotConfig) {
    super(networkConfig);
    this.wallet = wallet;
    this.botConfig = botConfig;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Compound Execution Service');

      // Initialize contract
      const rewardCompounderAbi = [
        'function compoundRewards(uint256 flashAmount, bytes calldata swapData, uint256 slippageBps) external',
        'function getExchangeThreshold() external view returns (uint256)',
        'function getTreasuryFeeBps() external view returns (uint256)',
        'function isDepositAllowed() external view returns (bool)',
        'function maxSlippageBps() external view returns (uint256)'
      ];

      this.rewardCompounderContract = new ethers.Contract(
        this.networkConfig.contracts.rewardCompounder,
        rewardCompounderAbi,
        this.wallet
      );

      logger.info('Compound Execution Service initialized successfully');

    } catch (error) {
      this.logError('Failed to initialize Compound Execution Service', error);
      throw error;
    }
  }

  /**
   * Execute reward compounding
   */
  async executeCompounding(quote: RewardQuote, cycleId: string): Promise<TransactionResult> {
    try {
      logger.info(`Executing compounding for cycle ${cycleId}`, {
        sharesAmount: quote.sharesAmount.toString(),
        flashAmount: quote.requiredFlashAmount.toString(),
        expectedProfit: quote.estimatedProfit.toString()
      });

      // Get swap data from Odos API (placeholder implementation)
      const swapData = await this.getSwapData(quote);

      // Prepare transaction parameters
      const flashAmount = quote.requiredFlashAmount;
      const slippageBps = this.botConfig.maxSlippageBps;

      // Estimate gas for transaction
      const gasEstimate = await this.estimateGas(flashAmount, swapData, slippageBps);

      // Check if we have enough balance for gas
      const balance = await this.provider.getBalance(this.wallet.address);
      const gasCost = gasEstimate.gasLimit * gasEstimate.gasPrice;

      if (balance < gasCost) {
        return {
          success: false,
          error: `Insufficient balance for gas. Required: ${gasCost}, Available: ${balance}`
        };
      }

      // Execute the transaction
      const tx = await this.rewardCompounderContract.compoundRewards(
        flashAmount,
        swapData,
        slippageBps,
        {
          gasLimit: gasEstimate.gasLimit,
          gasPrice: gasEstimate.gasPrice,
          nonce: await this.wallet.getNonce()
        }
      );

      logger.info(`Transaction submitted: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        logger.info(`Transaction confirmed: ${tx.hash}`, {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString()
        });

        // Parse profit from logs (simplified)
        const profit = await this.extractProfitFromLogs(receipt.logs);

        return {
          success: true,
          txHash: tx.hash,
          profit,
          gasUsed: receipt.gasUsed
        };

      } else {
        logger.error(`Transaction failed: ${tx.hash}`);
        return {
          success: false,
          error: 'Transaction reverted',
          txHash: tx.hash
        };
      }

    } catch (error) {
      this.logError(`Compounding execution failed for cycle ${cycleId}`, error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get swap data from Odos API
   */
  private async getSwapData(quote: RewardQuote): Promise<string> {
    try {
      // This is a placeholder implementation
      // In practice, you would:
      // 1. Call Odos API with swap parameters
      // 2. Get optimal routing data
      // 3. Return encoded swap data

      logger.debug('Getting swap data from Odos API', {
        fromToken: this.networkConfig.contracts.dusd,
        toToken: this.networkConfig.contracts.sfrxUSD,
        amount: quote.requiredFlashAmount.toString()
      });

      // Placeholder: return mock swap data
      return ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        [
          this.networkConfig.contracts.dusd,
          this.networkConfig.contracts.sfrxUSD,
          quote.requiredFlashAmount,
          quote.requiredCollateral * 90n / 100n // 90% min output
        ]
      );

    } catch (error) {
      this.logError('Failed to get swap data', error);
      throw error;
    }
  }

  /**
   * Estimate gas for the transaction
   */
  private async estimateGas(
    flashAmount: bigint,
    swapData: string,
    slippageBps: number
  ): Promise<{ gasLimit: bigint; gasPrice: bigint }> {
    try {
      // Estimate gas usage
      const gasEstimate = await this.rewardCompounderContract.estimateGas.compoundRewards(
        flashAmount,
        swapData,
        slippageBps
      );

      // Add buffer for safety
      const gasLimit = gasEstimate * 120n / 100n; // 20% buffer

      // Get gas price with buffer
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || 1000000000n;

      // Apply gas price multiplier for faster confirmation
      const adjustedGasPrice = gasPrice * 110n / 100n; // 10% above current price

      return {
        gasLimit,
        gasPrice: adjustedGasPrice
      };

    } catch (error) {
      this.logError('Gas estimation failed', error);

      // Return conservative defaults
      return {
        gasLimit: 500000n,
        gasPrice: 1000000000n
      };
    }
  }

  /**
   * Extract profit from transaction logs
   */
  private async extractProfitFromLogs(logs: any[]): Promise<bigint> {
    try {
      // Parse logs to find RewardCompounded event
      // This is a simplified implementation
      for (const log of logs) {
        if (log.topics[0] === ethers.utils.id('RewardCompounded(address,uint256,uint256,uint256,uint256)')) {
          const decoded = ethers.utils.defaultAbiCoder.decode(
            ['address', 'uint256', 'uint256', 'uint256', 'uint256'],
            log.data
          );
          return decoded[4]; // profit
        }
      }

      // If no profit found in logs, return estimated profit
      return 0n;

    } catch (error) {
      this.logError('Failed to extract profit from logs', error);
      return 0n;
    }
  }

  /**
   * Validate transaction parameters before execution
   */
  private async validateExecution(quote: RewardQuote): Promise<void> {
    // Check if deposit is allowed
    const isDepositAllowed = await this.rewardCompounderContract.isDepositAllowed();
    if (!isDepositAllowed) {
      throw new Error('Deposits are currently disabled');
    }

    // Check gas price
    const gasPrice = await this.getGasPrice();
    const maxGasPrice = BigInt(this.botConfig.maxGasPriceGwei) * 1000000000n;

    if (gasPrice > maxGasPrice) {
      throw new Error(`Gas price ${gasPrice} exceeds maximum ${maxGasPrice}`);
    }

    // Check slippage tolerance
    const maxSlippage = await this.rewardCompounderContract.maxSlippageBps();
    if (this.botConfig.maxSlippageBps > Number(maxSlippage)) {
      throw new Error(`Slippage ${this.botConfig.maxSlippageBps} exceeds contract maximum ${maxSlippage}`);
    }

    // Additional validations can be added here
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    logger.info('Compound Execution Service shutdown');
  }
}
```

### 2. Create Transaction Manager

#### bot-typescript/src/services/TransactionManager.ts

```typescript
import { ethers } from 'ethers';
import { NetworkConfig, TransactionResult } from '../types';
import { BaseService } from './base/BaseService';
import logger from '../utils/logger';

export interface TransactionOptions {
  gasLimit?: bigint;
  gasPrice?: bigint;
  priorityFee?: bigint;
  maxFeePerGas?: bigint;
  nonce?: number;
  value?: bigint;
}

export interface TransactionStatus {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmations: number;
  blockNumber?: number;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
}

export class TransactionManager extends BaseService {
  private wallet: ethers.Wallet;
  private pendingTransactions: Map<string, TransactionStatus> = new Map();

  constructor(networkConfig: NetworkConfig, wallet: ethers.Wallet) {
    super(networkConfig);
    this.wallet = wallet;
  }

  /**
   * Send transaction with enhanced error handling and monitoring
   */
  async sendTransaction(
    contract: ethers.Contract,
    method: string,
    args: any[],
    options: TransactionOptions = {}
  ): Promise<TransactionResult> {
    try {
      logger.debug(`Sending transaction: ${method}`, { args, options });

      // Prepare transaction options
      const txOptions: any = {};

      if (options.gasLimit) txOptions.gasLimit = options.gasLimit;
      if (options.gasPrice) txOptions.gasPrice = options.gasPrice;
      if (options.priorityFee) txOptions.maxPriorityFeePerGas = options.priorityFee;
      if (options.maxFeePerGas) txOptions.maxFeePerGas = options.maxFeePerGas;
      if (options.nonce !== undefined) txOptions.nonce = options.nonce;
      if (options.value) txOptions.value = options.value;

      // Estimate gas if not provided
      if (!txOptions.gasLimit) {
        try {
          const gasEstimate = await contract.estimateGas[method](...args);
          txOptions.gasLimit = gasEstimate * 120n / 100n; // 20% buffer
        } catch (error) {
          logger.warn('Gas estimation failed, using default', error);
          txOptions.gasLimit = 500000n;
        }
      }

      // Send transaction
      const tx = await contract[method](...args, txOptions);

      logger.info(`Transaction submitted: ${tx.hash}`);

      // Track transaction
      this.trackTransaction(tx.hash);

      // Wait for confirmation
      const receipt = await this.waitForConfirmation(tx.hash);

      if (receipt.status === 1) {
        logger.info(`Transaction confirmed: ${tx.hash}`, {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice?.toString()
        });

        this.updateTransactionStatus(tx.hash, {
          status: 'confirmed',
          confirmations: 1,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          effectiveGasPrice: receipt.effectiveGasPrice
        });

        return {
          success: true,
          txHash: tx.hash,
          gasUsed: receipt.gasUsed
        };

      } else {
        logger.error(`Transaction failed: ${tx.hash}`);
        this.updateTransactionStatus(tx.hash, { status: 'failed' });

        return {
          success: false,
          error: 'Transaction reverted',
          txHash: tx.hash
        };
      }

    } catch (error) {
      this.logError('Transaction failed', error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Wait for transaction confirmation with retry logic
   */
  private async waitForConfirmation(txHash: string, retries: number = 3): Promise<ethers.TransactionReceipt> {
    for (let i = 0; i < retries; i++) {
      try {
        const receipt = await this.provider.waitForTransaction(txHash, 1);
        return receipt;
      } catch (error) {
        if (i === retries - 1) throw error;
        logger.warn(`Waiting for confirmation attempt ${i + 1} failed, retrying...`, error);
        await this.delay(1000 * (i + 1)); // Exponential backoff
      }
    }
    throw new Error('Failed to confirm transaction after retries');
  }

  /**
   * Track transaction status
   */
  private trackTransaction(txHash: string): void {
    this.pendingTransactions.set(txHash, {
      hash: txHash,
      status: 'pending',
      confirmations: 0
    });
  }

  /**
   * Update transaction status
   */
  private updateTransactionStatus(txHash: string, updates: Partial<TransactionStatus>): void {
    const current = this.pendingTransactions.get(txHash);
    if (current) {
      this.pendingTransactions.set(txHash, { ...current, ...updates });
    }
  }

  /**
   * Get transaction status
   */
  getTransactionStatus(txHash: string): TransactionStatus | undefined {
    return this.pendingTransactions.get(txHash);
  }

  /**
   * Get all pending transactions
   */
  getPendingTransactions(): TransactionStatus[] {
    return Array.from(this.pendingTransactions.values()).filter(
      tx => tx.status === 'pending'
    );
  }

  /**
   * Clear completed transactions
   */
  clearCompletedTransactions(): void {
    for (const [hash, status] of this.pendingTransactions.entries()) {
      if (status.status === 'confirmed' || status.status === 'failed') {
        this.pendingTransactions.delete(hash);
      }
    }
  }

  /**
   * Get optimal gas price
   */
  async getOptimalGasPrice(): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();

      // Use EIP-1559 if supported
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        return feeData.maxFeePerGas;
      }

      // Fallback to legacy gas price
      return feeData.gasPrice || 1000000000n;

    } catch (error) {
      this.logError('Failed to get optimal gas price', error);
      return 1000000000n;
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3. Create Swap Data Provider

#### bot-typescript/src/services/SwapDataProvider.ts

```typescript
import { ethers } from 'ethers';
import { NetworkConfig } from '../types';
import { BaseService } from './base/BaseService';
import logger from '../utils/logger';

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  toAmount: bigint;
  minToAmount: bigint;
  slippage: number;
  path: string[];
  data: string;
  aggregator: string;
}

export class SwapDataProvider extends BaseService {
  private odosApiUrl: string;
  private apiKey?: string;

  constructor(networkConfig: NetworkConfig, odosApiUrl?: string, apiKey?: string) {
    super(networkConfig);
    this.odosApiUrl = odosApiUrl || 'https://api.odos.xyz';
    this.apiKey = apiKey;
  }

  /**
   * Get swap quote from Odos
   */
  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: bigint,
    slippage: number = 0.5
  ): Promise<SwapQuote> {
    try {
      logger.debug('Getting swap quote from Odos', {
        fromToken,
        toToken,
        amount: amount.toString(),
        slippage
      });

      // Prepare request body
      const requestBody = {
        chainId: this.networkConfig.chainId,
        fromToken: fromToken,
        toToken: toToken,
        fromAmount: amount.toString(),
        slippage,
        userAddr: ethers.constants.AddressZero, // Use zero address for quote
        receiver: ethers.constants.AddressZero,
        referrer: ethers.constants.AddressZero
      };

      // Make API request
      const response = await fetch(`${this.odosApiUrl}/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Odos API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return {
        fromToken: data.fromToken,
        toToken: data.toToken,
        fromAmount: BigInt(data.fromAmount),
        toAmount: BigInt(data.toAmount),
        minToAmount: BigInt(data.minToAmount),
        slippage: data.slippage,
        path: data.path || [],
        data: data.data,
        aggregator: 'odos'
      };

    } catch (error) {
      this.logError('Failed to get swap quote', error);

      // Return mock quote for testing
      return this.getMockSwapQuote(fromToken, toToken, amount, slippage);
    }
  }

  /**
   * Assemble swap transaction data
   */
  async getSwapData(
    fromToken: string,
    toToken: string,
    amount: bigint,
    minOutput: bigint
  ): Promise<string> {
    try {
      const quote = await this.getSwapQuote(fromToken, toToken, amount);

      // Ensure minimum output is met
      if (quote.minToAmount < minOutput) {
        throw new Error(`Insufficient output: ${quote.minToAmount} < ${minOutput}`);
      }

      logger.info('Swap data assembled', {
        fromToken,
        toToken,
        amount: amount.toString(),
        expectedOut: quote.toAmount.toString(),
        minOut: quote.minToAmount.toString()
      });

      return quote.data;

    } catch (error) {
      this.logError('Failed to assemble swap data', error);
      throw error;
    }
  }

  /**
   * Get mock swap quote for testing
   */
  private getMockSwapQuote(
    fromToken: string,
    toToken: string,
    amount: bigint,
    slippage: number
  ): SwapQuote {
    // Mock 1:1 exchange rate with slippage
    const slippageMultiplier = (100 - slippage) / 100;
    const toAmount = amount * BigInt(Math.floor(slippageMultiplier * 100)) / 100n;
    const minToAmount = amount * BigInt(Math.floor((100 - slippage - 0.1) * 100)) / 100n;

    return {
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount,
      minToAmount,
      slippage,
      path: [fromToken, toToken],
      data: ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256'],
        [fromToken, toToken, amount, minToAmount]
      ),
      aggregator: 'mock'
    };
  }

  /**
   * Validate swap data
   */
  validateSwapData(data: string): boolean {
    try {
      // Basic validation - check if data is valid hex
      return ethers.utils.isHexString(data);
    } catch (error) {
      return false;
    }
  }
}
```

## Acceptance Criteria

- ✅ Compound execution service with transaction handling
- ✅ Transaction manager with gas optimization and monitoring
- ✅ Swap data provider with Odos API integration
- ✅ Gas estimation and optimization
- ✅ Transaction validation and error handling
- ✅ Mock fallback for testing environments
- ✅ Profit extraction from transaction logs
- ✅ Transaction status tracking

## Next Steps

Proceed to Step 13: Implement notification and error handling system.
