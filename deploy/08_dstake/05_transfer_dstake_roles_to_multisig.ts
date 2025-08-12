import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";

/**
 * Transfer all dSTAKE roles to the governance multisig / configured admins.
 *
 * This script is intentionally separated from 03_configure_dstake so that the
 * deployer retains the necessary permissions during configuration. It should
 * run afterwards (tags & dependencies ensure ordering) and migrate ownership
 * and admin / fee-manager roles to the addresses specified in the network
 * configuration.
 *
 * @param hre Hardhat runtime environment
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner: Signer = await ethers.getSigner(deployer);

  // Load network configuration
  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log("No dSTAKE instances configured – skipping role migration");
    return true;
  }

  for (const instanceKey of Object.keys(config.dStake)) {
    const instanceConfig = config.dStake[instanceKey];
    console.log(`\n🔄 Migrating roles for dSTAKE instance ${instanceKey}…`);

    const tokenId = `DStakeToken_${instanceKey}`;
    const vaultId = `DStakeCollateralVault_${instanceKey}`;
    const routerId = `DStakeRouter_${instanceKey}`;

    // --- DStakeToken roles ---
    try {
      const tokenDeployment = await deployments.getOrNull(tokenId);

      if (tokenDeployment) {
        console.log(`  📄 TOKEN ROLES: ${tokenId}`);
        const tokenContract = await ethers.getContractAt(
          "DStakeToken",
          tokenDeployment.address,
          deployerSigner,
        );

        const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
        const FEE_MANAGER_ROLE = await tokenContract.FEE_MANAGER_ROLE();

        // Grant roles to configured addresses
        if (
          !(await tokenContract.hasRole(
            DEFAULT_ADMIN_ROLE,
            instanceConfig.initialAdmin,
          ))
        ) {
          await tokenContract.grantRole(
            DEFAULT_ADMIN_ROLE,
            instanceConfig.initialAdmin,
          );
          console.log(
            `    ➕ Granted DEFAULT_ADMIN_ROLE to ${instanceConfig.initialAdmin}`,
          );
        }

        if (
          !(await tokenContract.hasRole(
            FEE_MANAGER_ROLE,
            instanceConfig.initialFeeManager,
          ))
        ) {
          await tokenContract.grantRole(
            FEE_MANAGER_ROLE,
            instanceConfig.initialFeeManager,
          );
          console.log(
            `    ➕ Granted FEE_MANAGER_ROLE to ${instanceConfig.initialFeeManager}`,
          );
        }

        // Revoke non-admin roles from deployer first
        if (await tokenContract.hasRole(FEE_MANAGER_ROLE, deployer)) {
          await tokenContract.revokeRole(FEE_MANAGER_ROLE, deployer);
          console.log(`    ➖ Revoked FEE_MANAGER_ROLE from deployer`);
        }

        // Revoke DEFAULT_ADMIN_ROLE last
        if (await tokenContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
          await tokenContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
          console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
        }
      } else {
        console.log(
          `  ⚠️ ${tokenId} not deployed, skipping token role transfer`,
        );
      }
    } catch (error) {
      console.error(`  ❌ Failed to migrate ${tokenId} roles: ${error}`);
    }

    // --- CollateralVault roles ---
    try {
      const vaultDeployment = await deployments.getOrNull(vaultId);

      if (vaultDeployment) {
        console.log(`  📄 VAULT ROLES: ${vaultId}`);
        const vaultContract = await ethers.getContractAt(
          "DStakeCollateralVault",
          vaultDeployment.address,
          deployerSigner,
        );

        const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;

        if (
          !(await vaultContract.hasRole(
            DEFAULT_ADMIN_ROLE,
            instanceConfig.initialAdmin,
          ))
        ) {
          await vaultContract.grantRole(
            DEFAULT_ADMIN_ROLE,
            instanceConfig.initialAdmin,
          );
          console.log(
            `    ➕ Granted DEFAULT_ADMIN_ROLE to ${instanceConfig.initialAdmin}`,
          );
        }

        // Revoke DEFAULT_ADMIN_ROLE from deployer
        if (await vaultContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
          await vaultContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
          console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
        }
      } else {
        console.log(
          `  ⚠️ ${vaultId} not deployed, skipping vault role transfer`,
        );
      }
    } catch (error) {
      console.error(`  ❌ Failed to migrate ${vaultId} roles: ${error}`);
    }

    // --- Router roles ---
    try {
      const routerDeployment = await deployments.getOrNull(routerId);

      if (routerDeployment) {
        console.log(`  📄 ROUTER ROLES: ${routerId}`);
        const routerContract = await ethers.getContractAt(
          "DStakeRouterDLend",
          routerDeployment.address,
          deployerSigner,
        );
        const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;

        if (
          !(await routerContract.hasRole(
            DEFAULT_ADMIN_ROLE,
            instanceConfig.initialAdmin,
          ))
        ) {
          await routerContract.grantRole(
            DEFAULT_ADMIN_ROLE,
            instanceConfig.initialAdmin,
          );
          console.log(
            `    ➕ Granted DEFAULT_ADMIN_ROLE to ${instanceConfig.initialAdmin}`,
          );
        }

        if (await routerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
          await routerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
          console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
        }
      } else {
        console.log(
          `  ⚠️ ${routerId} not deployed, skipping router role transfer`,
        );
      }
    } catch (error) {
      console.error(`  ❌ Failed to migrate ${routerId} roles: ${error}`);
    }

    console.log(`  ✅ Completed role migration for ${instanceKey}`);
  }

  console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: ✅ Done\n`);
  return true;
};

export default func;
func.tags = ["dStakeRoleTransfer", "postDStake"];
func.dependencies = ["dStakeConfigure"];
func.runAtTheEnd = true;

// Unique identifier so Hardhat Deploy knows this script has executed when it
// returns `true` (skip behaviour).
func.id = "transfer_dstake_roles_to_multisig";
