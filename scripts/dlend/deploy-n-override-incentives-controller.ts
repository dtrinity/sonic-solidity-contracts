import { ZeroAddress } from "ethers";
import hre from "hardhat";

import { getConfig } from "../../config/config";
import {
  EMISSION_MANAGER_ID,
  INCENTIVES_IMPL_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  PULL_REWARDS_TRANSFER_STRATEGY_ID,
} from "../../typescript/deploy-ids";

/**
 *
 */
async function main() {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { save, getExtendedArtifact, deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const emissionManager = await deployments.getOrNull(EMISSION_MANAGER_ID);

  if (!emissionManager) {
    throw new Error("EmissionManager not found");
  }

  const emissionManagerContract = await ethers.getContractAt("EmissionManager", emissionManager.address);

  // Check that we are the owner of the emission manager
  const isOwner = await emissionManagerContract.owner();

  if (isOwner !== deployer) {
    throw new Error("You are not the owner of the emission manager");
  }

  // Deploy Incentives Implementation (RewardsController)
  const incentivesImpl = await deploy(INCENTIVES_IMPL_ID, {
    from: deployer,
    args: [emissionManager.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log("New incentives controller implementation deployed at ", incentivesImpl.address);

  const incentivesImplContract = await ethers.getContractAt("RewardsController", incentivesImpl.address);

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

  const addressesProvider = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressesProviderInstance = await ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProvider.address,
    await ethers.getSigner(deployer),
  );

  const _setRewardsAsProxyTx = await addressesProviderInstance.setAddressAsProxy(incentivesControllerId, incentivesImpl.address);

  console.log("Set Rewards Controller as proxy at tx ", _setRewardsAsProxyTx.hash);

  const proxyAddress = await addressesProviderInstance.getAddressFromID(incentivesControllerId);

  await save(INCENTIVES_PROXY_ID, {
    ...proxyArtifact,
    address: proxyAddress,
  });

  const setRewardsControllerTx = await emissionManagerContract.setRewardsController(proxyAddress);

  console.log("Set Rewards Controller at tx ", setRewardsControllerTx.hash);
  const config = await getConfig(hre);
  await deploy(PULL_REWARDS_TRANSFER_STRATEGY_ID, {
    from: deployer,
    args: [proxyAddress, config.walletAddresses.governanceMultisig, config.walletAddresses.incentivesVault],
    log: true,
    waitConfirmations: 1,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  });
