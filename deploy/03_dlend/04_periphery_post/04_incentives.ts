import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  EMISSION_MANAGER_ID,
  INCENTIVES_IMPL_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  PULL_REWARDS_TRANSFER_STRATEGY_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, save, getExtendedArtifact } = deployments;
  const { deployer } = await getNamedAccounts();
  const config = await getConfig(hre);

  // Get AddressesProvider address
  const addressesProvider = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressesProviderInstance = await ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProvider.address,
    await ethers.getSigner(deployer),
  );

  // Deploy EmissionManager
  const emissionManager = await deploy(EMISSION_MANAGER_ID, {
    from: deployer,
    args: [deployer],
    log: true,
    waitConfirmations: 1,
  });

  // Deploy Incentives Implementation (RewardsController)
  const incentivesImpl = await deploy(INCENTIVES_IMPL_ID, {
    from: deployer,
    args: [emissionManager.address],
    log: true,
    waitConfirmations: 1,
  });

  const incentivesImplContract = await ethers.getContractAt("RewardsController", incentivesImpl.address);

  // Initialize the implementation
  try {
    await incentivesImplContract.initialize(ZeroAddress);
  } catch (error: any) {
    if (error?.message.includes("Contract instance has already been initialized")) {
      console.log("Incentives implementation already initialized");
    } else {
      throw Error(`Failed to initialize Incentives implementation: ${error}`);
    }
  }

  // The Rewards Controller must be set at AddressesProvider with id keccak256("INCENTIVES_CONTROLLER")
  const incentivesControllerId = ethers.keccak256(ethers.toUtf8Bytes("INCENTIVES_CONTROLLER"));

  const proxyArtifact = await getExtendedArtifact("InitializableImmutableAdminUpgradeabilityProxy");

  let proxyAddress = await addressesProviderInstance.getAddressFromID(incentivesControllerId);
  const proxyMissing = proxyAddress === ZeroAddress;

  if (proxyMissing) {
    const setRewardsAsProxyTx = await addressesProviderInstance.setAddressAsProxy(incentivesControllerId, incentivesImpl.address);
    await setRewardsAsProxyTx.wait();
    proxyAddress = await addressesProviderInstance.getAddressFromID(incentivesControllerId);
  }

  if (proxyAddress === ZeroAddress) {
    throw new Error("Incentives proxy is still unset in PoolAddressesProvider after setup");
  }

  await save(INCENTIVES_PROXY_ID, {
    ...proxyArtifact,
    address: proxyAddress,
  });

  const incentivesProxyAddress = proxyAddress;

  // Initialize EmissionManager with the rewards controller address
  const emissionManagerContract = await ethers.getContractAt("EmissionManager", emissionManager.address);

  if (incentivesProxyAddress && incentivesProxyAddress !== ZeroAddress) {
    await emissionManagerContract.setRewardsController(incentivesProxyAddress);
  } else {
    console.log("Warning: IncentivesProxy address is undefined, skipping setRewardsController");
  }

  // Deploy Rewards Strategies
  await deploy(PULL_REWARDS_TRANSFER_STRATEGY_ID, {
    from: deployer,
    args: [
      incentivesProxyAddress,
      config.walletAddresses.governanceMultisig, // This is the REWARDS_ADMIN
      config.walletAddresses.incentivesVault, // This is where we pull the rewards from
    ],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:Incentives";
func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "dlend-market", "PoolAddressesProvider"];

export default func;
