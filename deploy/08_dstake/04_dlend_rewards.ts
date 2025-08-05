import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DLendRewardManagerConfig,
  DStakeInstanceConfig,
} from "../../config/types";
import { DStakeRewardManagerDLend } from "../../typechain-types";
import {
  EMISSION_MANAGER_ID,
  INCENTIVES_PROXY_ID,
  POOL_DATA_PROVIDER_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  // Collect instructions for any manual actions required when the deployer lacks permissions.
  const manualActions: string[] = [];

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log(
      "No dSTAKE configuration found for this network. Skipping dLend rewards manager deployment.",
    );
    return;
  }

  // --- Validation Loop ---
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const rewardManagerConfig = instanceConfig.dLendRewardManager as
      | DLendRewardManagerConfig
      | undefined;

    if (!rewardManagerConfig) {
      throw new Error(
        `dLendRewardManager not configured for dSTAKE instance ${instanceKey}.`,
      );
    }

    // Fetch required addresses *within* the deploy script execution flow,
    // ensuring dependencies have been run.
    const incentivesProxyDeployment =
      await deployments.get(INCENTIVES_PROXY_ID);

    // Fetch the AaveProtocolDataProvider and get the aToken address for this instance's underlying stablecoin
    const underlyingStablecoinAddress = instanceConfig.dStable;
    const poolDataProviderDeployment = await deployments.get(
      POOL_DATA_PROVIDER_ID,
    );
    const poolDataProviderContract = await ethers.getContractAt(
      "AaveProtocolDataProvider",
      poolDataProviderDeployment.address,
    );
    const reserveTokens =
      await poolDataProviderContract.getReserveTokensAddresses(
        underlyingStablecoinAddress,
      );
    const aTokenAddress = reserveTokens.aTokenAddress;

    const {
      // Destructure from config AFTER potentially fetching addresses
      managedVaultAsset,
      // dLendAssetToClaimFor, // Removed from destructuring, fetched above
      // dLendRewardsController, // Removed from destructuring, fetched above
      treasury,
      maxTreasuryFeeBps,
      initialTreasuryFeeBps,
      initialExchangeThreshold,
    } = rewardManagerConfig;

    // Use fetched addresses and original config values for validation
    if (
      !managedVaultAsset ||
      managedVaultAsset === ethers.ZeroAddress ||
      !aTokenAddress ||
      aTokenAddress === ethers.ZeroAddress ||
      !incentivesProxyDeployment.address ||
      incentivesProxyDeployment.address === ethers.ZeroAddress ||
      !treasury ||
      treasury === ethers.ZeroAddress
    ) {
      // Log specific missing address for better debugging
      let missing = [];
      if (!managedVaultAsset || managedVaultAsset === ethers.ZeroAddress)
        missing.push("managedVaultAsset");
      if (!aTokenAddress || aTokenAddress === ethers.ZeroAddress)
        missing.push("dLendAssetToClaimFor (aToken)");
      if (
        !incentivesProxyDeployment.address ||
        incentivesProxyDeployment.address === ethers.ZeroAddress
      )
        missing.push("dLendRewardsController (IncentivesProxy)");
      if (!treasury || treasury === ethers.ZeroAddress)
        missing.push("treasury");

      throw new Error(
        `Missing critical addresses in dLendRewardManager config for ${instanceKey}: ${missing.join(", ")}`,
      );
    }

    if (
      typeof maxTreasuryFeeBps !== "number" ||
      maxTreasuryFeeBps < 0 ||
      typeof initialTreasuryFeeBps !== "number" ||
      initialTreasuryFeeBps < 0 ||
      typeof initialExchangeThreshold !== "bigint" ||
      initialExchangeThreshold < 0n
    ) {
      throw new Error(
        `Invalid fee/threshold numbers in dLendRewardManager config for ${instanceKey}.`,
      );
    }

    // The config loop serves as validation, the actual deployment logic will be outside
    // or modified to use the already fetched addresses.
  }

  // Actual deployment logic using fetched addresses
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const rewardManagerConfig =
      instanceConfig.dLendRewardManager as DLendRewardManagerConfig;

    if (!rewardManagerConfig) {
      console.log(
        `No dLendRewardManager configuration for dSTAKE instance ${instanceKey}. Skipping.`,
      );
      continue;
    }

    if (
      !rewardManagerConfig.managedVaultAsset ||
      rewardManagerConfig.managedVaultAsset === ethers.ZeroAddress
    ) {
      console.warn(
        `Skipping dLend rewards for ${instanceKey}: missing managedVaultAsset in rewardManagerConfig.`,
      );
      continue;
    }

    const collateralVaultDeployment = await get(
      `DStakeCollateralVault_${instanceKey}`,
    );
    const dStakeCollateralVaultAddress = collateralVaultDeployment.address;
    const routerDeployment = await get(`DStakeRouter_${instanceKey}`);
    const dStakeRouterAddress = routerDeployment.address;

    const targetStaticATokenWrapperAddress =
      rewardManagerConfig.managedVaultAsset;
    const underlyingStablecoinAddress = instanceConfig.dStable; // from parent DStakeInstanceConfig

    const incentivesProxyDeployment =
      await deployments.get(INCENTIVES_PROXY_ID);

    const poolDataProviderDeployment = await deployments.get(
      POOL_DATA_PROVIDER_ID,
    );
    const poolDataProviderContract = await ethers.getContractAt(
      "AaveProtocolDataProvider",
      poolDataProviderDeployment.address,
    );
    const reserveTokens =
      await poolDataProviderContract.getReserveTokensAddresses(
        underlyingStablecoinAddress,
      );
    const dLendAssetToClaimForAddress = reserveTokens.aTokenAddress;

    if (dLendAssetToClaimForAddress === ethers.ZeroAddress) {
      console.warn(
        `Skipping dLend rewards for ${instanceKey}: could not find aToken for underlying stable ${underlyingStablecoinAddress}.`,
      );
      continue;
    }

    const deployArgs = [
      dStakeCollateralVaultAddress,
      dStakeRouterAddress,
      incentivesProxyDeployment.address, // dLendRewardsController
      targetStaticATokenWrapperAddress, // targetStaticATokenWrapper
      dLendAssetToClaimForAddress, // dLendAssetToClaimFor (the actual aToken)
      rewardManagerConfig.treasury,
      rewardManagerConfig.maxTreasuryFeeBps,
      rewardManagerConfig.initialTreasuryFeeBps,
      rewardManagerConfig.initialExchangeThreshold,
    ];

    const rewardManagerDeploymentName = `DStakeRewardManagerDLend_${instanceKey}`;
    const deployment = await deploy(rewardManagerDeploymentName, {
      from: deployer,
      contract: "DStakeRewardManagerDLend",
      args: deployArgs,
      log: true,
      skipIfAlreadyDeployed: true,
    });

    // Authorize this manager as a claimer via EmissionManager
    const deployerSigner = await ethers.getSigner(deployer);
    const emissionManagerDeployment =
      await deployments.get(EMISSION_MANAGER_ID);
    const emissionManager = await ethers.getContractAt(
      "EmissionManager",
      emissionManagerDeployment.address,
    );

    // Attempt to authorize this manager as a claimer via EmissionManager only if the deployer is the owner.
    const emissionOwner = await emissionManager.owner();

    if (emissionOwner.toLowerCase() === deployer.toLowerCase()) {
      const tx = await emissionManager
        .connect(deployerSigner)
        .setClaimer(targetStaticATokenWrapperAddress, deployment.address);
      await tx.wait();
    } else {
      manualActions.push(
        `EmissionManager (${emissionManagerDeployment.address}).setClaimer(${targetStaticATokenWrapperAddress}, ${deployment.address})`,
      );
    }

    // --- Configure Roles ---
    if (deployment.address) {
      const rewardManager: DStakeRewardManagerDLend =
        await ethers.getContractAt(
          "DStakeRewardManagerDLend",
          deployment.address,
        );
      const DEFAULT_ADMIN_ROLE = await rewardManager.DEFAULT_ADMIN_ROLE();
      const REWARDS_MANAGER_ROLE = await rewardManager.REWARDS_MANAGER_ROLE();

      const targetAdmin =
        rewardManagerConfig.initialAdmin &&
        rewardManagerConfig.initialAdmin !== ethers.ZeroAddress
          ? rewardManagerConfig.initialAdmin
          : deployer;

      const targetRewardsManager =
        rewardManagerConfig.initialRewardsManager &&
        rewardManagerConfig.initialRewardsManager !== ethers.ZeroAddress
          ? rewardManagerConfig.initialRewardsManager
          : deployer;

      // The deployer needs DEFAULT_ADMIN_ROLE to change roles. If not, just log what needs to be done.
      const deployerIsAdmin = await rewardManager.hasRole(
        DEFAULT_ADMIN_ROLE,
        deployer,
      );

      if (!deployerIsAdmin) {
        manualActions.push(
          `RewardManager (${deployment.address}) role setup: grantRole(DEFAULT_ADMIN_ROLE, ${targetAdmin}); grantRole(REWARDS_MANAGER_ROLE, ${targetRewardsManager}); optionally revoke roles from ${deployer}`,
        );
      } else {
        // Grant and revoke roles as necessary
        if (targetRewardsManager !== deployer) {
          if (
            !(await rewardManager.hasRole(
              REWARDS_MANAGER_ROLE,
              targetRewardsManager,
            ))
          ) {
            await rewardManager.grantRole(
              REWARDS_MANAGER_ROLE,
              targetRewardsManager,
            );
            console.log(
              `          Granted REWARDS_MANAGER_ROLE to ${targetRewardsManager}`,
            );
          }

          if (await rewardManager.hasRole(REWARDS_MANAGER_ROLE, deployer)) {
            await rewardManager.revokeRole(REWARDS_MANAGER_ROLE, deployer);
            console.log(
              `          Revoked REWARDS_MANAGER_ROLE from ${deployer}`,
            );
          }
        } else {
          if (!(await rewardManager.hasRole(REWARDS_MANAGER_ROLE, deployer))) {
            await rewardManager.grantRole(REWARDS_MANAGER_ROLE, deployer);
            console.log(
              `          Granted REWARDS_MANAGER_ROLE to ${deployer}`,
            );
          }
        }
      }

      if (targetAdmin !== deployer) {
        if (!(await rewardManager.hasRole(DEFAULT_ADMIN_ROLE, targetAdmin))) {
          await rewardManager.grantRole(DEFAULT_ADMIN_ROLE, targetAdmin);
          console.log(`          Granted DEFAULT_ADMIN_ROLE to ${targetAdmin}`);
        }

        if (await rewardManager.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
          await rewardManager.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
          console.log(`          Revoked DEFAULT_ADMIN_ROLE from ${deployer}`);
        }
      } else {
        if (!(await rewardManager.hasRole(DEFAULT_ADMIN_ROLE, deployer))) {
          await rewardManager.grantRole(DEFAULT_ADMIN_ROLE, deployer);
          console.log(`          Granted DEFAULT_ADMIN_ROLE to ${deployer}`);
        }
      }
      console.log(`    Set up DStakeRewardManagerDLend for ${instanceKey}.`);
    }
  }

  // After processing all instances, print any manual steps that are required.
  if (manualActions.length > 0) {
    console.log(
      "\n⚠️  Manual actions required to finalize dLend rewards deployment:",
    );
    manualActions.forEach((a: string) => console.log(`   - ${a}`));
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
// Define tags and dependencies
func.tags = ["dStakeDLendRewards", "dStake"];
func.dependencies = ["dStakeConfigure"];

// Mark as executed once.
func.id = "dstake_dlend_rewards";
func.runAtTheEnd = true;
