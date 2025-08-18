import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { createRevokeRoleTransaction } from "../../scripts/safe/propose-governance-transaction";
import { SafeManager } from "../../typescript/safe/SafeManager";

/**
 * Test deployment script to demonstrate Safe SDK functionality by revoking
 * specific roles from the governance Safe wallet itself.
 *
 * This script is MAINNET ONLY and will test the Safe integration by creating
 * transactions to revoke the following roles from governance:
 *
 * - USD_OracleAggregator: ORACLE_MANAGER_ROLE
 * - USD_RedstoneChainlinkCompositeWrapperWithThresholding: ORACLE_MANAGER_ROLE
 * - USD_RedstoneChainlinkWrapperWithThresholding: ORACLE_MANAGER_ROLE
 * - dS_RedeemerWithFees: DEFAULT_ADMIN_ROLE, REDEMPTION_MANAGER_ROLE
 * - dUSD_RedeemerWithFees: REDEMPTION_MANAGER_ROLE
 */

const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const ORACLE_MANAGER_ROLE =
  "0xced6982f480260bdd8ad5cb18ff2854f0306d78d904ad6cc107e8f3a0f526c18";

const REDEMPTION_MANAGER_ROLE =
  "0xe5bea7d829f723a95a0c83a655765be37702fa584514c1e2a20867d04b58478e";

interface RoleRevocation {
  contractAddress: string;
  contractName: string;
  roles: Array<{
    name: string;
    hash: string;
  }>;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // This script is mainnet only
  if (hre.network.name !== "sonic_mainnet") {
    console.log(
      `⏭️ Skipping Safe test script - mainnet only (current: ${hre.network.name})`,
    );
    return true;
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);
  console.log(`🧪 Testing Safe SDK by revoking roles from governance`);

  // Initialize Safe Manager
  if (!config.safeConfig) {
    console.log(`❌ Safe configuration not found. Cannot proceed with test.`);
    return false;
  }

  console.log(`🔐 Initializing Safe Manager for test operations...`);

  let safeManager: SafeManager;

  try {
    safeManager = new SafeManager(hre, deployerSigner, {
      safeConfig: config.safeConfig,
      enableApiKit: true,
      enableTransactionService: true,
    });
    await safeManager.initialize();
    console.log(`✅ Safe Manager initialized successfully`);
  } catch (error) {
    console.error(`❌ Failed to initialize Safe Manager:`, error);
    return false;
  }

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Define the roles to revoke
  const revocations: RoleRevocation[] = [
    {
      contractAddress: "0x1295A55D482257eCD66ba8846EAb6849712C3a9c",
      contractName: "USD_OracleAggregator",
      roles: [{ name: "ORACLE_MANAGER_ROLE", hash: ORACLE_MANAGER_ROLE }],
    },
    {
      contractAddress: "0xDb62aA99B4a07722c97ac6973986Dabc9083b343",
      contractName: "USD_RedstoneChainlinkCompositeWrapperWithThresholding",
      roles: [{ name: "ORACLE_MANAGER_ROLE", hash: ORACLE_MANAGER_ROLE }],
    },
    {
      contractAddress: "0x5cbdcCF46f7F0fbf5fD64590bAE11813EdFaE74e",
      contractName: "USD_RedstoneChainlinkWrapperWithThresholding",
      roles: [{ name: "ORACLE_MANAGER_ROLE", hash: ORACLE_MANAGER_ROLE }],
    },
    {
      contractAddress: "0x528872c03319FD5130e0a506372B6cEA666C4927",
      contractName: "dS_RedeemerWithFees",
      roles: [
        { name: "DEFAULT_ADMIN_ROLE", hash: ZERO_BYTES_32 },
        { name: "REDEMPTION_MANAGER_ROLE", hash: REDEMPTION_MANAGER_ROLE },
      ],
    },
    {
      contractAddress: "0x1f5d6E62E1BA39264B9A66E544065b0e45c2B221",
      contractName: "dUSD_RedeemerWithFees",
      roles: [
        { name: "REDEMPTION_MANAGER_ROLE", hash: REDEMPTION_MANAGER_ROLE },
      ],
    },
  ];

  let allOperationsComplete = true;
  const transactions = [];

  for (const revocation of revocations) {
    console.log(
      `\n📄 Processing ${revocation.contractName} at ${revocation.contractAddress}`,
    );

    // Get contract interface - we'll use a generic AccessControl interface
    const contract = await hre.ethers.getContractAt(
      "IAccessControl",
      revocation.contractAddress,
    );

    for (const role of revocation.roles) {
      console.log(`  🔐 Checking ${role.name}...`);

      // Check if governance has the role
      const hasRole = await contract.hasRole(role.hash, governanceMultisig);

      if (hasRole) {
        console.log(
          `    ✓ Governance has ${role.name}, creating revocation transaction...`,
        );

        // Create the revocation transaction
        const transaction = createRevokeRoleTransaction(
          revocation.contractAddress,
          role.hash,
          governanceMultisig,
          contract.interface,
        );

        transactions.push({
          ...transaction,
          description: `Revoke ${role.name} from governance on ${revocation.contractName}`,
        });
      } else {
        console.log(`    ⏭️ Governance doesn't have ${role.name}, skipping`);
      }
    }
  }

  if (transactions.length === 0) {
    console.log(
      `\n✅ No roles to revoke - governance doesn't hold any of the specified roles`,
    );
    return true;
  }

  console.log(
    `\n📦 Creating batch Safe transaction for ${transactions.length} role revocations...`,
  );

  try {
    // Create batch transaction
    const batchResult = await safeManager.createBatchTransaction({
      transactions: transactions.map((t) => ({
        to: t.to,
        value: t.value,
        data: t.data,
      })),
      description: `Test: Revoke ${transactions.length} roles from governance`,
    });

    if (!batchResult.success) {
      console.error(
        `❌ Failed to create Safe transaction: ${batchResult.error}`,
      );
      return false;
    }

    if (batchResult.requiresAdditionalSignatures) {
      console.log(`\n📤 Safe transaction created successfully!`);
      console.log(
        `   Awaiting additional signatures from governance multisig owners`,
      );
      console.log(`\n⏳ Test transaction pending governance execution`);
      allOperationsComplete = false;
    } else if (batchResult.transactionHash) {
      console.log(
        `\n✅ Safe transaction executed immediately: ${batchResult.transactionHash}`,
      );
    }
  } catch (error) {
    console.error(`❌ Error creating Safe transaction:`, error);
    return false;
  }

  if (!allOperationsComplete) {
    console.log(
      `\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`,
    );
    console.log(
      `   The test transaction has been created and awaits governance signatures.`,
    );
    console.log(
      `   This script can be re-run to check if the transaction has been executed.`,
    );
    return false; // Fail idempotently
  }

  console.log(`\n✅ Test completed successfully - all roles revoked`);
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "01_test_revoke_roles_from_governance";
func.tags = ["test-safe-revoke-roles"];
func.dependencies = []; // No dependencies - this is a test script

export default func;
