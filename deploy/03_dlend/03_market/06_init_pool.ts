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

  // Set total Flash Loan Premium
  const updateFlashloanPremiumTotalResponse = await poolConfiguratorContract.updateFlashloanPremiumTotal(flashLoanPremium.total);
  await updateFlashloanPremiumTotalResponse.wait();

  // Set protocol Flash Loan Premium
  const updateFlashloanPremiumToProtocolResponse = await poolConfiguratorContract.updateFlashloanPremiumToProtocol(
    flashLoanPremium.protocol,
  );
  await updateFlashloanPremiumToProtocolResponse.wait();

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:init_pool";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "PoolAddressesProvider", "L2PoolImplementations", "PoolConfigurator"];

export default func;
