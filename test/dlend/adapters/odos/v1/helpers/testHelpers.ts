/**
 * Test Helper Utilities for Exploit Reproduction
 *
 * These utilities provide decimal-aware balance tracking, event parsing,
 * and state snapshot functionality for the Odos adapter exploit tests.
 */

import { ethers } from "hardhat";
import { ContractTransactionReceipt, Log } from "ethers";

/**
 * Formats a balance change with decimal awareness
 * @param amount The raw wei/micro-unit amount
 * @param decimals Number of decimals for the token (6 for wstkscUSD, 18 for dUSD)
 * @param symbol Optional token symbol for display
 */
export function formatBalanceChange(
  amount: bigint,
  decimals: number,
  symbol?: string
): string {
  const formatted = ethers.formatUnits(amount, decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Calculates and formats balance difference
 * @param before Balance before operation
 * @param after Balance after operation
 * @param decimals Token decimals
 * @param symbol Token symbol
 * @returns Formatted string with sign indicator
 */
export function formatBalanceDiff(
  before: bigint,
  after: bigint,
  decimals: number,
  symbol?: string
): string {
  const diff = after - before;
  const sign = diff >= 0n ? "+" : "";
  return sign + formatBalanceChange(diff, decimals, symbol);
}

/**
 * Balance snapshot for a single address and token
 */
export interface BalanceSnapshot {
  address: string;
  token: string;
  balance: bigint;
  label?: string;
}

/**
 * Helper to capture balance snapshots
 */
export class BalanceTracker {
  private snapshots: Map<string, bigint> = new Map();

  /**
   * Creates a unique key for address+token pair
   */
  private key(address: string, token: string): string {
    return `${address.toLowerCase()}-${token.toLowerCase()}`;
  }

  /**
   * Records a balance snapshot
   */
  async snapshot(
    address: string,
    token: string,
    tokenContract: any,
    label?: string
  ): Promise<void> {
    const balance = await tokenContract.balanceOf(address);
    const k = this.key(address, token);
    this.snapshots.set(k, balance);
    if (label) {
      this.snapshots.set(`${k}-label`, BigInt(label.length)); // Store label metadata
    }
  }

  /**
   * Retrieves a previously recorded balance
   */
  getSnapshot(address: string, token: string): bigint | undefined {
    return this.snapshots.get(this.key(address, token));
  }

  /**
   * Calculates the delta between current balance and snapshot
   */
  async delta(
    address: string,
    token: string,
    tokenContract: any
  ): Promise<bigint> {
    const current = await tokenContract.balanceOf(address);
    const previous = this.snapshots.get(this.key(address, token));
    if (previous === undefined) {
      throw new Error(
        `No snapshot found for ${address} + ${token}. Call snapshot() first.`
      );
    }
    return current - previous;
  }

  /**
   * Clears all snapshots
   */
  clear(): void {
    this.snapshots.clear();
  }
}

/**
 * Event log extraction helper
 */
export interface ParsedEvent {
  name: string;
  args: Record<string, any>;
  address: string;
}

/**
 * Extracts events from a transaction receipt
 * @param receipt Transaction receipt
 * @param contractInterface Contract interface to parse events
 * @param eventName Optional filter for specific event name
 */
export function parseEvents(
  receipt: ContractTransactionReceipt | null,
  contractInterface: any,
  eventName?: string
): ParsedEvent[] {
  if (!receipt) {
    return [];
  }

  const parsed: ParsedEvent[] = [];

  for (const log of receipt.logs) {
    try {
      const parsedLog = contractInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });

      if (parsedLog && (!eventName || parsedLog.name === eventName)) {
        const args: Record<string, any> = {};
        parsedLog.args.forEach((value: any, index: number) => {
          // Store both by index and by name if available
          args[index.toString()] = value;
          if (parsedLog.fragment.inputs[index]) {
            args[parsedLog.fragment.inputs[index].name] = value;
          }
        });

        parsed.push({
          name: parsedLog.name,
          args,
          address: log.address,
        });
      }
    } catch {
      // Skip logs that don't match the interface
      continue;
    }
  }

  return parsed;
}

/**
 * Finds the first event matching the given name
 */
export function findEvent(
  receipt: ContractTransactionReceipt | null,
  contractInterface: any,
  eventName: string
): ParsedEvent | undefined {
  const events = parseEvents(receipt, contractInterface, eventName);
  return events[0];
}

/**
 * Finds all events matching the given name
 */
export function findEvents(
  receipt: ContractTransactionReceipt | null,
  contractInterface: any,
  eventName: string
): ParsedEvent[] {
  return parseEvents(receipt, contractInterface, eventName);
}

/**
 * Attack flow state snapshot
 * Captures key balances before/after attack for structured assertions
 */
export interface AttackStateSnapshot {
  // Victim state
  victimATokenBalance: bigint;

  // Attacker state
  attackerCollateralBalance: bigint;

  // Reserve manager state (for flash loan premium tracking)
  reserveManagerATokenBalance: bigint;

  // Helper balances (dUSD recycler, staging vault, etc.)
  recyclerDusdBalance: bigint;
  stagingVaultDusdBalance: bigint;

  // Executor state
  executorCollateralBalance: bigint;
  executorDusdBalance: bigint;

  // Adapter state
  adapterCollateralBalance: bigint;
  adapterDusdBalance: bigint;
}

/**
 * Captures a complete attack state snapshot
 */
export async function captureAttackState(
  victim: any,
  attacker: any,
  reserveManager: any,
  executor: any,
  adapter: any,
  stagingVault: any,
  recycler: any,
  aTokenContract: any,
  collateralContract: any,
  dusdContract: any
): Promise<AttackStateSnapshot> {
  return {
    victimATokenBalance: await aTokenContract.balanceOf(victim.address),
    attackerCollateralBalance: await collateralContract.balanceOf(attacker.address),
    reserveManagerATokenBalance: await aTokenContract.balanceOf(reserveManager.address),
    recyclerDusdBalance: await dusdContract.balanceOf(await recycler.getAddress()),
    stagingVaultDusdBalance: await dusdContract.balanceOf(await stagingVault.getAddress()),
    executorCollateralBalance: await collateralContract.balanceOf(await executor.getAddress()),
    executorDusdBalance: await dusdContract.balanceOf(await executor.getAddress()),
    adapterCollateralBalance: await collateralContract.balanceOf(await adapter.getAddress()),
    adapterDusdBalance: await dusdContract.balanceOf(await adapter.getAddress())
  };
}

/**
 * Computes attack state deltas
 */
export interface AttackStateDelta {
  victimATokenDelta: bigint;
  attackerCollateralDelta: bigint;
  reserveManagerATokenDelta: bigint;
  recyclerDusdDelta: bigint;
  stagingVaultDusdDelta: bigint;
  executorCollateralDelta: bigint;
  executorDusdDelta: bigint;
  adapterCollateralDelta: bigint;
  adapterDusdDelta: bigint;
}

/**
 * Calculates deltas between two attack state snapshots
 */
export function computeAttackDeltas(
  before: AttackStateSnapshot,
  after: AttackStateSnapshot
): AttackStateDelta {
  return {
    victimATokenDelta: after.victimATokenBalance - before.victimATokenBalance,
    attackerCollateralDelta: after.attackerCollateralBalance - before.attackerCollateralBalance,
    reserveManagerATokenDelta: after.reserveManagerATokenBalance - before.reserveManagerATokenBalance,
    recyclerDusdDelta: after.recyclerDusdBalance - before.recyclerDusdBalance,
    stagingVaultDusdDelta: after.stagingVaultDusdBalance - before.stagingVaultDusdBalance,
    executorCollateralDelta: after.executorCollateralBalance - before.executorCollateralBalance,
    executorDusdDelta: after.executorDusdBalance - before.executorDusdBalance,
    adapterCollateralDelta: after.adapterCollateralBalance - before.adapterCollateralBalance,
    adapterDusdDelta: after.adapterDusdBalance - before.adapterDusdBalance
  };
}

/**
 * Assertion helper that provides better error messages for wei-level comparisons
 *
 * @param actual Actual value
 * @param expected Expected value
 * @param tolerance Optional tolerance in wei (default: 0 for exact match)
 * @param decimals Token decimals for formatting error messages
 * @param label Description for the assertion
 */
export function assertBalanceEquals(
  actual: bigint,
  expected: bigint,
  decimals: number,
  label: string,
  tolerance: bigint = 0n
): void {
  const diff = actual > expected ? actual - expected : expected - actual;

  if (diff > tolerance) {
    const actualFormatted = ethers.formatUnits(actual, decimals);
    const expectedFormatted = ethers.formatUnits(expected, decimals);
    const diffFormatted = ethers.formatUnits(diff, decimals);

    throw new Error(
      `${label}: Expected ${expectedFormatted} but got ${actualFormatted} (diff: ${diffFormatted})`
    );
  }
}

/**
 * Precision handling notes for test authors
 *
 * IMPORTANT: This exploit involves two token types with different decimals:
 * - wstkscUSD: 6 decimals (micro-units, 1e6)
 * - dUSD: 18 decimals (wei, 1e18)
 *
 * Wei-level precision requirements:
 * 1. Direct token transfers should be exact (0 tolerance)
 * 2. Flash loan premiums calculated as (amount * 5) / 10000 may have rounding
 * 3. Cross-token conversions are not tested (attack uses same-asset dust workaround)
 *
 * When to use approximate equality:
 * - Flash loan premium calculations (±1 wei tolerance)
 * - Multi-step dUSD staging flows with intermediate rounding
 *
 * When to require exact equality:
 * - Victim aToken balance changes (must equal COLLATERAL_TO_SWAP exactly)
 * - Attacker net gain from bursts (must equal BURST_ONE + BURST_TWO exactly)
 * - Flash mint amount (must equal FLASH_MINT_AMOUNT exactly)
 */

/**
 * Constants for common precision tolerances
 */
export const PRECISION = {
  EXACT: 0n,
  WEI_LEVEL: 1n,
  MICRO_LEVEL: 1n, // For 6-decimal tokens
  ROUNDING_TOLERANCE: 10n, // For multi-step calculations
} as const;