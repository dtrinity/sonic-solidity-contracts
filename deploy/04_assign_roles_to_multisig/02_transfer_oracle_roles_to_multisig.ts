import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";
import { isMainnet } from "../../typescript/hardhat/deploy";

/**
 * Transfer oracle roles to governance multisig
 *
 * @param hre The Hardhat Runtime Environment for deployment
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (!isMainnet(hre.network.name)) {
    console.log(
      `\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping non-mainnet network`,
    );
    return true;
  }

  const { getNamedAccounts, ethers } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  // Get the configuration from the network
  const config = await getConfig(hre);

  // Get the governance multisig address
  const { governanceMultisig } = config.walletAddresses;

  // Transfer roles for USD oracle aggregator
  await transferOracleAggregatorRoles(
    hre,
    USD_ORACLE_AGGREGATOR_ID,
    "USD",
    deployerSigner,
    governanceMultisig,
    deployer,
  );

  // Transfer roles for S oracle aggregator
  await transferOracleAggregatorRoles(
    hre,
    S_ORACLE_AGGREGATOR_ID,
    "S",
    deployerSigner,
    governanceMultisig,
    deployer,
  );

  console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: ✅ Done\n`);

  return true;
};

/**
 * Transfer roles from deployer to governance multisig for the oracle aggregator contract
 *
 * @param hre The Hardhat Runtime Environment for deployment
 * @param oracleAggregatorId The ID of the oracle aggregator contract to transfer roles for
 * @param oracleType The type of oracle (USD or S) being configured
 * @param deployerSigner The signer instance for the deployer account
 * @param governanceMultisig The address of the governance multisig to transfer roles to
 * @param deployer The address of the deployer account to transfer roles from
 * @returns Promise that resolves to true when all roles are transferred
 */
async function transferOracleAggregatorRoles(
  hre: HardhatRuntimeEnvironment,
  oracleAggregatorId: string,
  oracleType: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  deployer: string,
): Promise<boolean> {
  const { deployments, ethers } = hre;

  try {
    const oracleAggregatorDeployment =
      await deployments.get(oracleAggregatorId);

    if (oracleAggregatorDeployment) {
      console.log(
        `\n  📄 ORACLE AGGREGATOR ROLES: ${oracleType} Oracle Aggregator`,
      );

      const oracleAggregator = await ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorDeployment.address,
        deployerSigner,
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const ORACLE_MANAGER_ROLE = await oracleAggregator.ORACLE_MANAGER_ROLE();

      // Grant DEFAULT_ADMIN_ROLE to multisig
      if (
        !(await oracleAggregator.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig,
        ))
      ) {
        await oracleAggregator.grantRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted DEFAULT_ADMIN_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ DEFAULT_ADMIN_ROLE already granted to ${governanceMultisig}`,
        );
      }

      // Grant ORACLE_MANAGER_ROLE to multisig
      if (
        !(await oracleAggregator.hasRole(
          ORACLE_MANAGER_ROLE,
          governanceMultisig,
        ))
      ) {
        await oracleAggregator.grantRole(
          ORACLE_MANAGER_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted ORACLE_MANAGER_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ ORACLE_MANAGER_ROLE already granted to ${governanceMultisig}`,
        );
      }

      // Revoke ORACLE_MANAGER_ROLE from deployer first
      if (await oracleAggregator.hasRole(ORACLE_MANAGER_ROLE, deployer)) {
        await oracleAggregator.revokeRole(ORACLE_MANAGER_ROLE, deployer);
        console.log(`    ➖ Revoked ORACLE_MANAGER_ROLE from deployer`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await oracleAggregator.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await oracleAggregator.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
      }

      console.log(`    ✅ Completed Oracle Aggregator role transfers`);
    } else {
      console.log(
        `  ⚠️ ${oracleType} Oracle Aggregator not deployed, skipping role transfer`,
      );
    }
  } catch (error) {
    console.error(
      `  ❌ Failed to transfer ${oracleType} Oracle Aggregator roles: ${error}`,
    );
  }

  return true;
}

func.id = "transfer_oracle_roles_to_multisig";
func.tags = ["governance", "roles"];
func.dependencies = ["usd-oracle", "s-oracle"];

export default func;
