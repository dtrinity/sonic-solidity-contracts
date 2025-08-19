import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_ISSUER_CONTRACT_ID,
  DS_ISSUER_V2_CONTRACT_ID,
  DS_TOKEN_ID,
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
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
 * Ensure the given `grantee` holds MINTER_ROLE on the specified dStable token.
 * Uses Safe SDK for governance operations when available. If direct on-chain
 * execution fails, a Safe transaction is queued in `transactions` for offline
 * signing.
 *
 * @param hre - Hardhat runtime environment
 * @param stableAddress - Address of the ERC20StablecoinUpgradeable token
 * @param grantee - Address that should be granted MINTER_ROLE
 * @param transactions - Array to append a Safe transaction if governance is required
 * @returns true if operation succeeded or is already complete, false if pending governance
 */
async function ensureMinterRole(
  hre: HardhatRuntimeEnvironment,
  stableAddress: string,
  grantee: string,
  transactions: SafeTransactionData[],
): Promise<boolean> {
  const stable = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    stableAddress,
  );
  const MINTER_ROLE = await stable.MINTER_ROLE();

  if (!(await stable.hasRole(MINTER_ROLE, grantee))) {
    try {
      await stable.grantRole(MINTER_ROLE, grantee);
      console.log(`    ➕ Granted MINTER_ROLE to ${grantee}`);
      return true;
    } catch (e) {
      console.log(
        `    ⚠️ Could not grant MINTER_ROLE to ${grantee}: ${(e as Error).message}`,
      );

      console.log(
        `    🔄 Queueing governance transaction for MINTER_ROLE grant...`,
      );
      const transaction: SafeTransactionData = createGrantRoleTransaction(
        stableAddress,
        MINTER_ROLE,
        grantee,
        stable.interface,
      );
      transactions.push(transaction);
      console.log(`    📥 Added to batch for offline signing`);
      return false;
    }
  } else {
    console.log(`    ✓ MINTER_ROLE already granted to ${grantee}`);
    return true;
  }

  return true;
}

/**
 * Migrate IssuerV2 roles to governance in a safe, idempotent sequence.
 * Grants roles to governance first, then revokes them from the deployer.
 * If direct execution fails, generates Safe transactions appended to
 * `transactions` for offline signing.
 *
 * @param hre - Hardhat runtime environment
 * @param issuerName - Logical name/id of the issuer deployment
 * @param issuerAddress - Address of the IssuerV2 contract
 * @param deployerSigner - Deployer signer currently holding roles
 * @param governanceMultisig - Governance multisig address to receive roles
 * @param transactions - Array to append Safe transactions if governance is required
 * @returns true if all operations complete, false if pending governance
 */
async function migrateIssuerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  issuerName: string,
  issuerAddress: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  transactions: SafeTransactionData[],
): Promise<boolean> {
  const issuer = await hre.ethers.getContractAt(
    "IssuerV2",
    issuerAddress,
    deployerSigner,
  );

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const AMO_MANAGER_ROLE = await issuer.AMO_MANAGER_ROLE();
  const INCENTIVES_MANAGER_ROLE = await issuer.INCENTIVES_MANAGER_ROLE();
  const PAUSER_ROLE = await issuer.PAUSER_ROLE();

  const roles = [
    { name: "DEFAULT_ADMIN_ROLE", hash: DEFAULT_ADMIN_ROLE },
    { name: "AMO_MANAGER_ROLE", hash: AMO_MANAGER_ROLE },
    { name: "INCENTIVES_MANAGER_ROLE", hash: INCENTIVES_MANAGER_ROLE },
    { name: "PAUSER_ROLE", hash: PAUSER_ROLE },
  ];

  console.log(`  📄 Migrating roles for ${issuerName} at ${issuerAddress}`);

  let allComplete = true;

  for (const role of roles) {
    if (!(await issuer.hasRole(role.hash, governanceMultisig))) {
      try {
        await issuer.grantRole(role.hash, governanceMultisig);
        console.log(
          `    ➕ Granted ${role.name} to governance ${governanceMultisig}`,
        );
      } catch (e) {
        console.log(
          `    ⚠️ Could not grant ${role.name} to governance: ${(e as Error).message}`,
        );

        console.log(
          `    🔄 Queueing governance transaction for ${role.name} grant...`,
        );
        const transaction: SafeTransactionData = createGrantRoleTransaction(
          issuerAddress,
          role.hash,
          governanceMultisig,
          issuer.interface,
        );
        transactions.push(transaction);
        console.log(`    📥 Added to batch for offline signing`);
        allComplete = false;
      }
    } else {
      console.log(`    ✓ ${role.name} already granted to governance`);
    }
  }

  // Step 2: Revoke roles from deployer after granting to governance
  const deployerAddress = await deployerSigner.getAddress();
  console.log(`  🔄 Revoking roles from deployer ${deployerAddress}...`);

  for (const role of roles) {
    // Skip DEFAULT_ADMIN_ROLE as it's handled by ensureDefaultAdminExistsAndRevokeFrom
    if (role.hash === DEFAULT_ADMIN_ROLE) continue;

    const deployerHasRole = await issuer.hasRole(role.hash, deployerAddress);
    const governanceHasRole = await issuer.hasRole(
      role.hash,
      governanceMultisig,
    );

    if (deployerHasRole && governanceHasRole) {
      const roleName = role.name;

      try {
        await issuer.revokeRole(role.hash, deployerAddress);
        console.log(`    ➖ Revoked ${roleName} from deployer`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not revoke ${roleName} from deployer: ${(e as Error).message}`,
        );

        console.log(
          `    🔄 Queueing governance transaction for ${roleName} revocation...`,
        );
        const transaction: SafeTransactionData = createRevokeRoleTransaction(
          issuerAddress,
          role.hash,
          deployerAddress,
          issuer.interface,
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
      "IssuerV2",
      issuerAddress,
      governanceMultisig,
      deployerAddress,
      deployerSigner,
    );

  if (!adminMigrationComplete) {
    allComplete = false;
  }

  return allComplete;
}

/**
 * Wrapper for ensureDefaultAdminExistsAndRevokeFrom that returns boolean status
 *
 * @param hre - Hardhat runtime environment
 * @param contractName - Name of the contract for logging
 * @param contractAddress - Address of the contract
 * @param governanceMultisig - Address of governance multisig
 * @param deployerAddress - Address of the deployer
 * @param deployerSigner - Signer for the deployer
 */
async function ensureDefaultAdminExistsAndRevokeFromWithSafe(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  governanceMultisig: string,
  deployerAddress: string,
  deployerSigner: Signer,
): Promise<boolean> {
  try {
    // The original function uses manualActions array, we need to handle this differently
    // For now, we'll catch any errors and handle with Safe
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

    // If there are manual actions, it means we need Safe transactions
    if (manualActions.length > 0) {
      // This would need proper Safe transaction creation; return pending
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

  const issuerTransitions = [
    {
      oldId: DUSD_ISSUER_CONTRACT_ID,
      newId: DUSD_ISSUER_V2_CONTRACT_ID,
      tokenId: DUSD_TOKEN_ID,
      collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerId: DUSD_AMO_MANAGER_ID,
    },
    {
      oldId: DS_ISSUER_CONTRACT_ID,
      newId: DS_ISSUER_V2_CONTRACT_ID,
      tokenId: DS_TOKEN_ID,
      collateralVaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerId: DS_AMO_MANAGER_ID,
    },
  ];

  let allOperationsComplete = true;

  for (const t of issuerTransitions) {
    console.log(`\n🔄 Setting up ${t.newId}...`);

    const newIssuerDeployment = await deployments.get(t.newId);
    const newIssuerAddress = newIssuerDeployment.address;

    const tokenDeployment = await deployments.get(t.tokenId);
    const tokenAddress = tokenDeployment.address;

    const collateralVaultDeployment = await deployments.get(
      t.collateralVaultId,
    );
    const collateralVaultAddress = collateralVaultDeployment.address;

    const amoManagerDeployment = await deployments.get(t.amoManagerId);
    const _amoManagerAddress = amoManagerDeployment.address;

    // 1. Grant minter role on stablecoin to the new issuer
    console.log(
      `  🪙 Ensuring MINTER_ROLE for ${t.newId} on token ${t.tokenId}...`,
    );
    const minterRoleComplete = await ensureMinterRole(
      hre,
      tokenAddress,
      newIssuerAddress,
      transactions,
    );

    if (!minterRoleComplete) {
      allOperationsComplete = false;
    }

    // 2. Grant COLLATERAL_WITHDRAWER_ROLE to the new issuer on CollateralVault
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
        newIssuerAddress,
      ))
    ) {
      try {
        await collateralVault.grantRole(
          COLLATERAL_WITHDRAWER_ROLE,
          newIssuerAddress,
        );
        console.log(
          `    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to ${newIssuerAddress}`,
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
          newIssuerAddress,
          collateralVault.interface,
        );
        transactions.push(transaction);
        console.log(`    📥 Added to batch for offline signing`);
        allOperationsComplete = false;
      }
    } else {
      console.log(
        `    ✓ COLLATERAL_WITHDRAWER_ROLE already granted to ${newIssuerAddress}`,
      );
    }

    // 3. Note: Asset minting pause configuration would go here if needed
    // Currently all assets default to unpaused (minting enabled)

    // 4. Migrate roles to governance
    console.log(`  🔐 Migrating ${t.newId} roles to governance...`);
    const rolesMigrationComplete = await migrateIssuerRolesIdempotent(
      hre,
      t.newId,
      newIssuerAddress,
      deployerSigner,
      governanceMultisig,
      transactions,
    );

    if (!rolesMigrationComplete) {
      allOperationsComplete = false;
    }

    // Optional: keep old issuer operational until governance flips references
    console.log(
      `  ℹ️ New issuer ${t.newId} deployed and permissioned. Ensure dApp/services reference ${newIssuerAddress}.`,
    );
  }

  if (!allOperationsComplete) {
    if (transactions.length > 0 && safeManager) {
      const res = await safeManager.createBatchTransaction({
        description: `Setup IssuerV2: governance operations (${transactions.length})`,
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

func.id = "1_setup_issuerv2";
func.tags = ["setup-issuerv2"];
func.dependencies = [
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
  DUSD_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  DS_AMO_MANAGER_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DS_ISSUER_V2_CONTRACT_ID,
];

export default func;
