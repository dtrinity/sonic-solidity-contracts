import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DS_AMO_DEBT_TOKEN_ID, DS_AMO_MANAGER_V2_ID, DUSD_AMO_DEBT_TOKEN_ID, DUSD_AMO_MANAGER_V2_ID } from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const ZERO_BYTES_32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Migrate roles from deployer to governance for AMO contracts
 *
 * @param hre The Hardhat runtime environment
 * @param contractName The name of the contract to migrate roles for
 * @param contractAddress The address of the deployed contract
 * @param deployerSigner The signer for the deployer account
 * @param governanceMultisig The address of the governance multisig
 * @param executor The governance executor for Safe transactions
 * @param roleNames Array of role names and their keccak256 hashes to migrate
 */
async function migrateContractRolesToGovernance(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  executor: GovernanceExecutor,
  roleNames: { name: string; hash: string }[],
): Promise<boolean> {
  const contract = await hre.ethers.getContractAt(contractName, contractAddress, deployerSigner);

  console.log(`  📄 Migrating roles for ${contractName} at ${contractAddress}`);

  let noPendingActions = true;

  // Step 1: Grant roles to governance first
  for (const role of roleNames) {
    if (!(await contract.hasRole(role.hash, governanceMultisig))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await contract.grantRole(role.hash, governanceMultisig);
          console.log(`    ➕ Granted ${role.name} to governance ${governanceMultisig}`);
        },
        () => ({
          to: contractAddress,
          value: "0",
          data: contract.interface.encodeFunctionData("grantRole", [role.hash, governanceMultisig]),
        }),
      );
      if (!complete) noPendingActions = false;
    } else {
      console.log(`    ✓ ${role.name} already granted to governance`);
    }
  }

  // Step 2: Revoke roles from deployer after granting to governance
  const deployerAddress = await deployerSigner.getAddress();
  console.log(`  🔄 Revoking roles from deployer ${deployerAddress}...`);

  for (const role of roleNames) {
    // Skip DEFAULT_ADMIN_ROLE as it's handled by ensureDefaultAdminExistsAndRevokeFrom
    if (role.hash === ZERO_BYTES_32) continue;

    const deployerHasRole = await contract.hasRole(role.hash, deployerAddress);
    const governanceHasRole = await contract.hasRole(role.hash, governanceMultisig);

    if (deployerHasRole && governanceHasRole) {
      const complete = await executor.tryOrQueue(
        async () => {
          await contract.revokeRole(role.hash, deployerAddress);
          console.log(`    ➖ Revoked ${role.name} from deployer`);
        },
        () => ({
          to: contractAddress,
          value: "0",
          data: contract.interface.encodeFunctionData("revokeRole", [role.hash, deployerAddress]),
        }),
      );
      if (!complete) noPendingActions = false;
    }
  }

  // Step 3: Handle DEFAULT_ADMIN_ROLE migration
  try {
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

    if (manualActions.length > 0 && executor.useSafe) {
      noPendingActions = false;
    }
  } catch (error) {
    if (executor.useSafe) {
      console.warn(`    🔄 Admin role migration likely requires governance action:`, error);
      noPendingActions = false;
    } else {
      console.log(`    ⏭️ Non-Safe mode: admin migration requires governance; continuing.`);
    }
  }

  return noPendingActions;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Initialize governance executor
  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const contractMigrations = [
    {
      name: "AmoDebtToken (dUSD)",
      deploymentId: DUSD_AMO_DEBT_TOKEN_ID,
      contractName: "AmoDebtToken",
      roles: [
        { name: "DEFAULT_ADMIN_ROLE", hash: ZERO_BYTES_32 },
        { name: "AMO_MANAGER_ROLE", hash: undefined },
      ],
    },
    {
      name: "AmoDebtToken (dS)",
      deploymentId: DS_AMO_DEBT_TOKEN_ID,
      contractName: "AmoDebtToken",
      roles: [
        { name: "DEFAULT_ADMIN_ROLE", hash: ZERO_BYTES_32 },
        { name: "AMO_MANAGER_ROLE", hash: undefined },
      ],
    },
    {
      name: "AmoManagerV2 (dUSD)",
      deploymentId: DUSD_AMO_MANAGER_V2_ID,
      contractName: "AmoManagerV2",
      roles: [
        { name: "DEFAULT_ADMIN_ROLE", hash: ZERO_BYTES_32 },
        { name: "AMO_INCREASE_ROLE", hash: undefined },
        { name: "AMO_DECREASE_ROLE", hash: undefined },
      ],
    },
    {
      name: "AmoManagerV2 (dS)",
      deploymentId: DS_AMO_MANAGER_V2_ID,
      contractName: "AmoManagerV2",
      roles: [
        { name: "DEFAULT_ADMIN_ROLE", hash: ZERO_BYTES_32 },
        { name: "AMO_INCREASE_ROLE", hash: undefined },
        { name: "AMO_DECREASE_ROLE", hash: undefined },
      ],
    },
  ];

  let allOperationsComplete = true;

  for (const migration of contractMigrations) {
    console.log(`\n🔄 Migrating roles for ${migration.name}...`);

    // Get deployment
    const deployment = await deployments.get(migration.deploymentId);
    const contract = await ethers.getContractAt(migration.contractName, deployment.address, deployerSigner);

    // Fetch dynamic role hashes
    const rolesWithHashes = await Promise.all(
      migration.roles.map(async (role) => {
        if (role.hash === undefined) {
          try {
            const roleHash = await contract[role.name]();
            return { name: role.name, hash: roleHash };
          } catch (error) {
            console.warn(`    ⚠️  Could not fetch role hash for ${role.name}: ${error}`);
            return { name: role.name, hash: "0x" };
          }
        }
        return role as { name: string; hash: string };
      }),
    );

    // Filter out roles with invalid hashes
    const validRoles = rolesWithHashes.filter((role) => role.hash !== "0x");

    const migrationComplete = await migrateContractRolesToGovernance(
      hre,
      migration.contractName,
      deployment.address,
      deployerSigner,
      governanceMultisig,
      executor,
      validRoles,
    );

    if (!migrationComplete) {
      allOperationsComplete = false;
    }
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Migrate AMO system roles to governance`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All role migrations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

export default func;
func.id = "03_migrate_roles_to_governance";
func.tags = ["amo-debt-system", "governance-migration"];
func.dependencies = [
  // Configuration must be complete before role migration
  "02_configure_amo_system",
];
