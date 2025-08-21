import { ethers } from "ethers";

// Default configuration constants
export const DEFAULT_POLL_INTERVAL_MS = 30_000; // 30 seconds
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
export const DEFAULT_MIN_PROFIT_BPS = 10; // 0.1%
export const DEFAULT_MAX_GAS_PRICE_GWEI = 100; // 100 gwei
export const DEFAULT_TREASURY_FEE_BPS = 500; // 5%

// Flash loan fees (approximate, should be queried on-chain)
export const DEFAULT_FLASH_FEE_BPS = 9; // 0.09%

// Odos API configuration
export const ODOS_API_BASE_URL = "https://api.odos.xyz";
export const ODOS_API_TIMEOUT_MS = 10_000;

// Transaction configuration
export const DEFAULT_GAS_MULTIPLIER = 1.2; // 20% buffer
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;

// Safety bounds
export const MIN_FLASH_AMOUNT = ethers.parseEther("100"); // 100 DUSD minimum
export const MAX_FLASH_AMOUNT = ethers.parseEther("10000"); // 10,000 DUSD maximum
export const MIN_PROFIT_THRESHOLD = ethers.parseEther("0.1"); // 0.1 DUSD minimum profit

// Contract deployment salts for CREATE2 (if needed)
export const DEPLOYMENT_SALTS = {
    REWARD_HELPER: "dloop_reward_helper_v1",
    REWARD_COMPOUNDER_ODOS: "dloop_reward_compounder_odos_v1"
} as const;
