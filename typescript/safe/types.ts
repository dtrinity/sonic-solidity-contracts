import { Address } from "hardhat-deploy/types";

/**
 * Configuration for Safe Protocol Kit integration
 */
export interface SafeConfig {
  readonly safeAddress: Address;
  readonly owners: Address[];
  readonly threshold: number;
  readonly chainId: number;
  readonly rpcUrl?: string;
  readonly txServiceUrl?: string;
}

/**
 * Safe transaction data structure for creating transactions
 */
export interface SafeTransactionData {
  readonly to: Address;
  readonly value: string;
  readonly data: string;
  readonly operation?: number; // 0 = Call, 1 = DelegateCall
  readonly safeTxGas?: string;
  readonly baseGas?: string;
  readonly gasPrice?: string;
  readonly gasToken?: Address;
  readonly refundReceiver?: Address;
  readonly nonce?: number;
}

/**
 * State tracking for Safe transactions in deployment artifacts
 */
export interface SafeDeploymentState {
  readonly pendingTransactions: SafePendingTransaction[];
  readonly completedTransactions: SafeCompletedTransaction[];
  readonly failedTransactions: SafeFailedTransaction[];
}

/**
 * Pending Safe transaction information
 */
export interface SafePendingTransaction {
  readonly id: string;
  readonly safeTxHash: string;
  readonly description: string;
  readonly transactionData: SafeTransactionData;
  readonly createdAt: number;
  readonly requiredSignatures: number;
  readonly currentSignatures: number;
}

/**
 * Completed Safe transaction information
 */
export interface SafeCompletedTransaction {
  readonly id: string;
  readonly safeTxHash: string;
  readonly transactionHash: string;
  readonly description: string;
  readonly executedAt: number;
}

/**
 * Failed Safe transaction information
 */
export interface SafeFailedTransaction {
  readonly id: string;
  readonly safeTxHash: string;
  readonly description: string;
  readonly error: string;
  readonly failedAt: number;
}

/**
 * Safe operation result
 */
export interface SafeOperationResult {
  readonly success: boolean;
  readonly transactionHash?: string;
  readonly safeTxHash?: string;
  readonly error?: string;
  readonly requiresAdditionalSignatures?: boolean;
}

/**
 * Safe transaction batch for multiple operations
 */
export interface SafeTransactionBatch {
  readonly transactions: SafeTransactionData[];
  readonly description: string;
}

/**
 * Safe manager configuration options
 */
export interface SafeManagerOptions {
  readonly safeConfig: SafeConfig;
  readonly enableApiKit?: boolean;
  readonly enableTransactionService?: boolean;
  readonly retryAttempts?: number;
  readonly retryDelayMs?: number;
  readonly signingMode?: "owner" | "none";
}
