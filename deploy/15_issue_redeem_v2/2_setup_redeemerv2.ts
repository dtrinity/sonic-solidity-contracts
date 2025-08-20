import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_REDEEMER_CONTRACT_ID,
  DS_REDEEMER_WITH_FEES_CONTRACT_ID,
  DS_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_REDEEMER_WITH_FEES_CONTRACT_ID,
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
 * Migrate roles to governance multisig (always idempotent).
 * Uses Safe SDK for governance operations when available. If direct on-chain
 * execution fails, Safe transactions are appended to `transactions`.
 *
 * @param hre - HardhatRuntimeEnvironment
 * @param redeemerAddress - Address of the RedeemerV2 contract
 * @param deployerAddress - Address of the deployer
 * @param governanceMultisig - Address of the governance multisig
 * @param executor - Governance executor
 * @returns true if all operations complete, false if pending governance
 */
async function migrateRedeemerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  redeemerAddress: string,
  deployerAddress: string,
  governanceMultisig: string,
  executor: GovernanceExecutor,
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
      const complete = await executor.tryOrQueue(
        async () => {
          await redeemer.grantRole(role.hash, governanceMultisig);
          console.log(`    ➕ Granted ${role.name} to ${governanceMultisig}`);
        },
        () =>
          createGrantRoleTransaction(
            redeemerAddress,
            role.hash,
            governanceMultisig,
            redeemer.interface,
          ),
      );
      if (!complete) allComplete = false;
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
      const complete = await executor.tryOrQueue(
        async () => {
          await redeemer.revokeRole(role.hash, deployerAddress);
          console.log(`    ➖ Revoked ${role.name} from deployer`);
        },
        () =>
          createRevokeRoleTransaction(
            redeemerAddress,
            role.hash,
            deployerAddress,
            redeemer.interface,
          ),
      );
      if (!complete) allComplete = false;
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
  // Determine Safe mode once for both try and catch blocks
  const envForce = process.env.USE_SAFE?.toLowerCase() === "true";
  const chainIdStr = String(hre.network.config.chainId ?? "");
  const isSonicMainnet = chainIdStr === "146";
  const useSafe = isSonicMainnet || envForce;

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

    // If there are manual actions, it means we need governance action when in Safe mode
    if (manualActions.length > 0) {
      if (useSafe) {
        return false;
      }
      console.log(
        `    ⏭️ Non-Safe mode: manual admin migration actions detected; continuing.`,
      );
    }

    return true;
  } catch (error) {
    if (useSafe) {
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

  const redeemerTransitions = [
    {
      oldId: DUSD_REDEEMER_CONTRACT_ID,
      newId: "RedeemerV2_DUSD",
      tokenId: DUSD_TOKEN_ID,
      collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
    },
    {
      oldId: DS_REDEEMER_CONTRACT_ID,
      newId: "RedeemerV2_DS",
      tokenId: DS_TOKEN_ID,
      collateralVaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      aggregatorId: S_ORACLE_AGGREGATOR_ID,
    },
  ];

  let allOperationsComplete = true;

  for (const t of redeemerTransitions) {
    console.log(`\n🔄 Setting up ${t.newId}...`);

    const tokenDeployment = await deployments.get(t.tokenId);
    const _tokenAddress = tokenDeployment.address;

    const collateralVaultDeployment = await deployments.get(
      t.collateralVaultId,
    );
    const collateralVaultAddress = collateralVaultDeployment.address;

    const oracleAggDeployment = await deployments.get(t.aggregatorId);
    const oracleAggAddress = oracleAggDeployment.address;

    // Deploy RedeemerV2 using hardhat-deploy idempotency (by deploy ID)
    const redeemerDeployResult = await deployments.deploy(t.newId, {
      from: deployer,
      contract: "RedeemerV2",
      args: [
        collateralVaultAddress,
        _tokenAddress,
        oracleAggAddress,
        governanceMultisig,
        0,
      ],
      log: true,
      autoMine: true,
    });

    const newRedeemerAddress = redeemerDeployResult.address;
    await hre.ethers.getContractAt("RedeemerV2", newRedeemerAddress);

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
      const complete = await executor.tryOrQueue(
        async () => {
          await collateralVault.grantRole(
            COLLATERAL_WITHDRAWER_ROLE,
            newRedeemerAddress,
          );
          console.log(
            `    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to ${newRedeemerAddress}`,
          );
        },
        () =>
          createGrantRoleTransaction(
            collateralVaultAddress,
            COLLATERAL_WITHDRAWER_ROLE,
            newRedeemerAddress,
            collateralVault.interface,
          ),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(
        `    ✓ COLLATERAL_WITHDRAWER_ROLE already granted to ${newRedeemerAddress}`,
      );
    }

    // 1b. Revoke COLLATERAL_WITHDRAWER_ROLE from legacy Redeemer contracts
    const legacyIds = [
      t.oldId,
      t.newId === "RedeemerV2_DUSD"
        ? DUSD_REDEEMER_WITH_FEES_CONTRACT_ID
        : DS_REDEEMER_WITH_FEES_CONTRACT_ID,
    ];

    for (const legacyId of legacyIds) {
      const legacyDep = await deployments.getOrNull(legacyId);
      if (!legacyDep) continue;

      if (
        await collateralVault.hasRole(
          COLLATERAL_WITHDRAWER_ROLE,
          legacyDep.address,
        )
      ) {
        const complete = await executor.tryOrQueue(
          async () => {
            await collateralVault.revokeRole(
              COLLATERAL_WITHDRAWER_ROLE,
              legacyDep.address,
            );
            console.log(
              `    ➖ Revoked COLLATERAL_WITHDRAWER_ROLE from ${legacyId} (${legacyDep.address})`,
            );
          },
          () =>
            createRevokeRoleTransaction(
              collateralVaultAddress,
              COLLATERAL_WITHDRAWER_ROLE,
              legacyDep.address,
              collateralVault.interface,
            ),
        );
        if (!complete) allOperationsComplete = false;
      } else {
        console.log(
          `    ✓ ${legacyId} does not have COLLATERAL_WITHDRAWER_ROLE or already revoked`,
        );
      }
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
      executor,
    );

    if (!rolesMigrationComplete) {
      allOperationsComplete = false;
    }

    console.log(
      `  ℹ️ New redeemer ${t.newId} deployed and permissioned at ${newRedeemerAddress}.`,
    );
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush(
      `Setup RedeemerV2: governance operations`,
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
