/**
 * Attack Constants for Odos Exploit Reproduction
 *
 * These constants are derived from the production Sonic attack transaction:
 * 0xa6aef05387f5b86b1fd563256fc9223f3c22f74292d66ac796d3f08fd311d940
 *
 * All values are in wei/micro-units to ensure exact precision matching.
 * DO NOT use floating point or formatted strings for these values.
 */

import { ethers } from "hardhat";

/**
 * Token decimals
 */
export const DECIMALS = {
  COLLATERAL: 6, // wstkscUSD uses 6 decimals
  DUSD: 18,      // dUSD uses 18 decimals
} as const;

/**
 * Core attack magnitudes (collateral side - wstkscUSD in micro-units)
 *
 * These represent the key wstkscUSD flows during the attack:
 * - Victim's collateral being swapped
 * - Flash loan premium (5 bps)
 * - Extra collateral needed for attack executor
 * - Attacker's net gain bursts
 */
export const ATTACK_COLLATERAL = {
  /**
   * Amount of victim collateral swapped via the adapter
   * Source: Production tx shows 26,243.751965 wstkscUSD withdrawn from victim
   */
  COLLATERAL_TO_SWAP: ethers.parseUnits("26243.751965", DECIMALS.COLLATERAL),

  /**
   * Flash loan premium rate: 5 basis points (0.05%)
   * Formula: (COLLATERAL_TO_SWAP * 5) / 10000
   */
  FLASH_LOAN_PREMIUM_BPS: 5,

  /**
   * Calculated flash loan premium
   * = 26243.751965 * 0.0005 = 13.1218759825 wstkscUSD
   */
  get FLASH_LOAN_PREMIUM(): bigint {
    return (this.COLLATERAL_TO_SWAP * BigInt(this.FLASH_LOAN_PREMIUM_BPS)) / 10_000n;
  },

  /**
   * Flash swap amount (excludes premium for initial calculation)
   */
  get FLASH_SWAP_AMOUNT(): bigint {
    return this.COLLATERAL_TO_SWAP - this.FLASH_LOAN_PREMIUM;
  },

  /**
   * First burst of collateral sent to attacker beneficiary
   * Source: Production tx shows 26,230.630089 wstkscUSD in first transfer
   */
  BURST_ONE: ethers.parseUnits("26230.630089", DECIMALS.COLLATERAL),

  /**
   * Second burst of collateral sent to attacker beneficiary
   * Source: Production tx shows 8,877.536706 wstkscUSD in second transfer
   */
  BURST_TWO: ethers.parseUnits("8877.536706", DECIMALS.COLLATERAL),

  /**
   * Total attacker net gain
   * = BURST_ONE + BURST_TWO = 35,108.166795 wstkscUSD
   *
   * This represents the attacker's profit after:
   * 1. Stealing victim's collateral (26,243.751965)
   * 2. Stealing reserve manager's collateral for flash loan premium
   * 3. Additional collateral extracted from the system
   */
  get TOTAL_ATTACKER_GAIN(): bigint {
    return this.BURST_ONE + this.BURST_TWO;
  },

  /**
   * Extra collateral provided by reserve manager
   * Must cover both bursts and the flash loan premium
   */
  get EXTRA_COLLATERAL(): bigint {
    return this.BURST_ONE + this.BURST_TWO + this.FLASH_LOAN_PREMIUM;
  },

  /**
   * Net amount of victim collateral drained once same-asset dust is returned
   */
  get NET_VICTIM_DRAIN(): bigint {
    return this.COLLATERAL_TO_SWAP - this.DUST_OUTPUT;
  },

  /**
   * Dust output returned to adapter (1 micro unit)
   * This negligible amount satisfies minOut while stealing the rest
   */
  DUST_OUTPUT: 1n, // 1 micro-unit = 0.000001 wstkscUSD
} as const;

/**
 * dUSD flash mint and staging flow
 *
 * The attack uses a 27,000 dUSD flash mint that flows through staging contracts.
 * These constants track the exact amounts at each stage.
 */
export const ATTACK_DUSD_FLOW = {
  /**
   * Flash mint amount: exactly 27,000 dUSD
   * This is minted from zero address and must be repaid in the same transaction
   */
  FLASH_MINT_AMOUNT: ethers.parseUnits("27000", DECIMALS.DUSD),

  /**
   * First staging vault deposit
   * Source: Production tx shows 21,444.122422884130710969 dUSD
   */
  STAGE_ONE: ethers.parseUnits("21444.122422884130710969", DECIMALS.DUSD),

  /**
   * Second staging vault deposit
   * Source: Production tx shows 7,133.477578004629885067 dUSD
   */
  STAGE_TWO: ethers.parseUnits("7133.477578004629885067", DECIMALS.DUSD),

  /**
   * First pull from recycler helper
   * Source: Production tx shows 26,681.458777948890901201 dUSD
   */
  RECYCLER_PULL_ONE: ethers.parseUnits("26681.458777948890901201", DECIMALS.DUSD),

  /**
   * Second pull from recycler helper
   * Source: Production tx shows 8,998.899406948321393581 dUSD
   */
  RECYCLER_PULL_TWO: ethers.parseUnits("8998.899406948321393581", DECIMALS.DUSD),

  /**
   * Amount returned to recycler at the end
   * Source: Production tx shows 7,052.758184008451698746 dUSD
   */
  RECYCLER_RETURN: ethers.parseUnits("7052.758184008451698746", DECIMALS.DUSD),

  /**
   * Net recycler balance change
   * = RECYCLER_RETURN - RECYCLER_PULL_ONE - RECYCLER_PULL_TWO
   * Expected: -28,627.60 dUSD (recycler loses this amount to fund attack)
   */
  get RECYCLER_NET_DELTA(): bigint {
    return this.RECYCLER_RETURN - this.RECYCLER_PULL_ONE - this.RECYCLER_PULL_TWO;
  },

  /**
   * Splitter round amount (25 dUSD per round, 2 rounds)
   */
  SPLITTER_ROUND: ethers.parseUnits("25", DECIMALS.DUSD),

  /**
   * Micro distributor one receives 0.01 dUSD
   */
  MICRO_DISTRIBUTOR_ONE: ethers.parseUnits("0.01", DECIMALS.DUSD),

  /**
   * Micro distributor two receives 0.24 dUSD
   */
  MICRO_DISTRIBUTOR_TWO: ethers.parseUnits("0.24", DECIMALS.DUSD),
} as const;

/**
 * Expected balance changes for key participants
 *
 * These help structure assertions about the attack's outcome
 */
export const EXPECTED_DELTAS = {
  /**
   * Victim loses entire collateral position
   */
  VICTIM_ATOKEN_DELTA: -ATTACK_COLLATERAL.NET_VICTIM_DRAIN,

  /**
   * Attacker gains net profit
   */
  ATTACKER_COLLATERAL_DELTA: ATTACK_COLLATERAL.TOTAL_ATTACKER_GAIN,

  /**
   * Reserve manager's aToken burned for flash loan premium
   * (Also includes the extra collateral that funds the second burst)
   */
  RESERVE_MANAGER_ATOKEN_DELTA: -ATTACK_COLLATERAL.EXTRA_COLLATERAL,

  /**
   * Recycler loses dUSD to fund staging operations
   */
  RECYCLER_DUSD_DELTA: ATTACK_DUSD_FLOW.RECYCLER_NET_DELTA,

  /**
   * Executor should have zero balance after attack (all swept to attacker)
   */
  EXECUTOR_COLLATERAL_FINAL: 0n,
  EXECUTOR_DUSD_FINAL: 0n,

  /**
   * Adapter should have zero balance after attack (no residual dust)
   */
  ADAPTER_COLLATERAL_FINAL: 0n,
  ADAPTER_DUSD_FINAL: 0n,
} as const;

/**
 * Event names for structured assertions
 *
 * These match the events emitted by the mock contracts
 */
export const ATTACK_EVENTS = {
  // Router events
  COLLATERAL_PULLED: "CollateralPulled",

  // AttackExecutor events
  FLASH_MINT_STARTED: "FlashMintStarted",
  FLASH_MINT_SETTLED: "FlashMintSettled",
  ATTACKER_BURST: "AttackerBurst",
  DUSD_SHUTTLED: "DusdShuttled",
  DUSD_FAN_OUT: "DusdFanOut",
  FLASH_LOAN_RECORDED: "FlashLoanRecorded",
  FLASH_LOAN_REPAYMENT: "FlashLoanRepayment",
  COLLATERAL_DUST_RETURNED: "CollateralDustReturned",

  // Pool events
  FLASH_LOAN_EXECUTED: "FlashLoanExecuted",
  FLASH_LOAN_REPAID: "FlashLoanRepaid",
  RESERVE_BURNED: "ReserveBurned",
  WITHDRAW_PERFORMED: "WithdrawPerformed",
} as const;

/**
 * Precision tolerances for assertions
 *
 * Most assertions should use EXACT (0) tolerance.
 * Only use ROUNDING when multi-step calculations introduce unavoidable precision loss.
 */
export const PRECISION_TOLERANCE = {
  /**
   * Exact match required (0 wei/micro-unit difference)
   * Use for: direct transfers, flash loan amounts, attacker gains
   */
  EXACT: 0n,

  /**
   * Single wei/micro-unit tolerance
   * Use for: flash loan premiums with division rounding
   */
  WEI_LEVEL: 1n,

  /**
   * Small rounding tolerance (10 wei/micro-units)
   * Use for: multi-step dUSD staging flows with intermediate rounding
   */
  ROUNDING: 10n,
} as const;

/**
 * Validation helpers
 */
export function validateConstants(): void {
  // Ensure flash loan premium calculation is correct
  const expectedPremium = (ATTACK_COLLATERAL.COLLATERAL_TO_SWAP * 5n) / 10_000n;
  if (ATTACK_COLLATERAL.FLASH_LOAN_PREMIUM !== expectedPremium) {
    throw new Error("Flash loan premium mismatch");
  }

  // Ensure total attacker gain matches burst sum
  const expectedGain = ATTACK_COLLATERAL.BURST_ONE + ATTACK_COLLATERAL.BURST_TWO;
  if (ATTACK_COLLATERAL.TOTAL_ATTACKER_GAIN !== expectedGain) {
    throw new Error("Total attacker gain mismatch");
  }

  // Ensure extra collateral covers bursts and premium
  const expectedExtra = ATTACK_COLLATERAL.BURST_ONE + ATTACK_COLLATERAL.BURST_TWO + ATTACK_COLLATERAL.FLASH_LOAN_PREMIUM;
  if (ATTACK_COLLATERAL.EXTRA_COLLATERAL !== expectedExtra) {
    throw new Error("Extra collateral mismatch");
  }
}

// Run validation on import
validateConstants();
