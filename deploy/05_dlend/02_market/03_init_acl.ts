import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ZERO_BYTES_32 } from "../../../typescript/dlend/constants";
import {
  ACL_MANAGER_ID,
  POOL_ADDRESSES_PROVIDER_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await hre.ethers.getSigners();

  const addressesProviderDeployedResult = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderDeployedResult.address,
    deployer
  );

  // 1. Set ACL admin on AddressesProvider
  console.log(`----------------------------------`);
  console.log(`Set ACL admin on AddressesProvider`);
  console.log(
    `  - Address Provider: ${addressesProviderDeployedResult.address}`
  );
  console.log(`  - ACL Admin       : ${deployer.address}`);
  const setACLAdminResponse = await addressesProviderContract.setACLAdmin(
    deployer.address
  );
  const setACLAdminReceipt = await setACLAdminResponse.wait();
  console.log(`  - TxHash  : ${setACLAdminReceipt?.hash}`);
  console.log(`  - From    : ${setACLAdminReceipt?.from}`);
  console.log(`  - GasUsed : ${setACLAdminReceipt?.gasUsed.toString()}`);
  console.log(`----------------------------------`);

  // 2. Deploy ACLManager
  const aclManagerDeployment = await hre.deployments.deploy(ACL_MANAGER_ID, {
    contract: "ACLManager",
    from: deployer.address,
    args: [addressesProviderDeployedResult.address],
    log: true,
  });

  const aclManagerContract = await hre.ethers.getContractAt(
    "ACLManager",
    aclManagerDeployment.address,
    deployer
  );

  // 3. Setup ACLManager for AddressProvider
  console.log(`----------------------------------------`);
  console.log(`Setup ACLManager for AddressProvider`);
  console.log(
    `  - Address Provider: ${addressesProviderDeployedResult.address}`
  );
  console.log(`  - ACL Manager     : ${aclManagerDeployment.address}`);
  const setACLManagerResponse = await addressesProviderContract.setACLManager(
    await aclManagerContract.getAddress()
  );
  const setACLManagerReceipt = await setACLManagerResponse.wait();
  console.log(`  - TxHash  : ${setACLManagerReceipt?.hash}`);
  console.log(`  - From    : ${setACLManagerReceipt?.from}`);
  console.log(`  - GasUsed : ${setACLManagerReceipt?.gasUsed.toString()}`);
  console.log(`----------------------------------------`);

  // 4. Add PoolAdmin to ACLManager
  console.log(`-----------------------------`);
  console.log(`Add Pool Admin to ACL Manager`);
  console.log(`  - ACL Manager : ${aclManagerDeployment.address}`);
  console.log(`  - Pool Admin  : ${deployer.address}`);
  const addPoolAdminResponse = await aclManagerContract.addPoolAdmin(
    deployer.address
  );
  const addPoolAdminReceipt = await addPoolAdminResponse.wait();
  console.log(`  - TxHash  : ${addPoolAdminReceipt?.hash}`);
  console.log(`  - From    : ${addPoolAdminReceipt?.from}`);
  console.log(`  - GasUsed : ${addPoolAdminReceipt?.gasUsed.toString()}`);
  console.log(`-----------------------------`);

  // 5. Add EmergencyAdmin to ACLManager
  console.log(`----------------------------------`);
  console.log(`Add Emergency Admin to ACL Manager`);
  console.log(`  - ACL Manager     : ${aclManagerDeployment.address}`);
  console.log(`  - Emergency Admin : ${deployer.address}`);
  const addEmergencyAdminResponse = await aclManagerContract.addEmergencyAdmin(
    deployer.address
  );
  const addEmergencyAdminReceipt = await addEmergencyAdminResponse.wait();
  console.log(`  - TxHash  : ${addEmergencyAdminReceipt?.hash}`);
  console.log(`  - From    : ${addEmergencyAdminReceipt?.from}`);
  console.log(`  - GasUsed : ${addEmergencyAdminReceipt?.gasUsed.toString()}`);
  console.log(`----------------------------------`);

  // Verify setup
  const isACLAdmin = await aclManagerContract.hasRole(
    ZERO_BYTES_32,
    deployer.address
  );
  const isPoolAdmin = await aclManagerContract.isPoolAdmin(deployer.address);
  const isEmergencyAdmin = await aclManagerContract.isEmergencyAdmin(
    deployer.address
  );

  if (!isACLAdmin) {
    throw "[ACL][ERROR] ACLAdmin is not setup correctly";
  }

  if (!isPoolAdmin) {
    throw "[ACL][ERROR] PoolAdmin is not setup correctly";
  }

  if (!isEmergencyAdmin) {
    throw "[ACL][ERROR] EmergencyAdmin is not setup correctly";
  }

  console.log("== Market Admins ==");
  console.log("- ACL Admin", deployer.address);
  console.log("- Pool Admin", deployer.address);
  console.log("- Emergency Admin", deployer.address);
  console.log("===================");

  return true;
};

func.id = "init_acl";
func.tags = ["dlend", "dlend-market"];
func.dependencies = [
  "dlend-core",
  "dlend-periphery-pre",
  "PoolAddressesProvider",
];

export default func;
