import { ethers } from "ethers";
import { Config } from "../bot/config";

/**
 * Signer utilities for managing wallet connections
 */
export class SignerManager {
    private signer: ethers.Signer | null = null;
    private provider: ethers.JsonRpcProvider | null = null;

    constructor(private config: Config) {}

    /**
     * Initialize provider and signer
     */
    async initialize(): Promise<void> {
        if (!this.config.rpcUrl) {
            throw new Error("RPC URL not configured");
        }

        if (!this.config.privateKey) {
            throw new Error("Private key not configured");
        }

        // Initialize provider
        this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);

        // Initialize signer
        this.signer = new ethers.Wallet(this.config.privateKey, this.provider);

        console.log(`Initialized signer for address: ${await this.signer.getAddress()}`);
    }

    /**
     * Get the current signer
     */
    getSigner(): ethers.Signer {
        if (!this.signer) {
            throw new Error("Signer not initialized. Call initialize() first.");
        }
        return this.signer;
    }

    /**
     * Get the current provider
     */
    getProvider(): ethers.JsonRpcProvider {
        if (!this.provider) {
            throw new Error("Provider not initialized. Call initialize() first.");
        }
        return this.provider;
    }

    /**
     * Get current gas price
     */
    async getGasPrice(): Promise<bigint> {
        const provider = this.getProvider();
        const feeData = await provider.getFeeData();
        return feeData.gasPrice || 20000000000n; // 20 gwei fallback
    }

    /**
     * Check if gas price is within acceptable limits
     */
    async isGasPriceAcceptable(): Promise<boolean> {
        const gasPrice = await this.getGasPrice();
        const maxGasPrice = ethers.parseUnits(this.config.constants.MAX_GAS_PRICE_GWEI.toString(), "gwei");
        return gasPrice <= maxGasPrice;
    }

    /**
     * Get current nonce for the signer
     */
    async getNonce(): Promise<number> {
        const signer = this.getSigner();
        return await signer.getNonce();
    }

    /**
     * Estimate gas for a transaction
     */
    async estimateGas(tx: ethers.TransactionRequest): Promise<bigint> {
        const provider = this.getProvider();
        return await provider.estimateGas(tx);
    }

    /**
     * Get network information
     */
    async getNetwork(): Promise<ethers.Network> {
        const provider = this.getProvider();
        return await provider.getNetwork();
    }

    /**
     * Get current block number
     */
    async getBlockNumber(): Promise<number> {
        const provider = this.getProvider();
        return await provider.getBlockNumber();
    }

    /**
     * Wait for transaction confirmation
     */
    async waitForTransaction(txHash: string, confirmations: number = 1): Promise<ethers.TransactionReceipt> {
        const provider = this.getProvider();
        return await provider.waitForTransaction(txHash, confirmations);
    }

    /**
     * Get transaction receipt
     */
    async getTransactionReceipt(txHash: string): Promise<ethers.TransactionReceipt | null> {
        const provider = this.getProvider();
        return await provider.getTransactionReceipt(txHash);
    }

    /**
     * Validate signer has sufficient balance for gas
     */
    async hasSufficientBalanceForGas(gasLimit: bigint): Promise<boolean> {
        const signer = this.getSigner();
        const address = await signer.getAddress();
        const provider = this.getProvider();

        const balance = await provider.getBalance(address);
        const gasPrice = await this.getGasPrice();
        const requiredBalance = gasLimit * gasPrice;

        return balance >= requiredBalance;
    }

    /**
     * Get balance of the signer
     */
    async getBalance(): Promise<bigint> {
        const signer = this.getSigner();
        const address = await signer.getAddress();
        const provider = this.getProvider();
        return await provider.getBalance(address);
    }
}

/**
 * Create a new SignerManager instance
 */
export function createSignerManager(config: Config): SignerManager {
    return new SignerManager(config);
}

/**
 * Validate private key format
 */
export function validatePrivateKey(privateKey: string): boolean {
    try {
        new ethers.Wallet(privateKey);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get address from private key without creating signer
 */
export function getAddressFromPrivateKey(privateKey: string): string {
    return new ethers.Wallet(privateKey).address;
}
