import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DLendRewardManagerConfig,
  DStakeInstanceConfig,
} from "../../config/types";
import { DStakeRewardManagerDLend } from "../../typechain-types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log(
      "No dStake configuration found for this network. Skipping dLend rewards manager deployment.",
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

    const {
      managedVaultAsset,
      dLendAssetToClaimFor,
      dLendRewardsController,
      treasury,
      maxTreasuryFeeBps,
      initialTreasuryFeeBps,
      initialExchangeThreshold,
    } = rewardManagerConfig;

    if (
      !managedVaultAsset ||
      managedVaultAsset === ethers.ZeroAddress ||
      !dLendAssetToClaimFor ||
      dLendAssetToClaimFor === ethers.ZeroAddress ||
      !dLendRewardsController ||
      dLendRewardsController === ethers.ZeroAddress ||
      !treasury ||
      treasury === ethers.ZeroAddress
    ) {
      throw new Error(
        `Missing critical addresses in dLendRewardManager config for ${instanceKey}.`,
      );
    }

    if (
      typeof maxTreasuryFeeBps !== "number" ||
      maxTreasuryFeeBps < 0 ||
      typeof initialTreasuryFeeBps !== "number" ||
      initialTreasuryFeeBps < 0 ||
      typeof initialExchangeThreshold !== "number" ||
      initialExchangeThreshold < 0
    ) {
      throw new Error(
        `Invalid fee/threshold numbers in dLendRewardManager config for ${instanceKey}.`,
      );
    }
  }

  // --- Deployment Loop ---
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const rewardManagerConfig =
      instanceConfig.dLendRewardManager as DLendRewardManagerConfig;

    const collateralVaultDeploymentName = `DStakeCollateralVault_${instanceKey}`;
    const routerDeploymentName = `DStakeRouter_${instanceKey}`;

    const collateralVaultDeployment = await get(collateralVaultDeploymentName);
    const dStakeCollateralVaultAddress = collateralVaultDeployment.address;
    const routerDeployment = await get(routerDeploymentName);
    const dStakeRouterAddress = routerDeployment.address;

    const deployArgs = [
      dStakeCollateralVaultAddress,
      dStakeRouterAddress,
      rewardManagerConfig.dLendRewardsController,
      rewardManagerConfig.managedVaultAsset,
      rewardManagerConfig.dLendAssetToClaimFor,
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
          console.log(`          Granted REWARDS_MANAGER_ROLE to ${deployer}`);
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
    }
    console.log(`    Set up DStakeRewardManagerDLend for ${instanceKey}.`);
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
// Define tags and dependencies
func.tags = ["DStakeRewardManagerDLend", "dStakeRewards", "dStakeConfig"];
func.dependencies = ["dStakeCore", "dStakeAdapters", "dLendCore"];
func.runAtTheEnd = true;
