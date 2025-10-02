import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  SafeCompletedTransaction,
  SafeConfig,
  SafeDeploymentState,
  SafeManagerOptions,
  SafeOperationResult,
  SafePendingTransaction,
  SafeTransactionBatch,
  SafeTransactionData,
} from "./types";

/**
 * SafeManager provides a comprehensive wrapper around Safe Protocol Kit
 * for automated multi-signature governance operations.
 */
export class SafeManager {
  private protocolKit?: Safe;
  private apiKit?: SafeApiKit;
  private signer: Signer;
  private config: SafeConfig;
  private hre: HardhatRuntimeEnvironment;
  private options: SafeManagerOptions;

  constructor(hre: HardhatRuntimeEnvironment, signer: Signer, options: SafeManagerOptions) {
    this.hre = hre;
    this.signer = signer;
    this.config = options.safeConfig;
    this.options = {
      ...options,
      retryAttempts: options.retryAttempts ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      // Enforce offline-only mode regardless of provided options
      enableApiKit: false,
      enableTransactionService: false,
      signingMode: "none",
    };
  }

  /**
   * Initialize Safe Protocol Kit and optionally API Kit
   *
   * @returns void when initialization completes
   */
  async initialize(): Promise<void> {
    try {
      console.log(`🔄 Initializing Safe Protocol Kit for Safe ${this.config.safeAddress}`);

      // Resolve signer address synchronously so we pass a concrete string
      // value to Safe.init instead of a Promise (satisfies linter types).
      let signerAddress: string;

      try {
        signerAddress = await this.signer.getAddress();
      } catch {
        signerAddress = this.config.owners?.[0] || this.config.safeAddress;
      }

      this.protocolKit = await Safe.init({
        // Safe Protocol Kit v4 expects an EIP-1193 provider (e.g., window.ethereum or Hardhat's provider)
        provider: this.hre.network.provider,
        // Provide a hex address string to avoid triggering Passkey signer flow
        // Use an explicitly typed async IIFE to satisfy the linter's explicit return type rule
        signer: signerAddress,
        safeAddress: this.config.safeAddress,
      });

      // Verify Safe configuration
      await this.verifySafeConfiguration();

      if (this.options.enableApiKit && this.config.txServiceUrl) {
        console.log(`🔄 Initializing Safe API Kit for chain ${this.config.chainId}`);
        this.apiKit = new SafeApiKit({
          chainId: BigInt(this.config.chainId),
          txServiceUrl: this.config.txServiceUrl,
        });
      }

      console.log(`✅ Safe Manager initialized successfully`);
    } catch (error) {
      console.error(`❌ Failed to initialize Safe Manager:`, error);
      throw error;
    }
  }

  /**
   * Verify that the Safe configuration matches on-chain state
   *
   * @returns void when verification completes
   */
  private async verifySafeConfiguration(): Promise<void> {
    if (!this.protocolKit) {
      throw new Error("Protocol Kit not initialized");
    }

    const onChainOwners = await this.protocolKit.getOwners();
    const onChainThreshold = await this.protocolKit.getThreshold();

    console.log(`📊 Safe owners: ${onChainOwners.length}, threshold: ${onChainThreshold}`);

    // Verify threshold matches
    if (onChainThreshold !== this.config.threshold) {
      console.warn(`⚠️ Threshold mismatch: config=${this.config.threshold}, on-chain=${onChainThreshold}`);
    }

    // Verify all configured owners are actual owners
    const missingOwners = this.config.owners.filter((owner) => !onChainOwners.map((o) => o.toLowerCase()).includes(owner.toLowerCase()));

    if (missingOwners.length > 0) {
      console.warn(`⚠️ Config owners not found on-chain: ${missingOwners.join(", ")}`);
    }

    const extraOwners = onChainOwners.filter((owner) => !this.config.owners.map((o) => o.toLowerCase()).includes(owner.toLowerCase()));

    if (extraOwners.length > 0) {
      console.warn(`⚠️ Unexpected owners found on-chain: ${extraOwners.join(", ")}`);
    }
  }

  /**
   * Create a batch Safe transaction for multiple operations
   *
   * @param batch The batch of transactions to execute
   * @returns Result of preparing the batch transaction (offline mode)
   */
  async createBatchTransaction(batch: SafeTransactionBatch): Promise<SafeOperationResult> {
    if (!this.protocolKit) {
      throw new Error("Safe Manager not initialized. Call initialize() first.");
    }

    try {
      console.log(`🔄 Creating Safe batch transaction: ${batch.description}`);
      console.log(`   Operations: ${batch.transactions.length}`);

      // Best-effort simulation. Some operations may depend on earlier ops in the same batch
      // (e.g., grant admin, then revoke from deployer). If a standalone simulation fails,
      // continue and rely on Safe UI/on-chain execution ordering.
      for (let i = 0; i < batch.transactions.length; i++) {
        console.log(`   Simulating operation ${i + 1}/${batch.transactions.length}...`);

        try {
          await this.simulateTransaction(batch.transactions[i]);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.warn(`   ⚠️ Simulation failed (continuing): ${message}`);
        }
      }

      const safeTransaction = await this.protocolKit.createTransaction({
        transactions: batch.transactions,
      });
      const safeTxHash = await this.protocolKit.getTransactionHash(safeTransaction);
      console.log(`📝 Batch prepared (offline mode). Hash: ${safeTxHash}`);
      await this.storePendingTransaction(
        safeTxHash,
        batch.transactions[0],
        `${batch.description} (${batch.transactions.length} operations)`,
      );
      await this.exportTransactionBuilderBatch(
        batch.transactions,
        `${batch.description} (${batch.transactions.length} operations)`,
        safeTxHash,
      );
      // Always offline: do not propose, sign or execute
      return {
        success: true,
        safeTxHash,
        requiresAdditionalSignatures: true,
      };
    } catch (error) {
      console.error(`❌ Failed to create Safe batch transaction:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate transaction to check if it would succeed
   *
   * @param transactionData The transaction data to simulate
   * @returns void when simulation completes
   */
  private async simulateTransaction(transactionData: SafeTransactionData): Promise<void> {
    if (!this.protocolKit) {
      throw new Error("Protocol Kit not initialized");
    }

    try {
      // Use static call to simulate transaction
      const provider = this.signer.provider;

      if (!provider) {
        throw new Error("Provider not available");
      }

      await provider.call({
        to: transactionData.to,
        data: transactionData.data,
        value: transactionData.value || "0",
        from: this.config.safeAddress,
      });

      console.log(`✅ Transaction simulation successful`);
      return;
    } catch (error) {
      console.error(`❌ Transaction simulation failed:`, error);
      throw new Error(`Transaction would fail: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get transaction status from stored deployment state
   *
   * @param safeTxHash Safe transaction hash
   * @returns Status string of the transaction
   */
  async getTransactionStatus(safeTxHash: string): Promise<"pending" | "executed" | "not_found"> {
    const deploymentState = await this.getDeploymentState();

    if (deploymentState.pendingTransactions.some((tx) => tx.safeTxHash === safeTxHash)) {
      return "pending";
    }

    if (deploymentState.completedTransactions.some((tx) => tx.safeTxHash === safeTxHash)) {
      return "executed";
    }

    return "not_found";
  }

  /**
   * Check on-chain state to verify if a transaction requirement has been met
   *
   * @param checkFunction Asynchronous predicate returning true if requirement met
   * @returns True if requirement met, false otherwise
   */
  async isRequirementMet(checkFunction: () => Promise<boolean>): Promise<boolean> {
    try {
      return await checkFunction();
    } catch (error) {
      console.warn(`⚠️ Failed to check requirement:`, error);
      return false;
    }
  }

  /**
   * Store pending transaction info in deployment artifacts
   *
   * @param safeTxHash Safe transaction hash
   * @param transactionData Transaction data
   * @param description Human-readable description
   * @returns void when storage completes
   */
  private async storePendingTransaction(safeTxHash: string, transactionData: SafeTransactionData, description: string): Promise<void> {
    if (!this.protocolKit) return;

    try {
      const threshold = await this.protocolKit.getThreshold();
      const deploymentState = await this.getDeploymentState();

      const pendingTransaction: SafePendingTransaction = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        safeTxHash,
        description,
        transactionData,
        createdAt: Date.now(),
        requiredSignatures: threshold,
        currentSignatures: 0, // Offline mode, no signatures added
      };

      deploymentState.pendingTransactions.push(pendingTransaction);
      await this.saveDeploymentState(deploymentState);

      console.log(`💾 Stored pending transaction: ${description}`);
    } catch (error) {
      console.warn(`⚠️ Failed to store pending transaction:`, error);
    }
  }

  /**
   * Store completed transaction info in deployment artifacts
   *
   * @param safeTxHash Safe transaction hash
   * @param transactionHash On-chain transaction hash
   * @param description Human-readable description
   * @returns void when storage completes
   */
  private async storeCompletedTransaction(safeTxHash: string, transactionHash: string, description: string): Promise<void> {
    try {
      const deploymentState = await this.getDeploymentState();

      // Remove from pending transactions
      const indexToRemove = deploymentState.pendingTransactions.findIndex((tx) => tx.safeTxHash === safeTxHash);

      if (indexToRemove !== -1) {
        deploymentState.pendingTransactions.splice(indexToRemove, 1);
      }

      // Add to completed transactions
      const completedTransaction: SafeCompletedTransaction = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        safeTxHash,
        transactionHash,
        description,
        executedAt: Date.now(),
      };

      deploymentState.completedTransactions.push(completedTransaction);
      await this.saveDeploymentState(deploymentState);

      console.log(`💾 Stored completed transaction: ${description}`);
    } catch (error) {
      console.warn(`⚠️ Failed to store completed transaction:`, error);
    }
  }

  /**
   * Get deployment state from artifacts
   *
   * @returns Parsed deployment state (or default empty state)
   */
  private async getDeploymentState(): Promise<SafeDeploymentState> {
    try {
      const networkName = this.hre.network.name;
      const deploymentPath = `${this.hre.config.paths.deployments}/${networkName}`;
      const statePath = `${deploymentPath}/safe-deployment-state.json`;

      const fs = require("fs");

      if (fs.existsSync(statePath)) {
        const stateData = fs.readFileSync(statePath, "utf8");
        return JSON.parse(stateData);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to read deployment state:`, error);
    }

    // Return empty state if file doesn't exist or can't be read
    return {
      pendingTransactions: [],
      completedTransactions: [],
      failedTransactions: [],
    };
  }

  /**
   * Save deployment state to artifacts
   *
   * @param state Deployment state to persist
   * @returns void when save completes
   */
  private async saveDeploymentState(state: SafeDeploymentState): Promise<void> {
    try {
      const networkName = this.hre.network.name;
      const deploymentPath = `${this.hre.config.paths.deployments}/${networkName}`;
      const statePath = `${deploymentPath}/safe-deployment-state.json`;

      const fs = require("fs");

      // Ensure deployment directory exists
      if (!fs.existsSync(deploymentPath)) {
        fs.mkdirSync(deploymentPath, { recursive: true });
      }

      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.warn(`⚠️ Failed to save deployment state:`, error);
    }
  }

  /**
   * Export a Transaction Builder JSON for importing in Safe UI
   *
   * @param transactions Transactions to include
   * @param description Human-readable description for the batch
   * @param safeTxHash Safe transaction hash (used for filename)
   * @returns void when export completes
   */
  private async exportTransactionBuilderBatch(transactions: SafeTransactionData[], description: string, safeTxHash: string): Promise<void> {
    try {
      const networkName = this.hre.network.name;
      const deploymentPath = `${this.hre.config.paths.deployments}/${networkName}`;
      const fs = require("fs");

      if (!fs.existsSync(deploymentPath)) {
        fs.mkdirSync(deploymentPath, { recursive: true });
      }
      const filePath = `${deploymentPath}/safe-builder-batch-${safeTxHash}.json`;
      const builderJson = {
        version: "1.0",
        chainId: String(this.config.chainId),
        createdAt: Date.now(),
        meta: {
          name: description,
          description,
          txBuilderVersion: "export-1",
        },
        transactions: transactions.map((t) => ({
          to: t.to,
          value: t.value,
          data: t.data,
        })),
      };
      fs.writeFileSync(filePath, JSON.stringify(builderJson, null, 2));
      console.log(`📝 Wrote Transaction Builder JSON: ${filePath}`);
    } catch (error) {
      console.warn(`⚠️ Failed to export Transaction Builder JSON:`, error);
    }
  }

  /**
   * Get the Safe address
   *
   * @returns Safe address string
   */
  getSafeAddress(): string {
    return this.config.safeAddress;
  }

  /**
   * Get the Safe threshold
   *
   * @returns Required signature threshold
   */
  async getThreshold(): Promise<number> {
    if (!this.protocolKit) {
      throw new Error("Safe Manager not initialized. Call initialize() first.");
    }
    return await this.protocolKit.getThreshold();
  }

  /**
   * Get the Safe owners
   *
   * @returns Array of Safe owner addresses
   */
  async getOwners(): Promise<string[]> {
    if (!this.protocolKit) {
      throw new Error("Safe Manager not initialized. Call initialize() first.");
    }
    return await this.protocolKit.getOwners();
  }

  /**
   * Check if Safe Manager is initialized
   *
   * @returns True if initialized, false otherwise
   */
  isInitialized(): boolean {
    return this.protocolKit !== undefined;
  }
}
