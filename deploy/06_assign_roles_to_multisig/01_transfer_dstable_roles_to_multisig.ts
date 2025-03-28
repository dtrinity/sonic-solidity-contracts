import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";
import { getConfig } from "../../config/config";

/**
 * Transfer all dStable ecosystem roles (dUSD and dS) to the governance multisig
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
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
    console.log(`\nTransferring roles for ${dStableName}...`);

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
      deployer
    );

    // Transfer Issuer roles
    await transferIssuerRoles(
      hre,
      issuerContractId,
      deployerSigner,
      governanceMultisig,
      deployer
    );

    // Transfer Redeemer roles
    await transferRedeemerRoles(
      hre,
      redeemerContractId,
      deployerSigner,
      governanceMultisig,
      deployer
    );

    // Transfer AmoManager roles
    await transferAmoManagerRoles(
      hre,
      amoManagerId,
      deployerSigner,
      governanceMultisig,
      deployer
    );

    // Transfer CollateralVault roles
    await transferCollateralVaultRoles(
      hre,
      collateralVaultContractId,
      deployerSigner,
      governanceMultisig,
      deployer
    );
  }

  console.log(`🔑 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

/**
 * Transfer token roles to governance multisig
 */
async function transferTokenRoles(
  hre: HardhatRuntimeEnvironment,
  tokenId: string,
  deployerSigner: any,
  governanceMultisig: string,
  deployer: string
) {
  const { deployments, ethers } = hre;

  try {
    const tokenDeployment = await deployments.getOrNull(tokenId);
    if (tokenDeployment) {
      const tokenContract = await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        tokenDeployment.address,
        deployerSigner
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
          `Granted DEFAULT_ADMIN_ROLE for ${tokenId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `DEFAULT_ADMIN_ROLE for ${tokenId} already granted to ${governanceMultisig}`
        );
      }

      if (!(await tokenContract.hasRole(PAUSER_ROLE, governanceMultisig))) {
        await tokenContract.grantRole(PAUSER_ROLE, governanceMultisig);
        console.log(
          `Granted PAUSER_ROLE for ${tokenId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `PAUSER_ROLE for ${tokenId} already granted to ${governanceMultisig}`
        );
      }

      // Note: we don't grant MINTER_ROLE directly as it's managed by issuer

      // Revoke non-admin roles from deployer first
      if (await tokenContract.hasRole(PAUSER_ROLE, deployer)) {
        await tokenContract.revokeRole(PAUSER_ROLE, deployer);
        console.log(`Revoked PAUSER_ROLE for ${tokenId} from deployer`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await tokenContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await tokenContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`Revoked DEFAULT_ADMIN_ROLE for ${tokenId} from deployer`);
      }
    } else {
      console.log(`${tokenId} token not deployed, skipping role transfer`);
    }
  } catch (error) {
    console.error(`Failed to transfer ${tokenId} token roles: ${error}`);
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
}

/**
 * Transfer Issuer roles to governance multisig
 */
async function transferIssuerRoles(
  hre: HardhatRuntimeEnvironment,
  issuerContractId: string,
  deployerSigner: any,
  governanceMultisig: string,
  deployer: string
) {
  const { deployments, ethers } = hre;

  try {
    const issuerDeployment = await deployments.getOrNull(issuerContractId);
    if (issuerDeployment) {
      const issuerContract = await ethers.getContractAt(
        "Issuer",
        issuerDeployment.address,
        deployerSigner
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
          `Granted DEFAULT_ADMIN_ROLE for ${issuerContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `DEFAULT_ADMIN_ROLE for ${issuerContractId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await issuerContract.hasRole(AMO_MANAGER_ROLE, governanceMultisig))
      ) {
        await issuerContract.grantRole(AMO_MANAGER_ROLE, governanceMultisig);
        console.log(
          `Granted AMO_MANAGER_ROLE for ${issuerContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `AMO_MANAGER_ROLE for ${issuerContractId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await issuerContract.hasRole(
          INCENTIVES_MANAGER_ROLE,
          governanceMultisig
        ))
      ) {
        await issuerContract.grantRole(
          INCENTIVES_MANAGER_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted INCENTIVES_MANAGER_ROLE for ${issuerContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `INCENTIVES_MANAGER_ROLE for ${issuerContractId} already granted to ${governanceMultisig}`
        );
      }

      // Revoke non-admin roles from deployer first
      if (await issuerContract.hasRole(AMO_MANAGER_ROLE, deployer)) {
        await issuerContract.revokeRole(AMO_MANAGER_ROLE, deployer);
        console.log(
          `Revoked AMO_MANAGER_ROLE for ${issuerContractId} from deployer`
        );
      }

      if (await issuerContract.hasRole(INCENTIVES_MANAGER_ROLE, deployer)) {
        await issuerContract.revokeRole(INCENTIVES_MANAGER_ROLE, deployer);
        console.log(
          `Revoked INCENTIVES_MANAGER_ROLE for ${issuerContractId} from deployer`
        );
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await issuerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await issuerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(
          `Revoked DEFAULT_ADMIN_ROLE for ${issuerContractId} from deployer`
        );
      }

      console.log(
        `Transferred ${issuerContractId} roles to ${governanceMultisig}`
      );
    } else {
      console.log(`${issuerContractId} not deployed, skipping role transfer`);
    }
  } catch (error) {
    console.error(`Failed to transfer ${issuerContractId} roles: ${error}`);
  }
}

/**
 * Transfer Redeemer roles to governance multisig
 */
async function transferRedeemerRoles(
  hre: HardhatRuntimeEnvironment,
  redeemerContractId: string,
  deployerSigner: any,
  governanceMultisig: string,
  deployer: string
) {
  const { deployments, ethers } = hre;

  try {
    const redeemerDeployment = await deployments.getOrNull(redeemerContractId);
    if (redeemerDeployment) {
      const redeemerContract = await ethers.getContractAt(
        "Redeemer",
        redeemerDeployment.address,
        deployerSigner
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const REDEMPTION_MANAGER_ROLE =
        await redeemerContract.REDEMPTION_MANAGER_ROLE();

      // Grant roles to multisig
      if (
        !(await redeemerContract.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig
        ))
      ) {
        await redeemerContract.grantRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted DEFAULT_ADMIN_ROLE for ${redeemerContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `DEFAULT_ADMIN_ROLE for ${redeemerContractId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await redeemerContract.hasRole(
          REDEMPTION_MANAGER_ROLE,
          governanceMultisig
        ))
      ) {
        await redeemerContract.grantRole(
          REDEMPTION_MANAGER_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted REDEMPTION_MANAGER_ROLE for ${redeemerContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `REDEMPTION_MANAGER_ROLE for ${redeemerContractId} already granted to ${governanceMultisig}`
        );
      }

      // Revoke non-admin roles from deployer first
      if (await redeemerContract.hasRole(REDEMPTION_MANAGER_ROLE, deployer)) {
        await redeemerContract.revokeRole(REDEMPTION_MANAGER_ROLE, deployer);
        console.log(
          `Revoked REDEMPTION_MANAGER_ROLE for ${redeemerContractId} from deployer`
        );
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await redeemerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await redeemerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(
          `Revoked DEFAULT_ADMIN_ROLE for ${redeemerContractId} from deployer`
        );
      }

      console.log(
        `Transferred ${redeemerContractId} roles to ${governanceMultisig}`
      );
    } else {
      console.log(`${redeemerContractId} not deployed, skipping role transfer`);
    }
  } catch (error) {
    console.error(`Failed to transfer ${redeemerContractId} roles: ${error}`);
  }
}

/**
 * Transfer AmoManager roles to governance multisig
 */
async function transferAmoManagerRoles(
  hre: HardhatRuntimeEnvironment,
  amoManagerId: string,
  deployerSigner: any,
  governanceMultisig: string,
  deployer: string
) {
  const { deployments, ethers } = hre;

  try {
    const amoManagerDeployment = await deployments.getOrNull(amoManagerId);
    if (amoManagerDeployment) {
      const amoManagerContract = await ethers.getContractAt(
        "AmoManager",
        amoManagerDeployment.address,
        deployerSigner
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const AMO_ALLOCATOR_ROLE = await amoManagerContract.AMO_ALLOCATOR_ROLE();
      const FEE_COLLECTOR_ROLE = await amoManagerContract.FEE_COLLECTOR_ROLE();

      // Grant roles to multisig
      if (
        !(await amoManagerContract.hasRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig
        ))
      ) {
        await amoManagerContract.grantRole(
          DEFAULT_ADMIN_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted DEFAULT_ADMIN_ROLE for ${amoManagerId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `DEFAULT_ADMIN_ROLE for ${amoManagerId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await amoManagerContract.hasRole(
          AMO_ALLOCATOR_ROLE,
          governanceMultisig
        ))
      ) {
        await amoManagerContract.grantRole(
          AMO_ALLOCATOR_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted AMO_ALLOCATOR_ROLE for ${amoManagerId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `AMO_ALLOCATOR_ROLE for ${amoManagerId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await amoManagerContract.hasRole(
          FEE_COLLECTOR_ROLE,
          governanceMultisig
        ))
      ) {
        await amoManagerContract.grantRole(
          FEE_COLLECTOR_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted FEE_COLLECTOR_ROLE for ${amoManagerId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `FEE_COLLECTOR_ROLE for ${amoManagerId} already granted to ${governanceMultisig}`
        );
      }

      // Revoke non-admin roles from deployer first
      if (await amoManagerContract.hasRole(AMO_ALLOCATOR_ROLE, deployer)) {
        await amoManagerContract.revokeRole(AMO_ALLOCATOR_ROLE, deployer);
        console.log(
          `Revoked AMO_ALLOCATOR_ROLE for ${amoManagerId} from deployer`
        );
      }

      if (await amoManagerContract.hasRole(FEE_COLLECTOR_ROLE, deployer)) {
        await amoManagerContract.revokeRole(FEE_COLLECTOR_ROLE, deployer);
        console.log(
          `Revoked FEE_COLLECTOR_ROLE for ${amoManagerId} from deployer`
        );
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await amoManagerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await amoManagerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(
          `Revoked DEFAULT_ADMIN_ROLE for ${amoManagerId} from deployer`
        );
      }

      console.log(`Transferred ${amoManagerId} roles to ${governanceMultisig}`);
    } else {
      console.log(`${amoManagerId} not deployed, skipping role transfer`);
    }
  } catch (error) {
    console.error(`Failed to transfer ${amoManagerId} roles: ${error}`);
  }
}

/**
 * Transfer CollateralVault roles to governance multisig
 */
async function transferCollateralVaultRoles(
  hre: HardhatRuntimeEnvironment,
  collateralVaultContractId: string,
  deployerSigner: any,
  governanceMultisig: string,
  deployer: string
) {
  const { deployments, ethers } = hre;

  try {
    const vaultDeployment = await deployments.getOrNull(
      collateralVaultContractId
    );
    if (vaultDeployment) {
      const vaultContract = await ethers.getContractAt(
        "CollateralVault",
        vaultDeployment.address,
        deployerSigner
      );

      // Get roles
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
      const COLLATERAL_MANAGER_ROLE =
        await vaultContract.COLLATERAL_MANAGER_ROLE();
      const COLLATERAL_STRATEGY_ROLE =
        await vaultContract.COLLATERAL_STRATEGY_ROLE();
      const COLLATERAL_WITHDRAWER_ROLE =
        await vaultContract.COLLATERAL_WITHDRAWER_ROLE();

      // Grant roles to multisig
      if (
        !(await vaultContract.hasRole(DEFAULT_ADMIN_ROLE, governanceMultisig))
      ) {
        await vaultContract.grantRole(DEFAULT_ADMIN_ROLE, governanceMultisig);
        console.log(
          `Granted DEFAULT_ADMIN_ROLE for ${collateralVaultContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `DEFAULT_ADMIN_ROLE for ${collateralVaultContractId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await vaultContract.hasRole(
          COLLATERAL_MANAGER_ROLE,
          governanceMultisig
        ))
      ) {
        await vaultContract.grantRole(
          COLLATERAL_MANAGER_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted COLLATERAL_MANAGER_ROLE for ${collateralVaultContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `COLLATERAL_MANAGER_ROLE for ${collateralVaultContractId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await vaultContract.hasRole(
          COLLATERAL_STRATEGY_ROLE,
          governanceMultisig
        ))
      ) {
        await vaultContract.grantRole(
          COLLATERAL_STRATEGY_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted COLLATERAL_STRATEGY_ROLE for ${collateralVaultContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `COLLATERAL_STRATEGY_ROLE for ${collateralVaultContractId} already granted to ${governanceMultisig}`
        );
      }

      if (
        !(await vaultContract.hasRole(
          COLLATERAL_WITHDRAWER_ROLE,
          governanceMultisig
        ))
      ) {
        await vaultContract.grantRole(
          COLLATERAL_WITHDRAWER_ROLE,
          governanceMultisig
        );
        console.log(
          `Granted COLLATERAL_WITHDRAWER_ROLE for ${collateralVaultContractId} to ${governanceMultisig}`
        );
      } else {
        console.log(
          `COLLATERAL_WITHDRAWER_ROLE for ${collateralVaultContractId} already granted to ${governanceMultisig}`
        );
      }

      // Revoke non-admin roles from deployer first
      if (await vaultContract.hasRole(COLLATERAL_MANAGER_ROLE, deployer)) {
        await vaultContract.revokeRole(COLLATERAL_MANAGER_ROLE, deployer);
        console.log(
          `Revoked COLLATERAL_MANAGER_ROLE for ${collateralVaultContractId} from deployer`
        );
      }

      if (await vaultContract.hasRole(COLLATERAL_STRATEGY_ROLE, deployer)) {
        await vaultContract.revokeRole(COLLATERAL_STRATEGY_ROLE, deployer);
        console.log(
          `Revoked COLLATERAL_STRATEGY_ROLE for ${collateralVaultContractId} from deployer`
        );
      }

      if (await vaultContract.hasRole(COLLATERAL_WITHDRAWER_ROLE, deployer)) {
        await vaultContract.revokeRole(COLLATERAL_WITHDRAWER_ROLE, deployer);
        console.log(
          `Revoked COLLATERAL_WITHDRAWER_ROLE for ${collateralVaultContractId} from deployer`
        );
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await vaultContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await vaultContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(
          `Revoked DEFAULT_ADMIN_ROLE for ${collateralVaultContractId} from deployer`
        );
      }

      console.log(
        `Transferred ${collateralVaultContractId} roles to ${governanceMultisig}`
      );
    } else {
      console.log(
        `${collateralVaultContractId} not deployed, skipping role transfer`
      );
    }
  } catch (error) {
    console.error(
      `Failed to transfer ${collateralVaultContractId} roles: ${error}`
    );
  }
}

func.id = "transfer_dstable_roles_to_multisig";
func.tags = ["governance", "roles"];
func.dependencies = ["dusd", "ds"];

export default func;
