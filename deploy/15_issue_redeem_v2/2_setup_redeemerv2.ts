import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_REDEEMER_CONTRACT_ID,
  DS_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";
import { SafeManager } from "../../typescript/safe/SafeManager";
// Local helpers for building Safe transactions (offline)
import { SafeTransactionData } from "../../typescript/safe/types";

/**
 * Build a Safe transaction payload to grant a role on a target contract.
 *
 * @param contractAddress - Address of the contract to call
 * @param role - Role hash to grant
 * @param grantee - Address to receive the role
 * @param contractInterface - Contract interface used to encode the call
 */
function createGrantRoleTransaction(
  contractAddress: string,
  role: string,
  grantee: string,
  contractInterface: any,
): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [role, grantee]),
  };
}

/**
 * Build a Safe transaction payload to revoke a role on a target contract.
 *
 * @param contractAddress - Address of the contract to call
 * @param role - Role hash to revoke
 * @param account - Address to revoke the role from
 * @param contractInterface - Contract interface used to encode the call
 */
function createRevokeRoleTransaction(
  contractAddress: string,
  role: string,
  account: string,
  contractInterface: any,
): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("revokeRole", [role, account]),
  };
}

const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Migrate roles to governance multisig (always idempotent).
 * Uses Safe SDK for governance operations when available. If direct on-chain
 * execution fails, Safe transactions are appended to `transactions`.
 *
 * @param hre - HardhatRuntimeEnvironment
 * @param redeemerAddress - Address of the RedeemerV2 contract
 * @param deployerAddress - Address of the deployer
 * @param governanceMultisig - Address of the governance multisig
 * @param transactions - Array to append Safe transactions if governance is required
 * @returns true if all operations complete, false if pending governance
 */
async function migrateRedeemerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  redeemerAddress: string,
  deployerAddress: string,
  governanceMultisig: string,
  transactions: SafeTransactionData[],
): Promise<boolean> {
  const redeemer = await hre.ethers.getContractAt(
    "RedeemerV2",
    redeemerAddress,
  );
  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const REDEMPTION_MANAGER_ROLE = await redeemer.REDEMPTION_MANAGER_ROLE();
  const PAUSER_ROLE = await redeemer.PAUSER_ROLE();

  const roles = [
    { name: "DEFAULT_ADMIN_ROLE", hash: DEFAULT_ADMIN_ROLE },
    { name: "REDEMPTION_MANAGER_ROLE", hash: REDEMPTION_MANAGER_ROLE },
    { name: "PAUSER_ROLE", hash: PAUSER_ROLE },
  ];

  let allComplete = true;

  for (const role of roles) {
    if (!(await redeemer.hasRole(role.hash, governanceMultisig))) {
      try {
        await redeemer.grantRole(role.hash, governanceMultisig);
        console.log(`    ➕ Granted ${role.name} to ${governanceMultisig}`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not grant ${role.name} to ${governanceMultisig}: ${(e as Error).message}`,
        );

        console.log(
          `    🔄 Queueing governance transaction for ${role.name} grant...`,
        );
        const transaction: SafeTransactionData = createGrantRoleTransaction(
          redeemerAddress,
          role.hash,
          governanceMultisig,
          redeemer.interface,
        );
        transactions.push(transaction);
        console.log(`    📥 Added to batch for offline signing`);
        allComplete = false;
      }
    } else {
      console.log(`    ✓ ${role.name} already granted to governance`);
    }
  }

  // Step 2: Revoke roles from deployer
  console.log(`  🔄 Revoking roles from deployer ${deployerAddress}...`);

  for (const role of roles) {
    // Skip DEFAULT_ADMIN_ROLE as it's handled separately
    if (role.hash === DEFAULT_ADMIN_ROLE) continue;

    const deployerHasRole = await redeemer.hasRole(role.hash, deployerAddress);
    const governanceHasRole = await redeemer.hasRole(
      role.hash,
      governanceMultisig,
    );

    if (deployerHasRole && governanceHasRole) {
      try {
        await redeemer.revokeRole(role.hash, deployerAddress);
        console.log(`    ➖ Revoked ${role.name} from deployer`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not revoke ${role.name} from deployer: ${(e as Error).message}`,
        );

        console.log(
          `    🔄 Queueing governance transaction for ${role.name} revocation...`,
        );
        const transaction: SafeTransactionData = createRevokeRoleTransaction(
          redeemerAddress,
          role.hash,
          deployerAddress,
          redeemer.interface,
        );
        transactions.push(transaction);
        console.log(`    📥 Added to batch for offline signing`);
        allComplete = false;
      }
    }
  }

  // Safely migrate DEFAULT_ADMIN_ROLE away from deployer
  const adminMigrationComplete =
    await ensureDefaultAdminExistsAndRevokeFromWithSafe(
      hre,
      "RedeemerV2",
      redeemerAddress,
      governanceMultisig,
      deployerAddress,
    );

  if (!adminMigrationComplete) {
    allComplete = false;
  }

  return allComplete;
}

/**
 * Wrapper for ensureDefaultAdminExistsAndRevokeFrom that returns boolean status.
 *
 * @param hre - Hardhat runtime environment
 * @param contractName - Name of the contract for logging
 * @param contractAddress - Address of the contract
 * @param governanceMultisig - Address of governance multisig
 * @param deployerAddress - Address of the deployer
 */
async function ensureDefaultAdminExistsAndRevokeFromWithSafe(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  governanceMultisig: string,
  deployerAddress: string,
): Promise<boolean> {
  try {
    // The original function uses manualActions array, we need to handle this differently
    const deployerSigner = await hre.ethers.getSigner(deployerAddress);
    const manualActions: string[] = [];
    await ensureDefaultAdminExistsAndRevokeFrom(
      hre,
      contractName,
      contractAddress,
      governanceMultisig,
      deployerAddress,
      deployerSigner,
      manualActions,
    );

    // If there are manual actions, it means we need governance action; return pending
    if (manualActions.length > 0) {
      return false;
    }

    return true;
  } catch (error) {
    // Requires governance action; queue not implemented for this path
    console.warn(
      `    🔄 Admin role migration likely requires governance action:`,
      error,
    );
    return false;
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Initialize Safe Manager if Safe configuration is available
  let safeManager: SafeManager | undefined;
  const transactions: SafeTransactionData[] = [];

  if (config.safeConfig) {
    console.log(`🔐 Initializing Safe Manager for governance operations...`);

    try {
      safeManager = new SafeManager(hre, deployerSigner, {
        safeConfig: config.safeConfig,
      });
      await safeManager.initialize();
      console.log(`✅ Safe Manager initialized successfully`);
    } catch (error) {
      console.warn(`⚠️ Failed to initialize Safe Manager:`, error);
      console.log(
        `❌ Safe Manager required for governance operations. Please ensure Safe is properly configured.`,
      );
      return false; // Fail idempotently
    }
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const redeemerTransitions = [
    {
      oldId: DUSD_REDEEMER_CONTRACT_ID,
      newId: "RedeemerV2_DUSD",
      tokenId: DUSD_TOKEN_ID,
      collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
    },
    {
      oldId: DS_REDEEMER_CONTRACT_ID,
      newId: "RedeemerV2_DS",
      tokenId: DS_TOKEN_ID,
      collateralVaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
    },
  ];

  let allOperationsComplete = true;

  for (const t of redeemerTransitions) {
    console.log(`\n🔄 Setting up ${t.newId}...`);

    const newRedeemerDeployment = await deployments.get(t.newId);
    const newRedeemerAddress = newRedeemerDeployment.address;
    // Avoid assigning `newRedeemer` when it's not used to satisfy linter
    await hre.ethers.getContractAt("RedeemerV2", newRedeemerAddress);

    const tokenDeployment = await deployments.get(t.tokenId);
    const _tokenAddress = tokenDeployment.address;

    const collateralVaultDeployment = await deployments.get(
      t.collateralVaultId,
    );
    const collateralVaultAddress = collateralVaultDeployment.address;

    // 1. Grant COLLATERAL_WITHDRAWER_ROLE to the new redeemer on CollateralVault
    console.log(
      `  🏦 Granting COLLATERAL_WITHDRAWER_ROLE to ${t.newId} on ${t.collateralVaultId}...`,
    );
    const collateralVault = await hre.ethers.getContractAt(
      "CollateralHolderVault",
      collateralVaultAddress,
    );
    const COLLATERAL_WITHDRAWER_ROLE =
      await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

    if (
      !(await collateralVault.hasRole(
        COLLATERAL_WITHDRAWER_ROLE,
        newRedeemerAddress,
      ))
    ) {
      try {
        await collateralVault.grantRole(
          COLLATERAL_WITHDRAWER_ROLE,
          newRedeemerAddress,
        );
        console.log(
          `    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to ${newRedeemerAddress}`,
        );
      } catch (e) {
        console.log(
          `    ⚠️ Could not grant COLLATERAL_WITHDRAWER_ROLE: ${(e as Error).message}`,
        );

        console.log(
          `    🔄 Queueing governance transaction for COLLATERAL_WITHDRAWER_ROLE grant...`,
        );
        const transaction = createGrantRoleTransaction(
          collateralVaultAddress,
          COLLATERAL_WITHDRAWER_ROLE,
          newRedeemerAddress,
          collateralVault.interface,
        );
        transactions.push(transaction);
        console.log(`    📥 Added to batch for offline signing`);
        allOperationsComplete = false;
      }
    } else {
      console.log(
        `    ✓ COLLATERAL_WITHDRAWER_ROLE already granted to ${newRedeemerAddress}`,
      );
    }

    // 2. Note: Asset redemption pause configuration would go here if needed
    // Currently all assets default to unpaused (redemption enabled)

    // 3. Migrate roles to governance
    console.log(`  🔐 Migrating ${t.newId} roles to governance...`);
    const rolesMigrationComplete = await migrateRedeemerRolesIdempotent(
      hre,
      newRedeemerAddress,
      deployer,
      governanceMultisig,
      transactions,
    );

    if (!rolesMigrationComplete) {
      allOperationsComplete = false;
    }

    console.log(
      `  ℹ️ New redeemer ${t.newId} deployed and permissioned at ${newRedeemerAddress}.`,
    );
  }

  if (!allOperationsComplete) {
    if (transactions.length > 0 && safeManager) {
      const res = await safeManager.createBatchTransaction({
        description: `Setup RedeemerV2: governance operations (${transactions.length})`,
        transactions,
      });

      if (!res.success) {
        console.log(`❌ Failed to prepare governance batch: ${res.error}`);
      }
    }
    console.log(
      "\n⏳ Some operations require governance signatures to complete.",
    );
    console.log(
      "   The deployment script will exit and can be re-run after governance executes the transactions.",
    );
    console.log(
      `\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`,
    );
    return false; // Fail idempotently - script can be re-run
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "2_setup_redeemerv2";
func.tags = ["setup-redeemerv2"];
func.dependencies = [
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  "RedeemerV2_DUSD",
  "RedeemerV2_DS",
];

export default func;
