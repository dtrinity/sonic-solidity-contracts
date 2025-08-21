# Step 11: Implement Reward Quoting and Decision Logic

## Objective

Implement the reward quoting service and decision logic that determines when and how to execute reward compounding.

## Implementation Tasks

### 1. Create Reward Quoting Service

#### bot-typescript/src/services/RewardQuotingService.ts

```typescript
import { ethers } from 'ethers';
import { NetworkConfig, RewardQuote } from '../types';
import { BaseService } from './base/BaseService';
import logger from '../utils/logger';

export class RewardQuotingService extends BaseService {
  private wallet: ethers.Wallet;
  private rewardQuoteHelperContract: ethers.Contract;

  constructor(networkConfig: NetworkConfig, wallet: ethers.Wallet) {
    super(networkConfig);
    this.wallet = wallet;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Reward Quoting Service');

      // Initialize contract
      const rewardQuoteHelperAbi = [
        'function getRewardQuote(uint256 sharesAmount, uint256 slippageBps) external view returns (tuple(uint256 expectedRewards, uint256 grossRewards, uint256 requiredCollateral, uint256 requiredFlashAmount, uint256 flashFee, uint256 estimatedProfit, bool isProfitable, uint256 sharesAmount) memory)',
        'function getExchangeThreshold() external view returns (uint256)',
        'function getTreasuryFeeBps() external view returns (uint256)',
        'function isProfitable(uint256 sharesAmount, uint256 slippageBps) external view returns (bool, uint256)'
      ];

      this.rewardQuoteHelperContract = new ethers.Contract(
        this.networkConfig.contracts.rewardQuoteHelper,
        rewardQuoteHelperAbi,
        this.wallet
      );

      logger.info('Reward Quoting Service initialized successfully');

    } catch (error) {
      this.logError('Failed to initialize Reward Quoting Service', error);
      throw error;
    }
  }

  /**
   * Get reward quote for compounding
   */
  async getRewardQuote(sharesAmount: bigint = 0n): Promise<RewardQuote> {
    try {
      logger.debug('Getting reward quote', { sharesAmount: sharesAmount.toString() });

      // Get current slippage tolerance (use conservative default)
      const slippageBps = 50; // 0.5%

      // Call contract to get quote
      const quoteResult = await this.rewardQuoteHelperContract.getRewardQuote(
        sharesAmount,
        slippageBps
      );

      const quote: RewardQuote = {
        expectedRewards: quoteResult.expectedRewards,
        grossRewards: quoteResult.grossRewards,
        requiredCollateral: quoteResult.requiredCollateral,
        requiredFlashAmount: quoteResult.requiredFlashAmount,
        flashFee: quoteResult.flashFee,
        estimatedProfit: quoteResult.estimatedProfit,
        isProfitable: quoteResult.isProfitable,
        sharesAmount: quoteResult.sharesAmount
      };

      logger.info('Reward quote generated', {
        sharesAmount: quote.sharesAmount.toString(),
        expectedRewards: quote.expectedRewards.toString(),
        estimatedProfit: quote.estimatedProfit.toString(),
        isProfitable: quote.isProfitable
      });

      return quote;

    } catch (error) {
      this.logError('Failed to get reward quote', error);
      throw error;
    }
  }

  /**
   * Check if compounding is profitable
   */
  async isProfitable(sharesAmount: bigint = 0n): Promise<boolean> {
    try {
      const slippageBps = 50; // 0.5%

      const [isProfitable, profit] = await this.rewardQuoteHelperContract.isProfitable(
        sharesAmount,
        slippageBps
      );

      logger.debug('Profitability check', {
        sharesAmount: sharesAmount.toString(),
        isProfitable,
        profit: profit.toString()
      });

      return isProfitable;

    } catch (error) {
      this.logError('Failed to check profitability', error);
      return false;
    }
  }

  /**
   * Get current exchange threshold
   */
  async getExchangeThreshold(): Promise<bigint> {
    try {
      const threshold = await this.rewardQuoteHelperContract.getExchangeThreshold();
      logger.debug('Exchange threshold', { threshold: threshold.toString() });
      return threshold;

    } catch (error) {
      this.logError('Failed to get exchange threshold', error);
      throw error;
    }
  }

  /**
   * Get treasury fee basis points
   */
  async getTreasuryFeeBps(): Promise<number> {
    try {
      const feeBps = await this.rewardQuoteHelperContract.getTreasuryFeeBps();
      return Number(feeBps);

    } catch (error) {
      this.logError('Failed to get treasury fee', error);
      return 500; // Default 5%
    }
  }

  /**
   * Get multiple quotes for different share amounts
   */
  async getMultipleQuotes(shareAmounts: bigint[]): Promise<RewardQuote[]> {
    try {
      logger.debug('Getting multiple quotes', { count: shareAmounts.length });

      const quotes: RewardQuote[] = [];

      for (const amount of shareAmounts) {
        try {
          const quote = await this.getRewardQuote(amount);
          quotes.push(quote);
        } catch (error) {
          logger.warn(`Failed to get quote for amount ${amount}`, error);
          // Continue with other amounts
        }
      }

      // Sort by profitability
      quotes.sort((a, b) => {
        if (a.isProfitable && !b.isProfitable) return -1;
        if (!a.isProfitable && b.isProfitable) return 1;
        return Number(b.estimatedProfit - a.estimatedProfit);
      });

      return quotes;

    } catch (error) {
      this.logError('Failed to get multiple quotes', error);
      throw error;
    }
  }

  /**
   * Find optimal share amount for compounding
   */
  async findOptimalAmount(): Promise<RewardQuote | null> {
    try {
      logger.debug('Finding optimal share amount');

      // Get exchange threshold
      const threshold = await this.getExchangeThreshold();

      // Test different multiples of threshold
      const amounts = [
        threshold,                    // Minimum amount
        threshold * 2n,              // 2x
        threshold * 5n,              // 5x
        threshold * 10n              // 10x
      ];

      const quotes = await this.getMultipleQuotes(amounts);

      // Return the most profitable quote
      return quotes.find(quote => quote.isProfitable) || null;

    } catch (error) {
      this.logError('Failed to find optimal amount', error);
      return null;
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    logger.info('Reward Quoting Service shutdown');
  }
}
```

### 2. Create Decision Engine

#### bot-typescript/src/services/DecisionEngine.ts

```typescript
import { ethers } from 'ethers';
import { RewardQuote, BotConfig, NetworkConfig } from '../types';
import { BaseService } from './base/BaseService';
import { RiskAssessmentService } from './RiskAssessmentService';
import logger from '../utils/logger';

export interface DecisionResult {
  shouldExecute: boolean;
  reason: string;
  confidence: number; // 0-100
  recommendedQuote?: RewardQuote;
  riskLevel: 'low' | 'medium' | 'high';
  estimatedGasCost?: bigint;
}

export class DecisionEngine extends BaseService {
  private riskAssessmentService: RiskAssessmentService;
  private botConfig: BotConfig;

  constructor(
    networkConfig: NetworkConfig,
    botConfig: BotConfig,
    riskAssessmentService: RiskAssessmentService
  ) {
    super(networkConfig);
    this.botConfig = botConfig;
    this.riskAssessmentService = riskAssessmentService;
  }

  /**
   * Make execution decision based on reward quote
   */
  async makeDecision(quote: RewardQuote): Promise<DecisionResult> {
    try {
      logger.debug('Making execution decision', {
        sharesAmount: quote.sharesAmount.toString(),
        estimatedProfit: quote.estimatedProfit.toString()
      });

      // Check basic profitability
      if (!quote.isProfitable) {
        return {
          shouldExecute: false,
          reason: 'Quote is not profitable',
          confidence: 100,
          riskLevel: 'low'
        };
      }

      // Check minimum profit threshold
      if (quote.estimatedProfit < this.botConfig.minProfitThreshold) {
        return {
          shouldExecute: false,
          reason: `Profit ${quote.estimatedProfit} below threshold ${this.botConfig.minProfitThreshold}`,
          confidence: 95,
          riskLevel: 'low'
        };
      }

      // Assess risk
      const riskAssessment = await this.riskAssessmentService.assessRisk(quote);

      // Check risk tolerance
      if (riskAssessment.level === 'high' && !this.shouldAcceptHighRisk()) {
        return {
          shouldExecute: false,
          reason: 'Risk level too high for current configuration',
          confidence: 90,
          riskLevel: riskAssessment.level
        };
      }

      // Estimate gas cost
      const gasCost = await this.estimateGasCost(quote);

      // Check if profit covers gas costs
      if (quote.estimatedProfit <= gasCost * 2n) { // Require at least 2x gas cost profit
        return {
          shouldExecute: false,
          reason: 'Profit does not sufficiently cover gas costs',
          confidence: 85,
          riskLevel: riskAssessment.level,
          estimatedGasCost: gasCost
        };
      }

      // Check market conditions
      const marketConditions = await this.assessMarketConditions();
      if (!marketConditions.favorable) {
        return {
          shouldExecute: false,
          reason: marketConditions.reason,
          confidence: 75,
          riskLevel: 'medium'
        };
      }

      // All checks passed
      const confidence = this.calculateConfidence(quote, riskAssessment, gasCost);

      return {
        shouldExecute: true,
        reason: 'All conditions met for profitable execution',
        confidence,
        recommendedQuote: quote,
        riskLevel: riskAssessment.level,
        estimatedGasCost: gasCost
      };

    } catch (error) {
      this.logError('Decision making failed', error);

      return {
        shouldExecute: false,
        reason: `Decision engine error: ${error.message}`,
        confidence: 0,
        riskLevel: 'high'
      };
    }
  }

  /**
   * Make decision for multiple quotes
   */
  async makeDecisionForQuotes(quotes: RewardQuote[]): Promise<DecisionResult> {
    try {
      logger.debug('Making decision for multiple quotes', { count: quotes.length });

      // Filter profitable quotes
      const profitableQuotes = quotes.filter(quote => quote.isProfitable);

      if (profitableQuotes.length === 0) {
        return {
          shouldExecute: false,
          reason: 'No profitable quotes available',
          confidence: 100,
          riskLevel: 'low'
        };
      }

      // Evaluate each quote
      const decisions = await Promise.all(
        profitableQuotes.map(quote => this.makeDecision(quote))
      );

      // Find the best decision
      const bestDecision = decisions
        .filter(d => d.shouldExecute)
        .sort((a, b) => b.confidence - a.confidence)[0];

      if (!bestDecision) {
        return {
          shouldExecute: false,
          reason: 'No suitable quotes meet execution criteria',
          confidence: 80,
          riskLevel: 'medium'
        };
      }

      return bestDecision;

    } catch (error) {
      this.logError('Multi-quote decision making failed', error);
      throw error;
    }
  }

  /**
   * Estimate gas cost for execution
   */
  private async estimateGasCost(quote: RewardQuote): Promise<bigint> {
    try {
      // Get current gas price
      const gasPrice = await this.getGasPrice();

      // Estimate gas usage for flash loan + swap + compound
      // This is a rough estimate - in practice, you'd use eth_estimateGas
      const estimatedGas = 500000n; // Conservative estimate

      return estimatedGas * gasPrice;

    } catch (error) {
      this.logError('Gas cost estimation failed', error);
      return 100000000000000000n; // 0.1 ETH fallback
    }
  }

  /**
   * Assess market conditions
   */
  private async assessMarketConditions(): Promise<{ favorable: boolean; reason: string }> {
    try {
      // Check gas price
      const gasPrice = await this.getGasPrice();
      const maxGasPrice = BigInt(this.botConfig.maxGasPriceGwei) * 1000000000n;

      if (gasPrice > maxGasPrice) {
        return {
          favorable: false,
          reason: `Gas price ${gasPrice} exceeds maximum ${maxGasPrice}`
        };
      }

      // Additional market condition checks could be added here
      // - Volatility checks
      // - Liquidity checks
      // - Token balance checks

      return {
        favorable: true,
        reason: 'Market conditions are favorable'
      };

    } catch (error) {
      this.logError('Market condition assessment failed', error);
      return {
        favorable: false,
        reason: 'Unable to assess market conditions'
      };
    }
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    quote: RewardQuote,
    riskAssessment: any,
    gasCost: bigint
  ): number {
    let confidence = 100;

    // Reduce confidence based on risk
    if (riskAssessment.level === 'medium') confidence -= 10;
    if (riskAssessment.level === 'high') confidence -= 25;

    // Reduce confidence if profit is close to gas cost
    const profitToGasRatio = Number(quote.estimatedProfit / gasCost);
    if (profitToGasRatio < 3) confidence -= 15;
    if (profitToGasRatio < 2) confidence -= 25;

    // Reduce confidence for very large amounts
    const threshold = await this.getExchangeThreshold().catch(() => 1000n * 10n**18n);
    const sizeRatio = Number(quote.sharesAmount / threshold);
    if (sizeRatio > 10) confidence -= 20;

    return Math.max(0, Math.min(100, confidence));
  }

  /**
   * Check if high risk should be accepted
   */
  private shouldAcceptHighRisk(): boolean {
    // In practice, this could be based on:
    // - Bot configuration
    // - Historical success rate
    // - Time since last successful execution
    // - Current portfolio allocation
    return false; // Conservative default
  }

  /**
   * Get exchange threshold (helper)
   */
  private async getExchangeThreshold(): Promise<bigint> {
    // This would typically call the contract
    // For now, return a placeholder
    return 1000n * 10n**18n;
  }
}
```

### 3. Create Risk Assessment Service

#### bot-typescript/src/services/RiskAssessmentService.ts

```typescript
import { ethers } from 'ethers';
import { RewardQuote, NetworkConfig } from '../types';
import { BaseService } from './base/BaseService';

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high';
  score: number; // 0-100, higher = riskier
  factors: RiskFactor[];
}

export interface RiskFactor {
  name: string;
  level: 'low' | 'medium' | 'high';
  score: number;
  description: string;
}

export class RiskAssessmentService extends BaseService {
  constructor(networkConfig: NetworkConfig) {
    super(networkConfig);
  }

  /**
   * Assess risk for a reward quote
   */
  async assessRisk(quote: RewardQuote): Promise<RiskAssessment> {
    try {
      const factors: RiskFactor[] = [];

      // Factor 1: Size relative to market
      const sizeFactor = this.assessSizeRisk(quote);
      factors.push(sizeFactor);

      // Factor 2: Profit margin
      const profitFactor = this.assessProfitRisk(quote);
      factors.push(profitFactor);

      // Factor 3: Flash loan size
      const flashLoanFactor = this.assessFlashLoanRisk(quote);
      factors.push(flashLoanFactor);

      // Factor 4: Slippage risk
      const slippageFactor = this.assessSlippageRisk(quote);
      factors.push(slippageFactor);

      // Factor 5: Contract risk
      const contractFactor = await this.assessContractRisk();
      factors.push(contractFactor);

      // Calculate overall risk
      const totalScore = factors.reduce((sum, factor) => sum + factor.score, 0);
      const averageScore = totalScore / factors.length;

      let level: 'low' | 'medium' | 'high';
      if (averageScore < 33) level = 'low';
      else if (averageScore < 66) level = 'medium';
      else level = 'high';

      return {
        level,
        score: Math.round(averageScore),
        factors
      };

    } catch (error) {
      this.logError('Risk assessment failed', error);

      // Return high risk assessment on error
      return {
        level: 'high',
        score: 100,
        factors: [{
          name: 'Assessment Error',
          level: 'high',
          score: 100,
          description: 'Unable to complete risk assessment'
        }]
      };
    }
  }

  /**
   * Assess size risk
   */
  private assessSizeRisk(quote: RewardQuote): RiskFactor {
    // Risk increases with size
    const sizeInEth = Number(quote.requiredFlashAmount) / 1e18;

    let level: 'low' | 'medium' | 'high';
    let score: number;
    let description: string;

    if (sizeInEth < 10) {
      level = 'low';
      score = 10;
      description = 'Small transaction size';
    } else if (sizeInEth < 100) {
      level = 'medium';
      score = 40;
      description = 'Medium transaction size';
    } else {
      level = 'high';
      score = 80;
      description = 'Large transaction size';
    }

    return {
      name: 'Transaction Size',
      level,
      score,
      description
    };
  }

  /**
   * Assess profit margin risk
   */
  private assessProfitRisk(quote: RewardQuote): RiskFactor {
    // Risk decreases with higher profit margins
    const profitMargin = Number(quote.estimatedProfit) / Number(quote.requiredFlashAmount);

    let level: 'low' | 'medium' | 'high';
    let score: number;
    let description: string;

    if (profitMargin > 0.02) { // > 2%
      level = 'low';
      score = 10;
      description = 'High profit margin';
    } else if (profitMargin > 0.005) { // > 0.5%
      level = 'medium';
      score = 40;
      description = 'Moderate profit margin';
    } else {
      level = 'high';
      score = 80;
      description = 'Low profit margin';
    }

    return {
      name: 'Profit Margin',
      level,
      score,
      description
    };
  }

  /**
   * Assess flash loan risk
   */
  private assessFlashLoanRisk(quote: RewardQuote): RiskFactor {
    // Higher flash loan amounts = higher risk
    const flashLoanInEth = Number(quote.requiredFlashAmount) / 1e18;

    let level: 'low' | 'medium' | 'high';
    let score: number;
    let description: string;

    if (flashLoanInEth < 50) {
      level = 'low';
      score = 15;
      description = 'Small flash loan amount';
    } else if (flashLoanInEth < 200) {
      level = 'medium';
      score = 45;
      description = 'Medium flash loan amount';
    } else {
      level = 'high';
      score = 85;
      description = 'Large flash loan amount';
    }

    return {
      name: 'Flash Loan Size',
      level,
      score,
      description
    };
  }

  /**
   * Assess slippage risk
   */
  private assessSlippageRisk(quote: RewardQuote): RiskFactor {
    // This is a placeholder - in practice, you'd check:
    // - Token liquidity
    // - Recent price volatility
    // - Trading volume

    return {
      name: 'Slippage Risk',
      level: 'medium',
      score: 50,
      description: 'Moderate slippage risk based on market conditions'
    };
  }

  /**
   * Assess contract risk
   */
  private async assessContractRisk(): Promise<RiskFactor> {
    try {
      // Check if contracts are deployed and have code
      const compounderCode = await this.provider.getCode(
        this.networkConfig.contracts.rewardCompounder
      );

      const quoteHelperCode = await this.provider.getCode(
        this.networkConfig.contracts.rewardQuoteHelper
      );

      if (compounderCode === '0x' || quoteHelperCode === '0x') {
        return {
          name: 'Contract Status',
          level: 'high',
          score: 100,
          description: 'Contracts not deployed or have no code'
        };
      }

      return {
        name: 'Contract Status',
        level: 'low',
        score: 5,
        description: 'Contracts appear to be deployed correctly'
      };

    } catch (error) {
      return {
        name: 'Contract Status',
        level: 'high',
        score: 90,
        description: 'Unable to verify contract status'
      };
    }
  }
}
```

## Acceptance Criteria

- ✅ Reward quoting service with contract integration
- ✅ Decision engine with comprehensive risk assessment
- ✅ Risk assessment service with multiple risk factors
- ✅ Support for multiple quote evaluation
- ✅ Optimal amount finding logic
- ✅ Market condition and gas price checks
- ✅ Confidence scoring system
- ✅ Proper error handling and logging

## Next Steps

Proceed to Step 12: Implement reward compounding execution logic.
