import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";
import { getConfig } from "../../config/config";
/**
 * Transfer Oracle roles to governance multisig
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  // Get the configuration from the network
  const config = await getConfig(hre);

  // Get the governance multisig address
  const { governanceMultisig } = config.walletAddresses;

  // Iterate over all oracle aggregators in the config
  const oracleAggregatorTypes = Object.keys(config.oracleAggregators);

  for (const oracleType of oracleAggregatorTypes) {
    console.log(`\nTransferring roles for ${oracleType} Oracle Aggregator...`);

    // The deployment ID follows the pattern: `${oracleType}_OracleAggregator`
    const oracleAggregatorId = `${oracleType}_OracleAggregator`;

    await transferOracleAggregatorRoles(
      hre,
      oracleAggregatorId,
      oracleType,
      deployerSigner,
      governanceMultisig,
      deployer
    );
  }

  console.log(`🔑 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

/**
 * Transfer Oracle Aggregator roles to governance multisig
 */
async function transferOracleAggregatorRoles(
  hre: HardhatRuntimeEnvironment,
  oracleAggregatorId: string,
  oracleType: string,
  deployerSigner: any,
  governanceMultisig: string,
  deployer: string
) {
  const { deployments, ethers } = hre;

  try {
    const oracleAggregatorDeployment =
      await deployments.getOrNull(oracleAggregatorId);
    if (oracleAggregatorDeployment) {
      console.log(
        `\nTransferring roles for ${oracleType} Oracle Aggregator...`
      );

      const oracleAggregator = await ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorDeployment.address,
        deployerSigner
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const ORACLE_MANAGER_ROLE = await oracleAggregator.ORACLE_MANAGER_ROLE();

      // Grant DEFAULT_ADMIN_ROLE to multisig
      if (
        !(await oracleAggregator.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig
        ))
      ) {
        await oracleAggregator.grantRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted DEFAULT_ADMIN_ROLE for ${oracleType} Oracle Aggregator to ${governanceMultisig}`
        );
      } else {
        console.log(
          `DEFAULT_ADMIN_ROLE for ${oracleType} Oracle Aggregator already granted to ${governanceMultisig}`
        );
      }

      // Grant ORACLE_MANAGER_ROLE to multisig
      if (
        !(await oracleAggregator.hasRole(
          ORACLE_MANAGER_ROLE,
          governanceMultisig
        ))
      ) {
        await oracleAggregator.grantRole(
          ORACLE_MANAGER_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted ORACLE_MANAGER_ROLE for ${oracleType} Oracle Aggregator to ${governanceMultisig}`
        );
      } else {
        console.log(
          `ORACLE_MANAGER_ROLE for ${oracleType} Oracle Aggregator already granted to ${governanceMultisig}`
        );
      }

      // Revoke ORACLE_MANAGER_ROLE from deployer first
      if (await oracleAggregator.hasRole(ORACLE_MANAGER_ROLE, deployer)) {
        await oracleAggregator.revokeRole(ORACLE_MANAGER_ROLE, deployer);
        console.log(
          `Revoked ORACLE_MANAGER_ROLE for ${oracleType} Oracle Aggregator from deployer`
        );
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await oracleAggregator.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await oracleAggregator.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(
          `Revoked DEFAULT_ADMIN_ROLE for ${oracleType} Oracle Aggregator from deployer`
        );
      }

      console.log(
        `Transferred ${oracleType} Oracle Aggregator roles to ${governanceMultisig}`
      );
    } else {
      console.log(
        `${oracleType} Oracle Aggregator not deployed, skipping role transfer`
      );
    }
  } catch (error) {
    console.error(
      `Failed to transfer ${oracleType} Oracle Aggregator roles: ${error}`
    );
  }
}

func.id = "transfer_oracle_roles_to_multisig";
func.tags = ["governance", "roles"];
func.dependencies = ["usd-oracle", "s-oracle"];

export default func;
