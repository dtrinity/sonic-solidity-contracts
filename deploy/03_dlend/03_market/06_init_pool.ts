import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_CONFIGURATOR_ID,
  POOL_CONFIGURATOR_PROXY_ID,
  POOL_IMPL_ID,
  POOL_PROXY_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);

  const proxyArtifact = await hre.deployments.getExtendedArtifact("InitializableImmutableAdminUpgradeabilityProxy");

  const poolImplDeployment = await hre.deployments.get(POOL_IMPL_ID);
  const poolConfiguratorImplDeployment = await hre.deployments.get(POOL_CONFIGURATOR_ID);

  const { address: addressesProviderAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  const addressesProviderInstance = await hre.ethers.getContractAt("PoolAddressesProvider", addressesProviderAddress, signer);

  const isPoolProxyPending = (await addressesProviderInstance.getPool()) === ZeroAddress;

  // Set Pool implementation to Addresses provider and save the proxy deployment artifact at disk
  if (isPoolProxyPending) {
    const setPoolImplTx = await addressesProviderInstance.setPoolImpl(poolImplDeployment.address);
    await setPoolImplTx.wait();
  }

  const poolAddressProviderAddress = await addressesProviderInstance.getPool();

  await hre.deployments.save(POOL_PROXY_ID, {
    ...proxyArtifact,
    address: poolAddressProviderAddress,
  });

  const isPoolConfiguratorProxyPending = (await addressesProviderInstance.getPoolConfigurator()) === ZeroAddress;

  // Set Pool Configurator to Addresses Provider proxy deployment artifact at disk
  if (isPoolConfiguratorProxyPending) {
    const setPoolConfiguratorTx = await addressesProviderInstance.setPoolConfiguratorImpl(poolConfiguratorImplDeployment.address);
    await setPoolConfiguratorTx.wait();
  }
  const poolConfiguratorProxyAddress = await addressesProviderInstance.getPoolConfigurator();

  await hre.deployments.save(POOL_CONFIGURATOR_PROXY_ID, {
    ...proxyArtifact,
    address: poolConfiguratorProxyAddress,
  });

  // Set Flash Loan premiums
  const poolConfiguratorContract = await hre.ethers.getContractAt("PoolConfigurator", poolConfiguratorProxyAddress, signer);

  // Get ACLManager address
  const addressProvider = await hre.ethers.getContractAt("PoolAddressesProvider", addressesProviderAddress, signer);
  const aclManagerAddress = await addressProvider.getACLManager();

  // Get pool admin from ACL Manager
  const aclManager = await hre.ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  await aclManager.isPoolAdmin(await signer.getAddress());

  const flashLoanPremium = config.dLend.flashLoanPremium;

  // Get Pool contract to check current flash loan premium values
  const poolContract = await hre.ethers.getContractAt("Pool", poolAddressProviderAddress, signer);

  // Check and set total Flash Loan Premium
  const currentTotalPremium = await poolContract.FLASHLOAN_PREMIUM_TOTAL();

  if (currentTotalPremium.toString() !== flashLoanPremium.total.toString()) {
    const updateFlashloanPremiumTotalResponse = await poolConfiguratorContract.updateFlashloanPremiumTotal(flashLoanPremium.total);
    await updateFlashloanPremiumTotalResponse.wait();
    console.log(`Updated flash loan premium total from ${currentTotalPremium} to ${flashLoanPremium.total}`);
  } else {
    console.log(`Flash loan premium total already set to ${flashLoanPremium.total}. Skipping.`);
  }

  // Check and set protocol Flash Loan Premium
  const currentProtocolPremium = await poolContract.FLASHLOAN_PREMIUM_TO_PROTOCOL();

  if (currentProtocolPremium.toString() !== flashLoanPremium.protocol.toString()) {
    const updateFlashloanPremiumToProtocolResponse = await poolConfiguratorContract.updateFlashloanPremiumToProtocol(
      flashLoanPremium.protocol,
    );
    await updateFlashloanPremiumToProtocolResponse.wait();
    console.log(`Updated flash loan premium to protocol from ${currentProtocolPremium} to ${flashLoanPremium.protocol}`);
  } else {
    console.log(`Flash loan premium to protocol already set to ${flashLoanPremium.protocol}. Skipping.`);
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:init_pool";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "PoolAddressesProvider", "L2PoolImplementations", "PoolConfigurator"];

export default func;
