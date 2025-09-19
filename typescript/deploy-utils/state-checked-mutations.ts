import { ContractTransactionResponse, BaseContract } from "ethers";

/**
 * Configuration for state-checked mutations
 */
export interface StateCheckedMutationConfig<T = any> {
  /** Description of the action for logging */
  description: string;
  /** Function to get current on-chain state */
  getCurrentState: () => Promise<T>;
  /** Expected target state */
  expectedState: T;
  /** Function to execute the mutation */
  executeMutation: () => Promise<ContractTransactionResponse>;
  /** Custom comparison function (defaults to deep equality) */
  stateComparator?: (current: T, expected: T) => boolean;
  /** Whether to wait for transaction confirmation (default: true) */
  waitForConfirmation?: boolean;
  /** Custom log prefix (default: "  ⚙️") */
  logPrefix?: string;
}

/**
 * Result of a state-checked mutation
 */
export interface MutationResult {
  /** Whether the mutation was executed */
  executed: boolean;
  /** Transaction response if executed */
  transaction?: ContractTransactionResponse;
  /** Reason for skipping (if not executed) */
  skipReason?: string;
}

/**
 * Default state comparator using string conversion for safe comparison
 */
const defaultStateComparator = <T>(current: T, expected: T): boolean => {
  // Handle address comparison (case insensitive)
  if (typeof current === "string" && typeof expected === "string") {
    return current.toLowerCase() === expected.toLowerCase();
  }

  // Handle BigInt/number comparison by converting to string
  if (typeof current === "bigint" || typeof expected === "bigint") {
    return current.toString() === expected.toString();
  }

  // Handle arrays
  if (Array.isArray(current) && Array.isArray(expected)) {
    if (current.length !== expected.length) return false;
    return current.every((item, index) => defaultStateComparator(item, expected[index]));
  }

  // Handle objects
  if (typeof current === "object" && typeof expected === "object" && current !== null && expected !== null) {
    const currentKeys = Object.keys(current);
    const expectedKeys = Object.keys(expected);

    if (currentKeys.length !== expectedKeys.length) return false;

    return currentKeys.every(key =>
      expectedKeys.includes(key) &&
      defaultStateComparator((current as any)[key], (expected as any)[key])
    );
  }

  // Fallback to strict equality
  return current === expected;
};

/**
 * Execute a state-checked mutation - only performs the mutation if current state differs from expected
 */
export async function executeStateCheckedMutation<T>(
  config: StateCheckedMutationConfig<T>
): Promise<MutationResult> {
  const {
    description,
    getCurrentState,
    expectedState,
    executeMutation,
    stateComparator = defaultStateComparator,
    waitForConfirmation = true,
    logPrefix = "  ⚙️"
  } = config;

  try {
    // Get current state
    const currentState = await getCurrentState();

    // Check if mutation is needed
    const statesMatch = stateComparator(currentState, expectedState);

    if (statesMatch) {
      console.log(`${logPrefix} ${description} already configured correctly. Skipping.`);
      return {
        executed: false,
        skipReason: "State already matches expected value"
      };
    }

    // Execute mutation
    console.log(`${logPrefix} ${description}...`);
    const transaction = await executeMutation();

    if (waitForConfirmation) {
      await transaction.wait();
      console.log(`${logPrefix} ${description} completed. Tx: ${transaction.hash}`);
    } else {
      console.log(`${logPrefix} ${description} submitted. Tx: ${transaction.hash}`);
    }

    return {
      executed: true,
      transaction
    };

  } catch (error) {
    console.error(`❌ Failed to execute ${description}:`, error);
    throw error;
  }
}

/**
 * Batch execute multiple state-checked mutations
 */
export async function executeStateCheckedMutationBatch(
  mutations: StateCheckedMutationConfig[]
): Promise<MutationResult[]> {
  const results: MutationResult[] = [];

  for (const mutation of mutations) {
    const result = await executeStateCheckedMutation(mutation);
    results.push(result);
  }

  return results;
}

/**
 * Helper factory for common contract mutations
 */
export class ContractMutationFactory {
  /**
   * Create a state-checked mutation for setting a simple contract value
   */
  static setValue<T extends BaseContract>(
    contract: T,
    description: string,
    getCurrentValue: () => Promise<any>,
    setValue: (value: any) => Promise<ContractTransactionResponse>,
    targetValue: any
  ): StateCheckedMutationConfig {
    return {
      description,
      getCurrentState: getCurrentValue,
      expectedState: targetValue,
      executeMutation: () => setValue(targetValue)
    };
  }

  /**
   * Create a state-checked mutation for address assignments
   */
  static setAddress<T extends BaseContract>(
    contract: T,
    description: string,
    getCurrentAddress: () => Promise<string>,
    setAddress: (address: string) => Promise<ContractTransactionResponse>,
    targetAddress: string
  ): StateCheckedMutationConfig<string> {
    return {
      description,
      getCurrentState: getCurrentAddress,
      expectedState: targetAddress,
      executeMutation: () => setAddress(targetAddress),
      stateComparator: (current: string, expected: string) =>
        current.toLowerCase() === expected.toLowerCase()
    };
  }

  /**
   * Create a state-checked mutation for role assignments
   */
  static grantRole<T extends BaseContract>(
    contract: T,
    description: string,
    role: string,
    account: string
  ): StateCheckedMutationConfig<boolean> {
    return {
      description,
      getCurrentState: () => (contract as any).hasRole(role, account),
      expectedState: true,
      executeMutation: () => (contract as any).grantRole(role, account)
    };
  }

  /**
   * Create a state-checked mutation for oracle settings
   */
  static setOracle(
    oracleAggregator: BaseContract,
    assetAddress: string,
    oracleAddress: string
  ): StateCheckedMutationConfig<string> {
    return {
      description: `Set oracle for asset ${assetAddress}`,
      getCurrentState: () => (oracleAggregator as any).assetOracles(assetAddress),
      expectedState: oracleAddress,
      executeMutation: () => (oracleAggregator as any).setOracle(assetAddress, oracleAddress),
      stateComparator: (current: string, expected: string) =>
        current.toLowerCase() === expected.toLowerCase()
    };
  }
}

/**
 * Helper for permission-aware mutations that can provide manual instructions
 */
export interface PermissionAwareMutationConfig<T> extends StateCheckedMutationConfig<T> {
  /** Function to check if deployer has permission */
  hasPermission: () => Promise<boolean>;
  /** Manual instruction to provide if permission is missing */
  manualInstruction: string;
}

export interface PermissionAwareMutationResult extends MutationResult {
  /** Manual instruction if permission was missing */
  manualInstruction?: string;
}

/**
 * Execute a permission-aware mutation
 */
export async function executePermissionAwareMutation<T>(
  config: PermissionAwareMutationConfig<T>
): Promise<PermissionAwareMutationResult> {
  const { hasPermission, manualInstruction, ...mutationConfig } = config;

  try {
    // Check current state first
    const currentState = await mutationConfig.getCurrentState();
    const stateComparator = mutationConfig.stateComparator || defaultStateComparator;
    const statesMatch = stateComparator(currentState, mutationConfig.expectedState);

    if (statesMatch) {
      console.log(`${mutationConfig.logPrefix || "  ⚙️"} ${mutationConfig.description} already configured correctly. Skipping.`);
      return {
        executed: false,
        skipReason: "State already matches expected value"
      };
    }

    // Check permission
    const hasPerm = await hasPermission();
    if (!hasPerm) {
      console.log(`⚠️  Insufficient permissions for: ${mutationConfig.description}`);
      console.log(`   Manual action required: ${manualInstruction}`);

      return {
        executed: false,
        skipReason: "Insufficient permissions",
        manualInstruction
      };
    }

    // Execute the mutation
    return await executeStateCheckedMutation(mutationConfig);

  } catch (error) {
    console.error(`❌ Failed to execute ${mutationConfig.description}:`, error);
    throw error;
  }
}