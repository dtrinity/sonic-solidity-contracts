import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  createGrantRoleTransaction,
  createRevokeRoleTransaction,
} from "../../scripts/safe/propose-governance-transaction";
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

const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Migrate roles to governance multisig (always idempotent)
 * Uses Safe SDK for governance operations when available.
 *
 * @param hre HardhatRuntimeEnvironment
 * @param redeemerAddress Address of the RedeemerV2 contract
 * @param deployerAddress Address of the deployer
 * @param governanceMultisig Address of the governance multisig
 * @param safeManager Optional Safe manager for governance operations
 * @param manualActions Array to collect manual actions if direct execution fails
 */
async function migrateRedeemerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  redeemerAddress: string,
  deployerAddress: string,
  governanceMultisig: string,
  safeManager?: SafeManager,
  manualActions?: string[],
): Promise<void> {
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

  for (const role of roles) {
    if (!(await redeemer.hasRole(role.hash, governanceMultisig))) {
      try {
        await redeemer.grantRole(role.hash, governanceMultisig);
        console.log(`    ➕ Granted ${role.name} to ${governanceMultisig}`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not grant ${role.name} to ${governanceMultisig}: ${(e as Error).message}`,
        );

        if (safeManager) {
          console.log(
            `    🔄 Creating Safe transaction for ${role.name} grant...`,
          );
          const transaction = createGrantRoleTransaction(
            redeemerAddress,
            role.hash,
            governanceMultisig,
            redeemer.interface,
          );
          const result = await safeManager.createTransaction(
            transaction,
            `Grant ${role.name} to governance on RedeemerV2`,
          );

          if (result.success) {
            if (result.requiresAdditionalSignatures) {
              console.log(
                `    📤 Safe transaction created, awaiting governance signatures`,
              );
            } else if (result.transactionHash) {
              console.log(
                `    ✅ Safe transaction executed: ${result.transactionHash}`,
              );
            }
          } else {
            console.log(`    ❌ Safe transaction failed: ${result.error}`);
            manualActions?.push(
              `RedeemerV2 (${redeemerAddress}).grantRole(${role.name}, ${governanceMultisig})`,
            );
          }
        } else {
          manualActions?.push(
            `RedeemerV2 (${redeemerAddress}).grantRole(${role.name}, ${governanceMultisig})`,
          );
        }
      }
    } else {
      console.log(
        `    ✓ ${role.name} already granted to ${governanceMultisig}`,
      );
    }
  }

  // Revoke roles from deployer to mirror realistic governance
  for (const role of [REDEMPTION_MANAGER_ROLE, PAUSER_ROLE]) {
    if (await redeemer.hasRole(role, deployerAddress)) {
      try {
        await redeemer.revokeRole(role, deployerAddress);
        console.log(`    ➖ Revoked ${role} from deployer`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not revoke ${role} from deployer: ${(e as Error).message}`,
        );
        const roleName =
          role === REDEMPTION_MANAGER_ROLE
            ? "REDEMPTION_MANAGER_ROLE"
            : "PAUSER_ROLE";

        if (safeManager) {
          console.log(
            `    🔄 Creating Safe transaction for ${roleName} revoke...`,
          );
          const transaction = createRevokeRoleTransaction(
            redeemerAddress,
            role,
            deployerAddress,
            redeemer.interface,
          );
          const result = await safeManager.createTransaction(
            transaction,
            `Revoke ${roleName} from deployer on RedeemerV2`,
          );

          if (result.success) {
            if (result.requiresAdditionalSignatures) {
              console.log(
                `    📤 Safe transaction created, awaiting governance signatures`,
              );
            } else if (result.transactionHash) {
              console.log(
                `    ✅ Safe transaction executed: ${result.transactionHash}`,
              );
            }
          } else {
            console.log(`    ❌ Safe transaction failed: ${result.error}`);
            manualActions?.push(
              `RedeemerV2 (${redeemerAddress}).revokeRole(${roleName}, ${deployerAddress})`,
            );
          }
        } else {
          manualActions?.push(
            `RedeemerV2 (${redeemerAddress}).revokeRole(${roleName}, ${deployerAddress})`,
          );
        }
      }
    }
  }
  // Safely migrate DEFAULT_ADMIN_ROLE away from deployer
  await ensureDefaultAdminExistsAndRevokeFrom(
    hre,
    "RedeemerV2",
    redeemerAddress,
    governanceMultisig,
    deployerAddress,
    await hre.ethers.getSigner(deployerAddress),
    manualActions,
  );
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const manualActions: string[] = [];

  // Initialize Safe Manager if Safe configuration is available
  let safeManager: SafeManager | undefined;

  if (config.safeConfig) {
    console.log(`🔐 Initializing Safe Manager for governance operations...`);

    try {
      safeManager = new SafeManager(hre, deployerSigner, {
        safeConfig: config.safeConfig,
        enableApiKit: true,
        enableTransactionService: true,
      });
      await safeManager.initialize();
      console.log(`✅ Safe Manager initialized successfully`);
    } catch (error) {
      console.warn(`⚠️ Failed to initialize Safe Manager:`, error);
      console.log(
        `🔄 Continuing without Safe Manager - will collect manual actions`,
      );
      safeManager = undefined;
    }
  } else {
    console.log(
      `ℹ️ No Safe configuration found - will collect manual actions for governance`,
    );
  }

  type Target = {
    symbol: "dUSD" | "dS";
    redeemerId: string;
    vaultId: string;
    oracleId: string;
  };

  const targets: Target[] = [
    {
      symbol: "dUSD",
      redeemerId: DUSD_REDEEMER_CONTRACT_ID,
      vaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      oracleId: USD_ORACLE_AGGREGATOR_ID,
    },
    {
      symbol: "dS",
      redeemerId: DS_REDEEMER_CONTRACT_ID,
      vaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      oracleId: S_ORACLE_AGGREGATOR_ID,
    },
  ];

  for (const t of targets) {
    console.log(`\n=== Deploy RedeemerV2 for ${t.symbol} ===`);

    const { address: oracle } = await deployments.get(t.oracleId);
    const { address: vault } = await deployments.get(t.vaultId);

    const tokenAddress = (config as any).tokenAddresses[t.symbol];
    const stableCfg = (config as any).dStables[t.symbol];
    const initialFeeReceiver = stableCfg?.initialFeeReceiver || deployer;
    const initialRedemptionFeeBps =
      stableCfg?.initialRedemptionFeeBps !== undefined
        ? stableCfg.initialRedemptionFeeBps
        : 0;

    const result = await deployments.deploy(`${t.redeemerId}V2`, {
      from: deployer,
      args: [
        vault,
        tokenAddress,
        oracle,
        initialFeeReceiver,
        initialRedemptionFeeBps,
      ],
      contract: "RedeemerV2",
      autoMine: true,
      log: false,
    });

    if (result.newlyDeployed) {
      console.log(`  ✅ Deployed ${t.redeemerId}V2 at ${result.address}`);
    } else {
      console.log(`  ✓ ${t.redeemerId}V2 already at ${result.address}`);
    }

    // Grant vault withdraw permission to new redeemer and revoke from old redeemer
    try {
      const vaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        vault,
        deployerSigner,
      );
      const WITHDRAWER_ROLE = await vaultContract.COLLATERAL_WITHDRAWER_ROLE();

      if (!(await vaultContract.hasRole(WITHDRAWER_ROLE, result.address))) {
        try {
          await vaultContract.grantRole(WITHDRAWER_ROLE, result.address);
          console.log(
            `    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to new redeemer ${result.address}`,
          );
        } catch (e) {
          console.log(
            `    ⚠️ Could not grant COLLATERAL_WITHDRAWER_ROLE to ${result.address}: ${(e as Error).message}`,
          );

          if (safeManager) {
            console.log(
              `    🔄 Creating Safe transaction for COLLATERAL_WITHDRAWER_ROLE grant...`,
            );
            const transaction = createGrantRoleTransaction(
              vault,
              WITHDRAWER_ROLE,
              result.address,
              vaultContract.interface,
            );
            const safeResult = await safeManager.createTransaction(
              transaction,
              `Grant COLLATERAL_WITHDRAWER_ROLE to new redeemer ${result.address}`,
            );

            if (!safeResult.success) {
              console.log(
                `    ❌ Safe transaction failed: ${safeResult.error}`,
              );
              manualActions.push(
                `CollateralHolderVault (${vault}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${result.address})`,
              );
            }
          } else {
            manualActions.push(
              `CollateralHolderVault (${vault}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${result.address})`,
            );
          }
        }
      }
      const oldRedeemerDeployment = await deployments.getOrNull(t.redeemerId);

      if (
        oldRedeemerDeployment &&
        (await vaultContract.hasRole(
          WITHDRAWER_ROLE,
          oldRedeemerDeployment.address,
        ))
      ) {
        try {
          await vaultContract.revokeRole(
            WITHDRAWER_ROLE,
            oldRedeemerDeployment.address,
          );
          console.log(
            `    ➖ Revoked COLLATERAL_WITHDRAWER_ROLE from old redeemer ${oldRedeemerDeployment.address}`,
          );
        } catch (e) {
          console.log(
            `    ⚠️ Could not revoke COLLATERAL_WITHDRAWER_ROLE from old redeemer: ${(e as Error).message}`,
          );

          if (safeManager) {
            console.log(
              `    🔄 Creating Safe transaction for COLLATERAL_WITHDRAWER_ROLE revoke...`,
            );
            const transaction = createRevokeRoleTransaction(
              vault,
              WITHDRAWER_ROLE,
              oldRedeemerDeployment.address,
              vaultContract.interface,
            );
            const safeResult = await safeManager.createTransaction(
              transaction,
              `Revoke COLLATERAL_WITHDRAWER_ROLE from old redeemer ${oldRedeemerDeployment.address}`,
            );

            if (!safeResult.success) {
              console.log(
                `    ❌ Safe transaction failed: ${safeResult.error}`,
              );
              manualActions.push(
                `CollateralHolderVault (${vault}).revokeRole(COLLATERAL_WITHDRAWER_ROLE, ${oldRedeemerDeployment.address})`,
              );
            }
          } else {
            manualActions.push(
              `CollateralHolderVault (${vault}).revokeRole(COLLATERAL_WITHDRAWER_ROLE, ${oldRedeemerDeployment.address})`,
            );
          }
        }
      }
    } catch (e) {
      console.log(
        `    ⚠️ Could not update vault withdrawer roles: ${(e as Error).message}`,
      );

      if (safeManager) {
        console.log(
          `    🔄 Creating Safe transaction for vault withdrawer role grant (fallback)...`,
        );
        const vaultContract = await hre.ethers.getContractAt(
          "CollateralHolderVault",
          vault,
        );
        const WITHDRAWER_ROLE =
          await vaultContract.COLLATERAL_WITHDRAWER_ROLE();
        const transaction = createGrantRoleTransaction(
          vault,
          WITHDRAWER_ROLE,
          result.address,
          vaultContract.interface,
        );
        const safeResult = await safeManager.createTransaction(
          transaction,
          `Grant COLLATERAL_WITHDRAWER_ROLE to new redeemer ${result.address} (fallback)`,
        );

        if (!safeResult.success) {
          console.log(`    ❌ Safe transaction failed: ${safeResult.error}`);
          manualActions.push(
            `CollateralHolderVault (${vault}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${result.address})`,
          );
        }
      } else {
        manualActions.push(
          `CollateralHolderVault (${vault}).grantRole(COLLATERAL_WITHDRAWER_ROLE, ${result.address})`,
        );
      }
    }

    // Post-deploy configuration no longer needed for fee receiver and default fee,
    // as they are provided via constructor.

    // Note: We intentionally do not modify roles on the legacy Redeemer contract to avoid unnecessary gas.

    // Migrate roles to governance multisig (idempotent)
    await migrateRedeemerRolesIdempotent(
      hre,
      result.address,
      deployer,
      config.walletAddresses.governanceMultisig,
      safeManager,
      manualActions,
    );
  }

  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize RedeemerV2 setup:");
    manualActions.forEach((a: string) => console.log(`   - ${a}`));

    if (safeManager) {
      console.log(
        "\n💡 Safe transactions have been created for governance operations.",
      );
      console.log(
        "   Check the Safe Transaction Service or deployment artifacts for pending transactions.",
      );
    }
  } else if (safeManager) {
    console.log(
      "\n✅ All operations completed successfully via Safe transactions.",
    );
  } else {
    console.log("\n✅ All operations completed successfully.");
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "2_setup_redeemerv2";
func.tags = ["setup-issuerv2", "setup-redeemerv2"];
func.dependencies = [
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
];

export default func;
