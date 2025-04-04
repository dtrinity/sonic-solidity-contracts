import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";
import { isMainnet } from "../../typescript/hardhat/deploy";

/**
 * Transfer dStable roles to governance multisig
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

  // Iterate over all dStables in the config
  const dStableNames = Object.keys(config.dStables);

  for (const dStableName of dStableNames) {
    console.log(`\n🔄 Transferring roles for ${dStableName}...`);

    // Get token IDs based on the dStable name
    const tokenId = dStableName; // The token ID is the same as the dStable name (e.g., "dUSD" or "dS")
    const issuerContractId = `${dStableName}_Issuer`;
    const redeemerContractId = `${dStableName}_Redeemer`;
    const collateralVaultContractId = `${dStableName}_CollateralHolderVault`;
    const amoManagerId = `${dStableName}_AmoManager`;

    // Transfer token roles
    await transferTokenRoles(
      hre,
      tokenId,
      deployerSigner,
      governanceMultisig,
      deployer,
    );

    // Transfer Issuer roles
    await transferIssuerRoles(
      hre,
      issuerContractId,
      deployerSigner,
      governanceMultisig,
      deployer,
    );

    // Transfer Redeemer roles
    await transferRedeemerRoles(
      hre,
      redeemerContractId,
      deployerSigner,
      governanceMultisig,
      deployer,
    );

    // Transfer AmoManager roles
    await transferAmoManagerRoles(
      hre,
      amoManagerId,
      deployerSigner,
      governanceMultisig,
      deployer,
    );

    // Transfer CollateralVault roles
    await transferCollateralVaultRoles(
      hre,
      collateralVaultContractId,
      deployerSigner,
      governanceMultisig,
      deployer,
    );

    console.log(`✅ Completed ${dStableName} role transfers`);
  }

  console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: ✅ Done\n`);

  return true;
};

/**
 * Transfer roles from deployer to governance multisig
 *
 * @param hre Hardhat Runtime Environment
 * @param tokenId The ID of the token contract
 * @param deployerSigner The signer for the deployer account
 * @param governanceMultisig The address of the governance multisig
 * @param deployer The address of the deployer account
 * @returns Promise that resolves to true when all roles are transferred
 */
async function transferTokenRoles(
  hre: HardhatRuntimeEnvironment,
  tokenId: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  deployer: string,
): Promise<boolean> {
  const { deployments, ethers } = hre;

  try {
    const tokenDeployment = await deployments.getOrNull(tokenId);

    if (tokenDeployment) {
      console.log(`\n  📄 TOKEN ROLES: ${tokenId}`);

      const tokenContract = await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        tokenDeployment.address,
        deployerSigner,
      );

      // Get current admin role
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const PAUSER_ROLE = await tokenContract.PAUSER_ROLE();

      // Grant roles to multisig (if not already granted)
      if (
        !(await tokenContract.hasRole(DEFAULT_ADMIN_ROLE, governanceMultisig))
      ) {
        await tokenContract.grantRole(DEFAULT_ADMIN_ROLE, governanceMultisig);
        console.log(
          `    ➕ Granted DEFAULT_ADMIN_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ DEFAULT_ADMIN_ROLE already granted to ${governanceMultisig}`,
        );
      }

      if (!(await tokenContract.hasRole(PAUSER_ROLE, governanceMultisig))) {
        await tokenContract.grantRole(PAUSER_ROLE, governanceMultisig);
        console.log(`    ➕ Granted PAUSER_ROLE to ${governanceMultisig}`);
      } else {
        console.log(
          `    ✓ PAUSER_ROLE already granted to ${governanceMultisig}`,
        );
      }

      // Note: we don't grant MINTER_ROLE directly as it's managed by issuer

      // Revoke non-admin roles from deployer first
      if (await tokenContract.hasRole(PAUSER_ROLE, deployer)) {
        await tokenContract.revokeRole(PAUSER_ROLE, deployer);
        console.log(`    ➖ Revoked PAUSER_ROLE from deployer`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await tokenContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await tokenContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
      }
    } else {
      console.log(`  ⚠️ ${tokenId} token not deployed, skipping role transfer`);
    }
  } catch (error) {
    console.error(`  ❌ Failed to transfer ${tokenId} token roles: ${error}`);
  }

  return true;
}

/**
 * Transfer roles from deployer to governance multisig for the issuer contract
 *
 * @param hre Hardhat Runtime Environment
 * @param issuerContractId The ID of the issuer contract
 * @param deployerSigner The signer for the deployer account
 * @param governanceMultisig The address of the governance multisig
 * @param deployer The address of the deployer account
 * @returns Promise that resolves to true when all roles are transferred
 */
async function transferIssuerRoles(
  hre: HardhatRuntimeEnvironment,
  issuerContractId: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  deployer: string,
): Promise<boolean> {
  const { deployments, ethers } = hre;

  try {
    const issuerDeployment = await deployments.getOrNull(issuerContractId);

    if (issuerDeployment) {
      console.log(`\n  📄 ISSUER ROLES: ${issuerContractId}`);

      const issuerContract = await ethers.getContractAt(
        "Issuer",
        issuerDeployment.address,
        deployerSigner,
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const AMO_MANAGER_ROLE = await issuerContract.AMO_MANAGER_ROLE();
      const INCENTIVES_MANAGER_ROLE =
        await issuerContract.INCENTIVES_MANAGER_ROLE();

      // Grant roles to multisig
      if (
        !(await issuerContract.hasRole(DEFAULT_ADMIN_ROLE, governanceMultisig))
      ) {
        await issuerContract.grantRole(DEFAULT_ADMIN_ROLE, governanceMultisig);
        console.log(
          `    ➕ Granted DEFAULT_ADMIN_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ DEFAULT_ADMIN_ROLE already granted to ${governanceMultisig}`,
        );
      }

      if (
        !(await issuerContract.hasRole(AMO_MANAGER_ROLE, governanceMultisig))
      ) {
        await issuerContract.grantRole(AMO_MANAGER_ROLE, governanceMultisig);
        console.log(`    ➕ Granted AMO_MANAGER_ROLE to ${governanceMultisig}`);
      } else {
        console.log(
          `    ✓ AMO_MANAGER_ROLE already granted to ${governanceMultisig}`,
        );
      }

      if (
        !(await issuerContract.hasRole(
          INCENTIVES_MANAGER_ROLE,
          governanceMultisig,
        ))
      ) {
        await issuerContract.grantRole(
          INCENTIVES_MANAGER_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted INCENTIVES_MANAGER_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ INCENTIVES_MANAGER_ROLE already granted to ${governanceMultisig}`,
        );
      }

      // Revoke non-admin roles from deployer first
      if (await issuerContract.hasRole(AMO_MANAGER_ROLE, deployer)) {
        await issuerContract.revokeRole(AMO_MANAGER_ROLE, deployer);
        console.log(`    ➖ Revoked AMO_MANAGER_ROLE from deployer`);
      }

      if (await issuerContract.hasRole(INCENTIVES_MANAGER_ROLE, deployer)) {
        await issuerContract.revokeRole(INCENTIVES_MANAGER_ROLE, deployer);
        console.log(`    ➖ Revoked INCENTIVES_MANAGER_ROLE from deployer`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await issuerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await issuerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
      }

      console.log(`    ✅ Completed Issuer role transfers`);
    } else {
      console.log(
        `  ⚠️ ${issuerContractId} not deployed, skipping role transfer`,
      );
    }
  } catch (error) {
    console.error(
      `  ❌ Failed to transfer ${issuerContractId} roles: ${error}`,
    );
  }

  return true;
}

/**
 * Transfer roles from deployer to governance multisig for the redeemer contract
 *
 * @param hre Hardhat Runtime Environment
 * @param redeemerContractId The ID of the redeemer contract
 * @param deployerSigner The signer for the deployer account
 * @param governanceMultisig The address of the governance multisig
 * @param deployer The address of the deployer account
 * @returns Promise that resolves to true when all roles are transferred
 */
async function transferRedeemerRoles(
  hre: HardhatRuntimeEnvironment,
  redeemerContractId: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  deployer: string,
): Promise<boolean> {
  const { deployments, ethers } = hre;

  try {
    const redeemerDeployment = await deployments.getOrNull(redeemerContractId);

    if (redeemerDeployment) {
      console.log(`\n  📄 REDEEMER ROLES: ${redeemerContractId}`);

      const redeemerContract = await ethers.getContractAt(
        "Redeemer",
        redeemerDeployment.address,
        deployerSigner,
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const REDEMPTION_MANAGER_ROLE =
        await redeemerContract.REDEMPTION_MANAGER_ROLE();

      // Grant roles to multisig
      if (
        !(await redeemerContract.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig,
        ))
      ) {
        await redeemerContract.grantRole(
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

      if (
        !(await redeemerContract.hasRole(
          REDEMPTION_MANAGER_ROLE,
          governanceMultisig,
        ))
      ) {
        await redeemerContract.grantRole(
          REDEMPTION_MANAGER_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted REDEMPTION_MANAGER_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ REDEMPTION_MANAGER_ROLE already granted to ${governanceMultisig}`,
        );
      }

      // Revoke non-admin roles from deployer first
      if (await redeemerContract.hasRole(REDEMPTION_MANAGER_ROLE, deployer)) {
        await redeemerContract.revokeRole(REDEMPTION_MANAGER_ROLE, deployer);
        console.log(`    ➖ Revoked REDEMPTION_MANAGER_ROLE from deployer`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await redeemerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await redeemerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
      }

      console.log(`    ✅ Completed Redeemer role transfers`);
    } else {
      console.log(
        `  ⚠️ ${redeemerContractId} not deployed, skipping role transfer`,
      );
    }
  } catch (error) {
    console.error(
      `  ❌ Failed to transfer ${redeemerContractId} roles: ${error}`,
    );
  }

  return true;
}

/**
 * Transfer roles from deployer to governance multisig for the AMO manager contract
 *
 * @param hre Hardhat Runtime Environment
 * @param amoManagerId The ID of the AMO manager contract
 * @param deployerSigner The signer for the deployer account
 * @param governanceMultisig The address of the governance multisig
 * @param deployer The address of the deployer account
 * @returns Promise that resolves to true when all roles are transferred
 */
async function transferAmoManagerRoles(
  hre: HardhatRuntimeEnvironment,
  amoManagerId: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  deployer: string,
): Promise<boolean> {
  const { deployments, ethers } = hre;

  try {
    const amoManagerDeployment = await deployments.getOrNull(amoManagerId);

    if (amoManagerDeployment) {
      console.log(`\n  📄 AMO MANAGER ROLES: ${amoManagerId}`);

      const amoManagerContract = await ethers.getContractAt(
        "AmoManager",
        amoManagerDeployment.address,
        deployerSigner,
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const AMO_ALLOCATOR_ROLE = await amoManagerContract.AMO_ALLOCATOR_ROLE();
      const FEE_COLLECTOR_ROLE = await amoManagerContract.FEE_COLLECTOR_ROLE();

      // Grant roles to multisig
      if (
        !(await amoManagerContract.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig,
        ))
      ) {
        await amoManagerContract.grantRole(
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

      if (
        !(await amoManagerContract.hasRole(
          AMO_ALLOCATOR_ROLE,
          governanceMultisig,
        ))
      ) {
        await amoManagerContract.grantRole(
          AMO_ALLOCATOR_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted AMO_ALLOCATOR_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ AMO_ALLOCATOR_ROLE already granted to ${governanceMultisig}`,
        );
      }

      if (
        !(await amoManagerContract.hasRole(
          FEE_COLLECTOR_ROLE,
          governanceMultisig,
        ))
      ) {
        await amoManagerContract.grantRole(
          FEE_COLLECTOR_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted FEE_COLLECTOR_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ FEE_COLLECTOR_ROLE already granted to ${governanceMultisig}`,
        );
      }

      // Revoke non-admin roles from deployer first
      if (await amoManagerContract.hasRole(AMO_ALLOCATOR_ROLE, deployer)) {
        await amoManagerContract.revokeRole(AMO_ALLOCATOR_ROLE, deployer);
        console.log(`    ➖ Revoked AMO_ALLOCATOR_ROLE from deployer`);
      }

      if (await amoManagerContract.hasRole(FEE_COLLECTOR_ROLE, deployer)) {
        await amoManagerContract.revokeRole(FEE_COLLECTOR_ROLE, deployer);
        console.log(`    ➖ Revoked FEE_COLLECTOR_ROLE from deployer`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await amoManagerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await amoManagerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
      }

      console.log(`    ✅ Completed AMO Manager role transfers`);
    } else {
      console.log(`  ⚠️ ${amoManagerId} not deployed, skipping role transfer`);
    }
  } catch (error) {
    console.error(`  ❌ Failed to transfer ${amoManagerId} roles: ${error}`);
  }

  return true;
}

/**
 * Transfer roles from deployer to governance multisig for the collateral vault contract
 *
 * @param hre Hardhat Runtime Environment
 * @param collateralVaultContractId The ID of the collateral vault contract
 * @param deployerSigner The signer for the deployer account
 * @param governanceMultisig The address of the governance multisig
 * @param deployer The address of the deployer account
 * @returns Promise that resolves to true when all roles are transferred
 */
async function transferCollateralVaultRoles(
  hre: HardhatRuntimeEnvironment,
  collateralVaultContractId: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  deployer: string,
): Promise<boolean> {
  const { deployments, ethers } = hre;

  try {
    const collateralVaultDeployment = await deployments.getOrNull(
      collateralVaultContractId,
    );

    if (collateralVaultDeployment) {
      console.log(
        `\n  📄 COLLATERAL VAULT ROLES: ${collateralVaultContractId}`,
      );

      const collateralVaultContract = await ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultDeployment.address,
        deployerSigner,
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const COLLATERAL_MANAGER_ROLE =
        await collateralVaultContract.COLLATERAL_MANAGER_ROLE();
      const COLLATERAL_STRATEGY_ROLE =
        await collateralVaultContract.COLLATERAL_STRATEGY_ROLE();
      const COLLATERAL_WITHDRAWER_ROLE =
        await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();

      // Grant roles to multisig
      if (
        !(await collateralVaultContract.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig,
        ))
      ) {
        await collateralVaultContract.grantRole(
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

      if (
        !(await collateralVaultContract.hasRole(
          COLLATERAL_MANAGER_ROLE,
          governanceMultisig,
        ))
      ) {
        await collateralVaultContract.grantRole(
          COLLATERAL_MANAGER_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted COLLATERAL_MANAGER_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ COLLATERAL_MANAGER_ROLE already granted to ${governanceMultisig}`,
        );
      }

      if (
        !(await collateralVaultContract.hasRole(
          COLLATERAL_STRATEGY_ROLE,
          governanceMultisig,
        ))
      ) {
        await collateralVaultContract.grantRole(
          COLLATERAL_STRATEGY_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted COLLATERAL_STRATEGY_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ COLLATERAL_STRATEGY_ROLE already granted to ${governanceMultisig}`,
        );
      }

      if (
        !(await collateralVaultContract.hasRole(
          COLLATERAL_WITHDRAWER_ROLE,
          governanceMultisig,
        ))
      ) {
        await collateralVaultContract.grantRole(
          COLLATERAL_WITHDRAWER_ROLE,
          governanceMultisig,
        );
        console.log(
          `    ➕ Granted COLLATERAL_WITHDRAWER_ROLE to ${governanceMultisig}`,
        );
      } else {
        console.log(
          `    ✓ COLLATERAL_WITHDRAWER_ROLE already granted to ${governanceMultisig}`,
        );
      }

      // Revoke non-admin roles from deployer first
      if (
        await collateralVaultContract.hasRole(COLLATERAL_MANAGER_ROLE, deployer)
      ) {
        await collateralVaultContract.revokeRole(
          COLLATERAL_MANAGER_ROLE,
          deployer,
        );
        console.log(`    ➖ Revoked COLLATERAL_MANAGER_ROLE from deployer`);
      }

      if (
        await collateralVaultContract.hasRole(
          COLLATERAL_STRATEGY_ROLE,
          deployer,
        )
      ) {
        await collateralVaultContract.revokeRole(
          COLLATERAL_STRATEGY_ROLE,
          deployer,
        );
        console.log(`    ➖ Revoked COLLATERAL_STRATEGY_ROLE from deployer`);
      }

      if (
        await collateralVaultContract.hasRole(
          COLLATERAL_WITHDRAWER_ROLE,
          deployer,
        )
      ) {
        await collateralVaultContract.revokeRole(
          COLLATERAL_WITHDRAWER_ROLE,
          deployer,
        );
        console.log(`    ➖ Revoked COLLATERAL_WITHDRAWER_ROLE from deployer`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await collateralVaultContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await collateralVaultContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
      }

      console.log(`    ✅ Completed Collateral Vault role transfers`);
    } else {
      console.log(
        `  ⚠️ ${collateralVaultContractId} not deployed, skipping role transfer`,
      );
    }
  } catch (error) {
    console.error(
      `  ❌ Failed to transfer ${collateralVaultContractId} roles: ${error}`,
    );
  }

  return true;
}

func.id = "transfer_dstable_roles_to_multisig";
func.tags = ["governance", "roles"];
func.dependencies = ["dusd", "ds"];

export default func;
