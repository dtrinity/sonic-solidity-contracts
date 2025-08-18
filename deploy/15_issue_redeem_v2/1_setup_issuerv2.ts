import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  createGrantMinterRoleTransaction,
  createGrantRoleTransaction,
  createRevokeRoleTransaction,
  createSetAssetMintingPauseTransaction,
} from "../../scripts/safe/propose-governance-transaction";
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

const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Ensure the given `grantee` holds MINTER_ROLE on the specified dStable token.
 * Uses Safe SDK for governance operations when available.
 *
 * @param hre Hardhat runtime environment
 * @param stableAddress Address of the ERC20StablecoinUpgradeable token
 * @param grantee Address that should be granted MINTER_ROLE
 * @param safeManager Optional Safe manager for governance operations
 * @param manualActions Array to collect manual actions if direct execution fails
 */
async function ensureMinterRole(
  hre: HardhatRuntimeEnvironment,
  stableAddress: string,
  grantee: string,
  safeManager?: SafeManager,
  manualActions?: string[],
): Promise<void> {
  const stable = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    stableAddress,
  );
  const MINTER_ROLE = await stable.MINTER_ROLE();

  if (!(await stable.hasRole(MINTER_ROLE, grantee))) {
    try {
      await stable.grantRole(MINTER_ROLE, grantee);
      console.log(`    ➕ Granted MINTER_ROLE to ${grantee}`);
    } catch (e) {
      console.log(
        `    ⚠️ Could not grant MINTER_ROLE to ${grantee}: ${(e as Error).message}`,
      );

      if (safeManager) {
        console.log(
          `    🔄 Creating Safe transaction for MINTER_ROLE grant...`,
        );
        const transaction = createGrantMinterRoleTransaction(
          stableAddress,
          grantee,
          stable.interface,
        );
        const result = await safeManager.createTransaction(
          transaction,
          `Grant MINTER_ROLE to ${grantee} on ${stableAddress}`,
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
            `ERC20StablecoinUpgradeable (${stableAddress}).grantRole(MINTER_ROLE, ${grantee})`,
          );
        }
      } else {
        manualActions?.push(
          `ERC20StablecoinUpgradeable (${stableAddress}).grantRole(MINTER_ROLE, ${grantee})`,
        );
      }
    }
  } else {
    console.log(`    ✓ MINTER_ROLE already granted to ${grantee}`);
  }
}

/**
 * Migrate IssuerV2 roles to governance in a safe, idempotent sequence.
 * Grants roles to governance first, then revokes them from the deployer.
 * Uses Safe SDK for governance operations when available.
 *
 * @param hre Hardhat runtime environment
 * @param issuerName Logical name/id of the issuer deployment
 * @param issuerAddress Address of the IssuerV2 contract
 * @param deployerSigner Deployer signer currently holding roles
 * @param governanceMultisig Governance multisig address to receive roles
 * @param safeManager Optional Safe manager for governance operations
 * @param manualActions Array to collect manual actions if direct execution fails
 */
async function migrateIssuerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  issuerName: string,
  issuerAddress: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  safeManager?: SafeManager,
  manualActions?: string[],
): Promise<void> {
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

  for (const role of roles) {
    if (!(await issuer.hasRole(role.hash, governanceMultisig))) {
      try {
        await issuer.grantRole(role.hash, governanceMultisig);
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
            issuerAddress,
            role.hash,
            governanceMultisig,
            issuer.interface,
          );
          const result = await safeManager.createTransaction(
            transaction,
            `Grant ${role.name} to governance on ${issuerName}`,
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
              `${issuerName} (${issuerAddress}).grantRole(${role.name}, ${governanceMultisig})`,
            );
          }
        } else {
          manualActions?.push(
            `${issuerName} (${issuerAddress}).grantRole(${role.name}, ${governanceMultisig})`,
          );
        }
      }
    } else {
      console.log(
        `    ✓ ${role.name} already granted to ${governanceMultisig}`,
      );
    }
  }

  // After ensuring governance has roles, revoke from deployer in a safe order
  const deployerAddress = await deployerSigner.getAddress();

  // Revoke roles from deployer to mirror realistic mainnet governance where deployer is not the governor
  for (const role of [AMO_MANAGER_ROLE, INCENTIVES_MANAGER_ROLE, PAUSER_ROLE]) {
    if (await issuer.hasRole(role, deployerAddress)) {
      try {
        await issuer.revokeRole(role, deployerAddress);
        console.log(`    ➖ Revoked ${role} from deployer`);
      } catch (e) {
        console.log(
          `    ⚠️ Could not revoke role ${role} from deployer: ${(e as Error).message}`,
        );
        const roleName =
          role === AMO_MANAGER_ROLE
            ? "AMO_MANAGER_ROLE"
            : role === INCENTIVES_MANAGER_ROLE
              ? "INCENTIVES_MANAGER_ROLE"
              : "PAUSER_ROLE";

        if (safeManager) {
          console.log(
            `    🔄 Creating Safe transaction for ${roleName} revoke...`,
          );
          const transaction = createRevokeRoleTransaction(
            issuerAddress,
            role,
            deployerAddress,
            issuer.interface,
          );
          const result = await safeManager.createTransaction(
            transaction,
            `Revoke ${roleName} from deployer on ${issuerName}`,
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
              `${issuerName} (${issuerAddress}).revokeRole(${roleName}, ${deployerAddress})`,
            );
          }
        } else {
          manualActions?.push(
            `${issuerName} (${issuerAddress}).revokeRole(${roleName}, ${deployerAddress})`,
          );
        }
      }
    }
  }
  // Safely migrate DEFAULT_ADMIN_ROLE away from deployer
  await ensureDefaultAdminExistsAndRevokeFrom(
    hre,
    "IssuerV2",
    issuerAddress,
    governanceMultisig,
    deployerAddress,
    deployerSigner,
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

  // Upgrade flow for each dStable: deploy IssuerV2, grant minter role, migrate roles idempotently
  type UpgradeTarget = {
    symbol: "dUSD" | "dS";
    oldId: string;
    newId: string;
    tokenId: string;
    vaultId: string;
    amoId: string;
    oracleId: string;
  };

  const targets: UpgradeTarget[] = [
    {
      symbol: "dUSD",
      oldId: DUSD_ISSUER_CONTRACT_ID,
      newId: DUSD_ISSUER_V2_CONTRACT_ID,
      tokenId: DUSD_TOKEN_ID,
      vaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      amoId: DUSD_AMO_MANAGER_ID,
      oracleId: USD_ORACLE_AGGREGATOR_ID,
    },
    {
      symbol: "dS",
      oldId: DS_ISSUER_CONTRACT_ID,
      newId: DS_ISSUER_V2_CONTRACT_ID,
      tokenId: DS_TOKEN_ID,
      vaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      amoId: DS_AMO_MANAGER_ID,
      oracleId: S_ORACLE_AGGREGATOR_ID,
    },
  ];

  for (const t of targets) {
    console.log(`\n=== Upgrading Issuer for ${t.symbol} ===`);

    const oldDeployment = await deployments.getOrNull(t.oldId);

    if (!oldDeployment) {
      console.log(
        `  ⚠️ Old issuer ${t.oldId} not found. Skipping ${t.symbol}.`,
      );
      continue;
    }

    // Resolve dependency addresses
    const { address: oracleAggregatorAddress } = await deployments.get(
      t.oracleId,
    );
    const { address: collateralVaultAddress } = await deployments.get(
      t.vaultId,
    );
    const { address: amoManagerAddress } = await deployments.get(t.amoId);
    const tokenAddress = (config as any).tokenAddresses[t.symbol];

    // Deploy new IssuerV2 if not already deployed
    const result = await deployments.deploy(t.newId, {
      from: deployer,
      args: [
        collateralVaultAddress,
        tokenAddress,
        oracleAggregatorAddress,
        amoManagerAddress,
      ],
      contract: "IssuerV2",
      autoMine: true,
      log: false,
    });

    if (result.newlyDeployed) {
      console.log(`  ✅ Deployed ${t.newId} at ${result.address}`);
    } else {
      console.log(`  ✓ ${t.newId} already deployed at ${result.address}`);
    }

    const newIssuerAddress = result.address;

    // Preemptively disable minting for wstkscUSD on this issuer BEFORE granting MINTER_ROLE
    // Do this only if the asset exists in config and is supported by the vault
    try {
      const wstkscUSDAddress = (config as any).tokenAddresses.wstkscUSD as
        | string
        | undefined;

      if (wstkscUSDAddress && wstkscUSDAddress !== "") {
        const vaultContract = await hre.ethers.getContractAt(
          "CollateralHolderVault",
          collateralVaultAddress,
        );

        if (await vaultContract.isCollateralSupported(wstkscUSDAddress)) {
          const issuer = await hre.ethers.getContractAt(
            "IssuerV2",
            newIssuerAddress,
            deployerSigner,
          );
          const isEnabled: boolean =
            await issuer.isAssetMintingEnabled(wstkscUSDAddress);

          if (isEnabled) {
            try {
              await issuer.setAssetMintingPause(wstkscUSDAddress, true);
              console.log(
                `    ⛔ Disabled minting for wstkscUSD on issuer ${newIssuerAddress}`,
              );
            } catch (e) {
              console.log(
                `    ⚠️ Could not disable minting for wstkscUSD: ${(e as Error).message}`,
              );

              if (safeManager) {
                console.log(
                  `    🔄 Creating Safe transaction for wstkscUSD minting pause...`,
                );
                const transaction = createSetAssetMintingPauseTransaction(
                  newIssuerAddress,
                  wstkscUSDAddress,
                  true,
                  issuer.interface,
                );
                const result = await safeManager.createTransaction(
                  transaction,
                  `Disable wstkscUSD minting on ${newIssuerAddress}`,
                );

                if (!result.success) {
                  console.log(
                    `    ❌ Safe transaction failed: ${result.error}`,
                  );
                  manualActions.push(
                    `IssuerV2 (${newIssuerAddress}).setAssetMintingPause(${wstkscUSDAddress}, true)`,
                  );
                }
              } else {
                manualActions.push(
                  `IssuerV2 (${newIssuerAddress}).setAssetMintingPause(${wstkscUSDAddress}, true)`,
                );
              }
            }
          } else {
            console.log(
              `    ✓ Minting for wstkscUSD already disabled on issuer ${newIssuerAddress}`,
            );
          }
        } else {
          console.log(
            `    ℹ️ wstkscUSD not supported by collateral vault ${collateralVaultAddress}; skipping issuer-level pause`,
          );
        }
      } else {
        console.log(
          "    ℹ️ wstkscUSD address not present in config.tokenAddresses; skipping issuer-level pause",
        );
      }
    } catch (e) {
      console.log(
        `    ⚠️ Could not pre-disable wstkscUSD minting: ${(e as Error).message}`,
      );
      // As a best-effort, add manual action to disable if applicable
      // (We cannot know collateral support here without the successful call.)
    }

    // Grant MINTER_ROLE on the token to the new issuer (idempotent)
    await ensureMinterRole(
      hre,
      tokenAddress,
      newIssuerAddress,
      safeManager,
      manualActions,
    );

    // Revoke MINTER_ROLE from the old issuer, but only after the new issuer has it
    try {
      const stable = await hre.ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        tokenAddress,
      );
      const MINTER_ROLE = await stable.MINTER_ROLE();

      if (
        oldDeployment.address.toLowerCase() !==
          newIssuerAddress.toLowerCase() &&
        (await stable.hasRole(MINTER_ROLE, oldDeployment.address))
      ) {
        try {
          await stable.revokeRole(MINTER_ROLE, oldDeployment.address);
          console.log(
            `    ➖ Revoked MINTER_ROLE from old issuer ${oldDeployment.address}`,
          );
        } catch (e) {
          console.log(
            `    ⚠️ Could not revoke MINTER_ROLE from old issuer: ${(e as Error).message}`,
          );

          if (safeManager) {
            console.log(
              `    🔄 Creating Safe transaction for old issuer MINTER_ROLE revoke...`,
            );
            const transaction = createRevokeRoleTransaction(
              tokenAddress,
              MINTER_ROLE,
              oldDeployment.address,
              stable.interface,
            );
            const result = await safeManager.createTransaction(
              transaction,
              `Revoke MINTER_ROLE from old issuer ${oldDeployment.address}`,
            );

            if (!result.success) {
              console.log(`    ❌ Safe transaction failed: ${result.error}`);
              manualActions.push(
                `ERC20StablecoinUpgradeable (${tokenAddress}).revokeRole(MINTER_ROLE, ${oldDeployment.address})`,
              );
            }
          } else {
            manualActions.push(
              `ERC20StablecoinUpgradeable (${tokenAddress}).revokeRole(MINTER_ROLE, ${oldDeployment.address})`,
            );
          }
        }
      } else {
        console.log(
          `    ✓ Old issuer ${oldDeployment.address} does not have MINTER_ROLE or equals new issuer`,
        );
      }
    } catch (e) {
      console.log(
        `    ⚠️ Could not check/revoke MINTER_ROLE on old issuer: ${(e as Error).message}`,
      );

      if (safeManager && oldDeployment) {
        console.log(
          `    🔄 Creating Safe transaction for old issuer MINTER_ROLE revoke (fallback)...`,
        );
        const stable = await hre.ethers.getContractAt(
          "ERC20StablecoinUpgradeable",
          tokenAddress,
        );
        const MINTER_ROLE = await stable.MINTER_ROLE();
        const transaction = createRevokeRoleTransaction(
          tokenAddress,
          MINTER_ROLE,
          oldDeployment.address,
          stable.interface,
        );
        const result = await safeManager.createTransaction(
          transaction,
          `Revoke MINTER_ROLE from old issuer ${oldDeployment.address} (fallback)`,
        );

        if (!result.success) {
          console.log(`    ❌ Safe transaction failed: ${result.error}`);
          manualActions.push(
            `ERC20StablecoinUpgradeable (${tokenAddress}).revokeRole(MINTER_ROLE, ${oldDeployment.address})`,
          );
        }
      } else {
        manualActions.push(
          `ERC20StablecoinUpgradeable (${tokenAddress}).revokeRole(MINTER_ROLE, ${oldDeployment?.address || "OLD_ISSUER_ADDRESS"})`,
        );
      }
    }

    // Migrate roles to governance multisig (always idempotent)
    await migrateIssuerRolesIdempotent(
      hre,
      t.newId,
      newIssuerAddress,
      deployerSigner,
      config.walletAddresses.governanceMultisig,
      safeManager,
      manualActions,
    );

    // Optional: keep old issuer operational until governance flips references
    console.log(
      `  ℹ️ New issuer ${t.newId} deployed and permissioned. Ensure dApp/services reference ${newIssuerAddress}.`,
    );
  }

  // Print manual actions, if any
  if (manualActions.length > 0) {
    console.log("\n⚠️  Manual actions required to finalize IssuerV2 setup:");
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
];

export default func;
