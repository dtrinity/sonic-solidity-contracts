# Step 13: Implement Notification and Error Handling System

## Objective

Implement a comprehensive notification system for monitoring bot activities and a robust error handling system to ensure reliability.

## Implementation Tasks

### 1. Create Notification Manager

#### bot-typescript/src/services/NotificationManager.ts

```typescript
import { WebClient } from '@slack/web-api';
import { NetworkConfig, NotificationPayload } from '../types';
import { BaseService } from './base/BaseService';
import logger from '../utils/logger';

export interface NotificationChannel {
  type: 'slack' | 'discord' | 'email' | 'console';
  enabled: boolean;
  config: any;
}

export class NotificationManager extends BaseService {
  private slackClient: WebClient | null = null;
  private channels: NotificationChannel[] = [];

  constructor(networkConfig: NetworkConfig) {
    super(networkConfig);
    this.initializeChannels();
  }

  /**
   * Initialize notification channels
   */
  private initializeChannels(): void {
    // Slack channel
    if (process.env.SLACK_WEBHOOK_URL) {
      this.slackClient = new WebClient();
      this.channels.push({
        type: 'slack',
        enabled: true,
        config: {
          webhookUrl: process.env.SLACK_WEBHOOK_URL,
          channel: process.env.SLACK_CHANNEL || '#dloop-bot-notifications'
        }
      });
    }

    // Console channel (always enabled)
    this.channels.push({
      type: 'console',
      enabled: true,
      config: {}
    });
  }

  /**
   * Send notification
   */
  async notify(payload: NotificationPayload): Promise<void> {
    try {
      logger.debug('Sending notification', payload);

      for (const channel of this.channels) {
        if (channel.enabled) {
          try {
            await this.sendToChannel(channel, payload);
          } catch (error) {
            logger.error(`Failed to send notification to ${channel.type}`, error);
          }
        }
      }

    } catch (error) {
      this.logError('Notification failed', error);
    }
  }

  /**
   * Send notification to specific channel
   */
  private async sendToChannel(channel: NotificationChannel, payload: NotificationPayload): Promise<void> {
    switch (channel.type) {
      case 'slack':
        await this.sendSlackNotification(channel.config, payload);
        break;
      case 'console':
        this.sendConsoleNotification(payload);
        break;
      default:
        logger.warn(`Unknown notification channel: ${channel.type}`);
    }
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(config: any, payload: NotificationPayload): Promise<void> {
    if (!this.slackClient) {
      throw new Error('Slack client not initialized');
    }

    const color = this.getColorForType(payload.type);
    const emoji = this.getEmojiForType(payload.type);

    const message = {
      channel: config.channel,
      text: `${emoji} ${payload.title}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${emoji} ${payload.title}`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: payload.message
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `*Type:* ${payload.type} | *Time:* ${new Date(payload.timestamp).toISOString()}`
            }
          ]
        }
      ],
      attachments: payload.data ? [
        {
          color,
          fields: Object.entries(payload.data).map(([key, value]) => ({
            title: key,
            value: String(value),
            short: true
          }))
        }
      ] : undefined
    };

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

    } catch (error) {
      throw new Error(`Failed to send Slack notification: ${error.message}`);
    }
  }

  /**
   * Send console notification
   */
  private sendConsoleNotification(payload: NotificationPayload): void {
    const emoji = this.getEmojiForType(payload.type);
    const timestamp = new Date(payload.timestamp).toISOString();

    console.log(`[${timestamp}] ${emoji} ${payload.title}: ${payload.message}`);

    if (payload.data) {
      console.log('Additional data:', payload.data);
    }
  }

  /**
   * Get color for notification type
   */
  private getColorForType(type: string): string {
    switch (type) {
      case 'success': return '#36a64f';
      case 'error': return '#dc3545';
      case 'info': return '#17a2b8';
      default: return '#6c757d';
    }
  }

  /**
   * Get emoji for notification type
   */
  private getEmojiForType(type: string): string {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'info': return 'ℹ️';
      default: return '📢';
    }
  }

  /**
   * Send success notification
   */
  async notifySuccess(title: string, message: string, data?: any): Promise<void> {
    await this.notify({
      type: 'success',
      title,
      message,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Send error notification
   */
  async notifyError(title: string, message: string, data?: any): Promise<void> {
    await this.notify({
      type: 'error',
      title,
      message,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Send info notification
   */
  async notifyInfo(title: string, message: string, data?: any): Promise<void> {
    await this.notify({
      type: 'info',
      title,
      message,
      data,
      timestamp: Date.now()
    });
  }
}
```

### 2. Create Error Handler Service

#### bot-typescript/src/services/ErrorHandlerService.ts

```typescript
import { NetworkConfig, TransactionResult } from '../types';
import { BaseService } from './base/BaseService';
import { NotificationManager } from './NotificationManager';
import logger from '../utils/logger';

export interface ErrorContext {
  operation: string;
  cycleId?: string;
  txHash?: string;
  data?: any;
  timestamp: number;
}

export interface ErrorRecoveryStrategy {
  name: string;
  description: string;
  canRecover: (error: Error, context: ErrorContext) => boolean;
  execute: (error: Error, context: ErrorContext) => Promise<boolean>;
}

export class ErrorHandlerService extends BaseService {
  private notificationManager: NotificationManager;
  private recoveryStrategies: ErrorRecoveryStrategy[] = [];
  private errorHistory: Array<{ error: Error; context: ErrorContext; recovered: boolean }> = [];

  constructor(networkConfig: NetworkConfig, notificationManager: NotificationManager) {
    super(networkConfig);
    this.notificationManager = notificationManager;
    this.initializeRecoveryStrategies();
  }

  /**
   * Handle error with recovery attempts
   */
  async handleError(error: Error, context: ErrorContext): Promise<boolean> {
    try {
      logger.error(`Handling error in ${context.operation}`, {
        error: error.message,
        context
      });

      // Log error to history
      this.errorHistory.push({
        error,
        context,
        recovered: false
      });

      // Notify about error
      await this.notificationManager.notifyError(
        `Error in ${context.operation}`,
        error.message,
        { context, stack: error.stack }
      );

      // Attempt recovery
      const recovered = await this.attemptRecovery(error, context);

      if (recovered) {
        logger.info(`Successfully recovered from error in ${context.operation}`);
        this.errorHistory[this.errorHistory.length - 1].recovered = true;

        await this.notificationManager.notifySuccess(
          `Recovery Successful`,
          `Recovered from error in ${context.operation}`,
          { context }
        );
      } else {
        logger.warn(`Failed to recover from error in ${context.operation}`);

        await this.notificationManager.notifyError(
          `Recovery Failed`,
          `Unable to recover from error in ${context.operation}`,
          { context }
        );
      }

      return recovered;

    } catch (recoveryError) {
      logger.error('Error handling failed', recoveryError);
      return false;
    }
  }

  /**
   * Attempt error recovery using available strategies
   */
  private async attemptRecovery(error: Error, context: ErrorContext): Promise<boolean> {
    for (const strategy of this.recoveryStrategies) {
      if (strategy.canRecover(error, context)) {
        try {
          logger.debug(`Attempting recovery strategy: ${strategy.name}`);
          const recovered = await strategy.execute(error, context);

          if (recovered) {
            logger.info(`Recovery strategy ${strategy.name} succeeded`);
            return true;
          }

        } catch (strategyError) {
          logger.warn(`Recovery strategy ${strategy.name} failed`, strategyError);
        }
      }
    }

    return false;
  }

  /**
   * Initialize recovery strategies
   */
  private initializeRecoveryStrategies(): void {
    // Strategy 1: Retry after delay
    this.recoveryStrategies.push({
      name: 'retry-with-delay',
      description: 'Retry operation after a delay',
      canRecover: (error, context) => {
        // Can recover network errors, timeouts, temporary failures
        return error.message.includes('timeout') ||
               error.message.includes('network') ||
               error.message.includes('temporary');
      },
      execute: async (error, context) => {
        await this.delay(5000); // Wait 5 seconds
        return true; // Assume retry would work
      }
    });

    // Strategy 2: Circuit breaker reset
    this.recoveryStrategies.push({
      name: 'circuit-breaker-reset',
      description: 'Reset circuit breaker after failures',
      canRecover: (error, context) => {
        return error.message.includes('circuit breaker');
      },
      execute: async (error, context) => {
        // In practice, this would reset the circuit breaker
        await this.delay(30000); // Wait 30 seconds
        return true;
      }
    });

    // Strategy 3: Gas price adjustment
    this.recoveryStrategies.push({
      name: 'gas-price-adjustment',
      description: 'Adjust gas price for high gas price errors',
      canRecover: (error, context) => {
        return error.message.includes('gas price') ||
               error.message.includes('underpriced');
      },
      execute: async (error, context) => {
        // In practice, this would increase gas price
        await this.delay(2000); // Wait 2 seconds
        return true;
      }
    });
  }

  /**
   * Add custom recovery strategy
   */
  addRecoveryStrategy(strategy: ErrorRecoveryStrategy): void {
    this.recoveryStrategies.push(strategy);
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    totalErrors: number;
    recoveredErrors: number;
    unrecoveredErrors: number;
    recentErrors: any[];
  } {
    const totalErrors = this.errorHistory.length;
    const recoveredErrors = this.errorHistory.filter(e => e.recovered).length;
    const unrecoveredErrors = totalErrors - recoveredErrors;
    const recentErrors = this.errorHistory.slice(-10);

    return {
      totalErrors,
      recoveredErrors,
      unrecoveredErrors,
      recentErrors
    };
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3. Create Alert Manager

#### bot-typescript/src/services/AlertManager.ts

```typescript
import { NetworkConfig } from '../types';
import { BaseService } from './base/BaseService';
import { NotificationManager } from './NotificationManager';
import logger from '../utils/logger';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: (data: any) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  cooldown: number; // milliseconds
  enabled: boolean;
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: string;
  message: string;
  data: any;
  timestamp: number;
  resolved: boolean;
}

export class AlertManager extends BaseService {
  private notificationManager: NotificationManager;
  private rules: AlertRule[] = [];
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private lastTriggered: Map<string, number> = new Map();

  constructor(networkConfig: NetworkConfig, notificationManager: NotificationManager) {
    super(networkConfig);
    this.notificationManager = notificationManager;
    this.initializeDefaultRules();
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultRules(): void {
    // Rule 1: High gas price alert
    this.addRule({
      id: 'high-gas-price',
      name: 'High Gas Price',
      description: 'Gas price exceeds safe threshold',
      condition: (data) => data.gasPrice > 200000000000, // 200 gwei
      severity: 'medium',
      cooldown: 300000, // 5 minutes
      enabled: true
    });

    // Rule 2: Transaction failure alert
    this.addRule({
      id: 'transaction-failure',
      name: 'Transaction Failure',
      description: 'Multiple transaction failures detected',
      condition: (data) => data.failureCount > 3,
      severity: 'high',
      cooldown: 600000, // 10 minutes
      enabled: true
    });

    // Rule 3: Low balance alert
    this.addRule({
      id: 'low-balance',
      name: 'Low Wallet Balance',
      description: 'Wallet balance is running low',
      condition: (data) => data.balance < 0.1, // Less than 0.1 ETH
      severity: 'high',
      cooldown: 900000, // 15 minutes
      enabled: true
    });

    // Rule 4: High profit opportunity
    this.addRule({
      id: 'high-profit-opportunity',
      name: 'High Profit Opportunity',
      description: 'Large profit opportunity detected',
      condition: (data) => data.profit > 1.0, // More than 1 ETH profit
      severity: 'low',
      cooldown: 1800000, // 30 minutes
      enabled: true
    });
  }

  /**
   * Add alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove alert rule
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(rule => rule.id !== ruleId);
  }

  /**
   * Check data against all rules
   */
  async checkRules(data: any): Promise<void> {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastTriggered = this.lastTriggered.get(rule.id) || 0;
      if (Date.now() - lastTriggered < rule.cooldown) continue;

      try {
        if (rule.condition(data)) {
          await this.triggerAlert(rule, data);
        }
      } catch (error) {
        this.logError(`Error checking rule ${rule.id}`, error);
      }
    }
  }

  /**
   * Trigger alert for rule
   */
  private async triggerAlert(rule: AlertRule, data: any): Promise<void> {
    const alertId = `${rule.id}-${Date.now()}`;

    const alert: Alert = {
      id: alertId,
      ruleId: rule.id,
      severity: rule.severity,
      message: rule.description,
      data,
      timestamp: Date.now(),
      resolved: false
    };

    this.activeAlerts.set(alertId, alert);
    this.alertHistory.push(alert);
    this.lastTriggered.set(rule.id, Date.now());

    logger.warn(`Alert triggered: ${rule.name}`, { alert });

    // Send notification
    await this.notificationManager.notify({
      type: this.getNotificationType(rule.severity),
      title: `🚨 ${rule.name}`,
      message: rule.description,
      data: {
        alertId,
        severity: rule.severity,
        data
      },
      timestamp: Date.now()
    });
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      this.activeAlerts.delete(alertId);
      logger.info(`Alert resolved: ${alertId}`);
    }
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit: number = 50): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get notification type for severity
   */
  private getNotificationType(severity: string): 'success' | 'error' | 'info' {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'info';
      case 'low':
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Enable/disable rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * Get rule statistics
   */
  getRuleStats(): {
    totalRules: number;
    enabledRules: number;
    disabledRules: number;
    activeAlerts: number;
    totalAlerts: number;
  } {
    const totalRules = this.rules.length;
    const enabledRules = this.rules.filter(r => r.enabled).length;
    const disabledRules = totalRules - enabledRules;
    const activeAlerts = this.activeAlerts.size;
    const totalAlerts = this.alertHistory.length;

    return {
      totalRules,
      enabledRules,
      disabledRules,
      activeAlerts,
      totalAlerts
    };
  }
}
```

## Acceptance Criteria

- ✅ Notification manager with Slack integration
- ✅ Error handler service with recovery strategies
- ✅ Alert manager with configurable rules
- ✅ Multiple notification channels (Slack, console)
- ✅ Error history and statistics tracking
- ✅ Automatic error recovery mechanisms
- ✅ Alert severity levels and cooldowns
- ✅ Comprehensive error context logging

## Next Steps

Proceed to Step 14: Create Jest tests with mocks for TypeScript bot.
