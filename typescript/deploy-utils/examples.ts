import { ethers } from "hardhat";
import {
  executeStateCheckedMutation,
  executeStateCheckedMutationBatch,
  executePermissionAwareMutation,
  ContractMutationFactory
} from "./state-checked-mutations";

/**
 * Example 1: Simple oracle setting (replaces the manual pattern we fixed)
 */
export async function setOracleExample(oracleAggregator: any, assetAddress: string, oracleAddress: string) {
  await executeStateCheckedMutation(
    ContractMutationFactory.setOracle(oracleAggregator, assetAddress, oracleAddress)
  );
}

/**
 * Example 2: Flash loan premium setting (replaces the manual pattern we fixed)
 */
export async function setFlashLoanPremiumExample(
  poolContract: any,
  poolConfiguratorContract: any,
  premiumConfig: { total: number; protocol: number }
) {
  await executeStateCheckedMutationBatch([
    {
      description: "Set flash loan premium total",
      getCurrentState: () => poolContract.FLASHLOAN_PREMIUM_TOTAL(),
      expectedState: premiumConfig.total,
      executeMutation: () => poolConfiguratorContract.updateFlashloanPremiumTotal(premiumConfig.total)
    },
    {
      description: "Set flash loan premium to protocol",
      getCurrentState: () => poolContract.FLASHLOAN_PREMIUM_TO_PROTOCOL(),
      expectedState: premiumConfig.protocol,
      executeMutation: () => poolConfiguratorContract.updateFlashloanPremiumToProtocol(premiumConfig.protocol)
    }
  ]);
}

/**
 * Example 3: Role management with permission checking
 */
export async function grantRoleExample(
  contract: any,
  role: string,
  account: string,
  deployerAddress: string
) {
  const DEFAULT_ADMIN_ROLE = await contract.DEFAULT_ADMIN_ROLE();

  await executePermissionAwareMutation({
    description: `Grant role ${role} to ${account}`,
    getCurrentState: () => contract.hasRole(role, account),
    expectedState: true,
    executeMutation: () => contract.grantRole(role, account),
    hasPermission: () => contract.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress),
    manualInstruction: `contract.grantRole("${role}", "${account}") - requires DEFAULT_ADMIN_ROLE`
  });
}

/**
 * Example 4: Complex adapter configuration
 */
export async function configureAdapterExample(
  router: any,
  vaultAssetAddress: string,
  adapterAddress: string,
  deployerAddress: string
) {
  const MANAGER_ROLE = await router.MANAGER_ROLE();

  await executePermissionAwareMutation({
    description: `Add adapter for vault asset ${vaultAssetAddress}`,
    getCurrentState: () => router.vaultAssetToAdapter(vaultAssetAddress),
    expectedState: adapterAddress,
    executeMutation: () => router.addAdapter(vaultAssetAddress, adapterAddress),
    hasPermission: () => router.hasRole(MANAGER_ROLE, deployerAddress),
    manualInstruction: `router.addAdapter("${vaultAssetAddress}", "${adapterAddress}") - requires MANAGER_ROLE`,
    stateComparator: (current: string, expected: string) => {
      // Special case: zero address means no adapter set
      if (current === ethers.ZeroAddress && expected !== ethers.ZeroAddress) {
        return false;
      }
      return current.toLowerCase() === expected.toLowerCase();
    }
  });
}

/**
 * Example 5: Batch oracle configuration (cleaner version of our fixed scripts)
 */
export async function configureBatchOraclesExample(
  oracleAggregator: any,
  oracleConfigs: Array<{ asset: string; oracle: string; description?: string }>
) {
  const mutations = oracleConfigs.map(config =>
    ContractMutationFactory.setOracle(oracleAggregator, config.asset, config.oracle)
  );

  const results = await executeStateCheckedMutationBatch(mutations);

  const executed = results.filter(r => r.executed).length;
  const skipped = results.filter(r => !r.executed).length;

  console.log(`\n📊 Oracle configuration summary: ${executed} executed, ${skipped} skipped`);
}

/**
 * Example 6: Address provider setup with validation
 */
export async function setAddressProviderExample(
  addressesProvider: any,
  addressId: string,
  implementationAddress: string,
  description: string
) {
  await executeStateCheckedMutation({
    description: `Set ${description} in AddressesProvider`,
    getCurrentState: () => addressesProvider.getAddressFromID(addressId),
    expectedState: implementationAddress,
    executeMutation: () => addressesProvider.setAddressAsProxy(addressId, implementationAddress),
    stateComparator: (current: string, expected: string) => {
      // Handle zero address case
      if (current === ethers.ZeroAddress && expected !== ethers.ZeroAddress) {
        return false;
      }
      return current.toLowerCase() === expected.toLowerCase();
    }
  });
}

/**
 * Example 7: Custom validation with complex state
 */
export async function setComplexConfigExample(
  contract: any,
  config: { threshold: bigint; enabled: boolean; admin: string }
) {
  await executeStateCheckedMutation({
    description: "Update complex configuration",
    getCurrentState: async () => {
      const [threshold, enabled, admin] = await Promise.all([
        contract.threshold(),
        contract.enabled(),
        contract.admin()
      ]);
      return { threshold, enabled, admin };
    },
    expectedState: config,
    executeMutation: () => contract.updateConfig(config.threshold, config.enabled, config.admin),
    stateComparator: (current, expected) => {
      return (
        current.threshold.toString() === expected.threshold.toString() &&
        current.enabled === expected.enabled &&
        current.admin.toLowerCase() === expected.admin.toLowerCase()
      );
    }
  });
}