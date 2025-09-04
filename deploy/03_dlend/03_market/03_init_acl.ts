import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { ACL_MANAGER_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../../typescript/deploy-ids";
import { ZERO_BYTES_32 } from "../../../typescript/dlend/constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await hre.ethers.getSigners();

  const addressesProviderDeployedResult = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderDeployedResult.address,
    deployer,
  );

  // 1. Set ACL admin on AddressesProvider
  await addressesProviderContract.setACLAdmin(deployer.address);

  // 2. Deploy ACLManager
  const aclManagerDeployment = await hre.deployments.deploy(ACL_MANAGER_ID, {
    contract: "ACLManager",
    from: deployer.address,
    args: [addressesProviderDeployedResult.address],
    log: true,
  });

  const aclManagerContract = await hre.ethers.getContractAt("ACLManager", aclManagerDeployment.address, deployer);

  // 3. Setup ACLManager for AddressProvider
  await addressesProviderContract.setACLManager(aclManagerDeployment.address);

  // 4. Add PoolAdmin to ACLManager
  await aclManagerContract.addPoolAdmin(deployer.address);

  // 5. Add EmergencyAdmin to ACLManager
  await aclManagerContract.addEmergencyAdmin(deployer.address);

  // Verify setup
  const isACLAdmin = await aclManagerContract.hasRole(ZERO_BYTES_32, deployer.address);
  const isPoolAdmin = await aclManagerContract.isPoolAdmin(deployer.address);
  const isEmergencyAdmin = await aclManagerContract.isEmergencyAdmin(deployer.address);

  if (!isACLAdmin) {
    throw "[ACL][ERROR] ACLAdmin is not setup correctly";
  }

  if (!isPoolAdmin) {
    throw "[ACL][ERROR] PoolAdmin is not setup correctly";
  }

  if (!isEmergencyAdmin) {
    throw "[ACL][ERROR] EmergencyAdmin is not setup correctly";
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:init_acl";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "PoolAddressesProvider"];

export default func;
