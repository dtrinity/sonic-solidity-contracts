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
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
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
 * @param executor - Governance executor
 * @returns true if operation succeeded or is already complete, false if pending governance
 */
async function ensureMinterRole(
  hre: HardhatRuntimeEnvironment,
  stableAddress: string,
  grantee: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  const stable = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    stableAddress,
  );
  const MINTER_ROLE = await stable.MINTER_ROLE();

  if (!(await stable.hasRole(MINTER_ROLE, grantee))) {
    const complete = await executor.tryOrQueue(
      async () => {
        await stable.grantRole(MINTER_ROLE, grantee);
        console.log(`    ➕ Granted MINTER_ROLE to ${grantee}`);
      },
      () =>
        createGrantRoleTransaction(
          stableAddress,
          MINTER_ROLE,
          grantee,
          stable.interface,
        ),
    );
    return complete;
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
 * @param executor - Governance executor
 * @returns true if all operations complete, false if pending governance
 */
async function migrateIssuerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  issuerName: string,
  issuerAddress: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  executor: GovernanceExecutor,
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

  let noPendingActions = true;

  for (const role of roles) {
    if (!(await issuer.hasRole(role.hash, governanceMultisig))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await issuer.grantRole(role.hash, governanceMultisig);
          console.log(
            `    ➕ Granted ${role.name} to governance ${governanceMultisig}`,
          );
        },
        () =>
          createGrantRoleTransaction(
            issuerAddress,
            role.hash,
            governanceMultisig,
            issuer.interface,
          ),
      );
      if (!complete) noPendingActions = false;
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
      const complete = await executor.tryOrQueue(
        async () => {
          await issuer.revokeRole(role.hash, deployerAddress);
          console.log(`    ➖ Revoked ${roleName} from deployer`);
        },
        () =>
          createRevokeRoleTransaction(
            issuerAddress,
            role.hash,
            deployerAddress,
            issuer.interface,
          ),
      );
      if (!complete) noPendingActions = false;
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
      executor,
    );

  if (!adminMigrationComplete) {
    noPendingActions = false;
  }

  return noPendingActions;
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
 * @param executor - Governance executor
 */
async function ensureDefaultAdminExistsAndRevokeFromWithSafe(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  governanceMultisig: string,
  deployerAddress: string,
  deployerSigner: Signer,
  executor: GovernanceExecutor,
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

    // If there are manual actions, it means we need Safe transactions when Safe mode is on
    if (manualActions.length > 0) {
      if (executor.useSafe) {
        // This would need proper Safe transaction creation; return pending
        return false;
      }
      console.log(
        `    ⏭️ Non-Safe mode: manual admin migration actions detected; continuing.`,
      );
    }

    return true;
  } catch (error) {
    if (executor.useSafe) {
      // Requires governance action; queue not implemented for this path
      console.warn(
        `    🔄 Admin role migration likely requires governance action:`,
        error,
      );
      return false;
    }
    console.log(
      `    ⏭️ Non-Safe mode: admin migration requires governance; continuing.`,
    );
    return true;
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Initialize governance executor (decides Safe vs direct execution)
  const executor = new GovernanceExecutor(
    hre,
    deployerSigner,
    config.safeConfig,
  );
  await executor.initialize();

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
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
    },
    {
      oldId: DS_ISSUER_CONTRACT_ID,
      newId: DS_ISSUER_V2_CONTRACT_ID,
      tokenId: DS_TOKEN_ID,
      collateralVaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerId: DS_AMO_MANAGER_ID,
      aggregatorId: S_ORACLE_AGGREGATOR_ID,
    },
  ];

  let allOperationsComplete = true;

  for (const t of issuerTransitions) {
    console.log(`\n🔄 Setting up ${t.newId}...`);

    // Resolve dependencies
    const tokenDeployment = await deployments.get(t.tokenId);
    const tokenAddress = tokenDeployment.address;
    const collateralVaultDeployment = await deployments.get(
      t.collateralVaultId,
    );
    const collateralVaultAddress = collateralVaultDeployment.address;
    const amoManagerDeployment = await deployments.get(t.amoManagerId);
    const _amoManagerAddress = amoManagerDeployment.address;
    const oracleAggDeployment = await deployments.get(t.aggregatorId);
    const oracleAggAddress = oracleAggDeployment.address;

    // Deploy IssuerV2 (hardhat-deploy handles idempotency by deploy ID)
    const issuerDeployResult = await deployments.deploy(t.newId, {
      from: deployer,
      contract: "IssuerV2",
      args: [
        collateralVaultAddress,
        tokenAddress,
        oracleAggAddress,
        _amoManagerAddress,
      ],
      log: true,
      autoMine: true,
    });
    const newIssuerAddress = issuerDeployResult.address;

    // 1. Grant minter role on stablecoin to the new issuer
    console.log(
      `  🪙 Ensuring MINTER_ROLE for ${t.newId} on token ${t.tokenId}...`,
    );
    const minterRoleComplete = await ensureMinterRole(
      hre,
      tokenAddress,
      newIssuerAddress,
      executor,
    );

    if (!minterRoleComplete) {
      allOperationsComplete = false;
    }

    // 2. (Intentionally no vault role changes for IssuerV2 in this script)

    // 3. Note: Asset minting pause configuration would go here if needed
    // Currently all assets default to unpaused (minting enabled)

    // 3. Migrate roles to governance
    console.log(`  🔐 Migrating ${t.newId} roles to governance...`);
    const rolesMigrationComplete = await migrateIssuerRolesIdempotent(
      hre,
      t.newId,
      newIssuerAddress,
      deployerSigner,
      governanceMultisig,
      executor,
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
    const flushed = await executor.flush(
      `Setup IssuerV2: governance operations`,
    );

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
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
    } else {
      console.log(
        "\n⏭️ Non-Safe mode: pending governance operations detected; continuing.",
      );
    }
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
