import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ACL_MANAGER_ID, EMISSION_MANAGER_ID, POOL_ADDRESSES_PROVIDER_ID, RESERVES_SETUP_HELPER_ID } from "../../typescript/deploy-ids";
import { ZERO_BYTES_32 } from "../../typescript/dlend/constants";
import { isMainnet } from "../../typescript/hardhat/deploy";

/**
 * Transfer all dLEND roles to the governance multisig
 *
 * @param hre Hardhat Runtime Environment
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (!isMainnet(hre.network.name)) {
    console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping non-mainnet network`);
    return true;
  }

  const { deployments, getNamedAccounts, ethers } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  // Get the configuration from the network
  const config = await getConfig(hre);

  // Get the governance multisig address
  const { governanceMultisig } = config.walletAddresses;

  console.log(`\n🔄 Transferring dLEND roles to governance multisig: ${governanceMultisig}`);

  // Transfer ACL roles
  try {
    const aclManager = await deployments.getOrNull(ACL_MANAGER_ID);
    const addressesProvider = await deployments.getOrNull(POOL_ADDRESSES_PROVIDER_ID);

    if (aclManager && addressesProvider) {
      console.log(`\n  📄 DLEND ACL ROLES`);

      const aclManagerContract = await ethers.getContractAt("ACLManager", aclManager.address, deployerSigner);
      const addressesProviderContract = await ethers.getContractAt("PoolAddressesProvider", addressesProvider.address, deployerSigner);

      // Set ACL admin on AddressesProvider
      const currentAclAdmin = await addressesProviderContract.getACLAdmin();

      if (currentAclAdmin.toLowerCase() !== governanceMultisig.toLowerCase()) {
        await addressesProviderContract.setACLAdmin(governanceMultisig);
        console.log(`    ➕ Set ACL admin on AddressesProvider to ${governanceMultisig}`);
      } else {
        console.log(`    ✓ ACL admin on AddressesProvider already set to ${governanceMultisig}`);
      }

      // Transfer DEFAULT_ADMIN_ROLE in ACLManager
      const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;

      if (!(await aclManagerContract.hasRole(DEFAULT_ADMIN_ROLE, governanceMultisig))) {
        await aclManagerContract.grantRole(DEFAULT_ADMIN_ROLE, governanceMultisig);
        console.log(`    ➕ Granted DEFAULT_ADMIN_ROLE in ACLManager to ${governanceMultisig}`);
      } else {
        console.log(`    ✓ DEFAULT_ADMIN_ROLE in ACLManager already granted to ${governanceMultisig}`);
      }

      // Add PoolAdmin to ACLManager
      if (!(await aclManagerContract.isPoolAdmin(governanceMultisig))) {
        await aclManagerContract.addPoolAdmin(governanceMultisig);
        console.log(`    ➕ Added PoolAdmin role in ACLManager to ${governanceMultisig}`);
      } else {
        console.log(`    ✓ PoolAdmin role in ACLManager already granted to ${governanceMultisig}`);
      }

      // Add EmergencyAdmin to ACLManager
      if (!(await aclManagerContract.isEmergencyAdmin(governanceMultisig))) {
        await aclManagerContract.addEmergencyAdmin(governanceMultisig);
        console.log(`    ➕ Added EmergencyAdmin role in ACLManager to ${governanceMultisig}`);
      } else {
        console.log(`    ✓ EmergencyAdmin role in ACLManager already granted to ${governanceMultisig}`);
      }

      // Revoke roles from deployer after governance multisig has them
      // Remove non-admin roles first
      if (await aclManagerContract.isPoolAdmin(deployer)) {
        await aclManagerContract.removePoolAdmin(deployer);
        console.log(`    ➖ Removed PoolAdmin role from deployer in ACLManager`);
      }

      if (await aclManagerContract.isEmergencyAdmin(deployer)) {
        await aclManagerContract.removeEmergencyAdmin(deployer);
        console.log(`    ➖ Removed EmergencyAdmin role from deployer in ACLManager`);
      }

      // Revoke DEFAULT_ADMIN_ROLE last
      if (await aclManagerContract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
        await aclManagerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
        console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer in ACLManager`);
      }

      // Transfer PoolAddressesProvider ownership
      const currentAddressesProviderOwner = await addressesProviderContract.owner();

      if (currentAddressesProviderOwner.toLowerCase() !== governanceMultisig.toLowerCase()) {
        await addressesProviderContract.transferOwnership(governanceMultisig);
        console.log(`    ➕ Transferred PoolAddressesProvider ownership to ${governanceMultisig}`);
      } else {
        console.log(`    ✓ PoolAddressesProvider ownership already set to ${governanceMultisig}`);
      }

      console.log(`    ✅ Completed dLEND ACL role transfers`);
    } else {
      console.log(`  ⚠️ ACLManager or AddressesProvider not deployed, skipping ACL role transfer`);
    }
  } catch (error) {
    console.error(`  ❌ Failed to transfer dLEND ACL roles: ${error}`);
  }

  // Transfer EmissionManager ownership
  try {
    const emissionManager = await deployments.getOrNull(EMISSION_MANAGER_ID);

    if (emissionManager) {
      console.log(`\n  📄 EMISSION MANAGER ROLES`);

      const emissionManagerContract = await ethers.getContractAt("EmissionManager", emissionManager.address, deployerSigner);

      const currentOwner = await emissionManagerContract.owner();

      if (currentOwner.toLowerCase() !== governanceMultisig.toLowerCase()) {
        await emissionManagerContract.transferOwnership(governanceMultisig);
        console.log(`    ➕ Transferred EmissionManager ownership to ${governanceMultisig}`);
      } else {
        console.log(`    ✓ EmissionManager ownership already set to ${governanceMultisig}`);
      }

      console.log(`    ✅ Completed EmissionManager ownership transfer`);
    } else {
      console.log(`  ⚠️ EmissionManager not deployed, skipping ownership transfer`);
    }
  } catch (error) {
    console.error(`  ❌ Failed to transfer EmissionManager ownership: ${error}`);
  }

  // Transfer ReservesSetupHelper ownership
  try {
    const reservesSetupHelper = await deployments.getOrNull(RESERVES_SETUP_HELPER_ID);

    if (reservesSetupHelper) {
      console.log(`\n  📄 RESERVES SETUP HELPER OWNERSHIP`);

      const reservesSetupHelperContract = await ethers.getContractAt("ReservesSetupHelper", reservesSetupHelper.address, deployerSigner);

      const currentOwner = await reservesSetupHelperContract.owner();

      if (currentOwner.toLowerCase() !== governanceMultisig.toLowerCase()) {
        await reservesSetupHelperContract.transferOwnership(governanceMultisig);
        console.log(`    ➕ Transferred ReservesSetupHelper ownership to ${governanceMultisig}`);
      } else {
        console.log(`    ✓ ReservesSetupHelper ownership already set to ${governanceMultisig}`);
      }

      console.log(`    ✅ Completed ReservesSetupHelper ownership transfer`);
    } else {
      console.log(`  ⚠️ ReservesSetupHelper not deployed, skipping ownership transfer`);
    }
  } catch (error) {
    console.error(`  ❌ Failed to transfer ReservesSetupHelper ownership: ${error}`);
  }

  console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: ✅ Done\n`);

  return true;
};

func.id = "transfer_dlend_roles_to_multisig";
func.tags = ["governance", "roles"];
func.dependencies = ["dlend"];

export default func;
