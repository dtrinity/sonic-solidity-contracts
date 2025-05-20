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
  DS_A_TOKEN_WRAPPER_ID,
  DUSD_A_TOKEN_WRAPPER_ID,
  DUSD_TOKEN_ID,
  INCENTIVES_PROXY_ID,
  POOL_DATA_PROVIDER_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log(
      "No dStake configuration found for this network. Skipping dLend rewards manager deployment."
    );
    return;
  }

  // --- Validation Loop ---
  for (const instanceKey in config.dStake) {
    if (instanceKey !== "sdUSD") continue; // Only process sdUSD for now based on the test failure

    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const rewardManagerConfig = instanceConfig.dLendRewardManager as
      | DLendRewardManagerConfig
      | undefined;

    if (!rewardManagerConfig) {
      throw new Error(
        `dLendRewardManager not configured for dSTAKE instance ${instanceKey}.`
      );
    }

    // Fetch required addresses *within* the deploy script execution flow,
    // ensuring dependencies have been run.
    const incentivesProxyDeployment =
      await deployments.get(INCENTIVES_PROXY_ID);

    // Fetch the dUSD token address from deployments (it should be available via the 'dusd' tag)
    const dusdTokenDeployment = await deployments.get(DUSD_TOKEN_ID);
    const dusdTokenAddress = dusdTokenDeployment.address;

    // Fetch the AaveProtocolDataProvider and get the aToken address for dUSD
    const poolDataProviderDeployment = await deployments.get(
      POOL_DATA_PROVIDER_ID
    );
    const poolDataProviderContract = await ethers.getContractAt(
      "AaveProtocolDataProvider",
      poolDataProviderDeployment.address
    );
    const reserveTokens =
      await poolDataProviderContract.getReserveTokensAddresses(
        dusdTokenAddress
      );
    const aTokenDUSDAddress = reserveTokens.aTokenAddress;

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
      !aTokenDUSDAddress || // Use fetched aToken address
      aTokenDUSDAddress === ethers.ZeroAddress || // Use fetched aToken address
      !incentivesProxyDeployment.address || // Use fetched address
      incentivesProxyDeployment.address === ethers.ZeroAddress || // Use fetched address
      !treasury ||
      treasury === ethers.ZeroAddress
    ) {
      // Log specific missing address for better debugging
      let missing = [];
      if (!managedVaultAsset || managedVaultAsset === ethers.ZeroAddress)
        missing.push("managedVaultAsset");
      if (!aTokenDUSDAddress || aTokenDUSDAddress === ethers.ZeroAddress)
        missing.push("dLendAssetToClaimFor (aToken)");
      if (
        !incentivesProxyDeployment.address ||
        incentivesProxyDeployment.address === ethers.ZeroAddress
      )
        missing.push("dLendRewardsController (IncentivesProxy)");
      if (!treasury || treasury === ethers.ZeroAddress)
        missing.push("treasury");

      throw new Error(
        `Missing critical addresses in dLendRewardManager config for ${instanceKey}: ${missing.join(", ")}`
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
        `Invalid fee/threshold numbers in dLendRewardManager config for ${instanceKey}.`
      );
    }

    // The config loop serves as validation, the actual deployment logic will be outside
    // or modified to use the already fetched addresses.
  }

  // Actual deployment logic using fetched addresses
  for (const instanceKey in config.dStake) {
    // Only process sdUSD for now based on the test failure
    if (instanceKey !== "sdUSD") continue;

    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const rewardManagerConfig =
      instanceConfig.dLendRewardManager as DLendRewardManagerConfig;

    const collateralVaultDeployment = await get(
      `DStakeCollateralVault_${instanceKey}`
    );
    const dStakeCollateralVaultAddress = collateralVaultDeployment.address;
    const routerDeployment = await get(`DStakeRouter_${instanceKey}`);
    const dStakeRouterAddress = routerDeployment.address;

    // Fetch dependencies again right before deployment to be safe
    const dLendATokenWrapperDUSDDeployment = await deployments.get(
      DUSD_A_TOKEN_WRAPPER_ID
    );
    const incentivesProxyDeployment =
      await deployments.get(INCENTIVES_PROXY_ID);

    // Fetch the dUSD token address
    const dusdTokenDeployment = await deployments.get(DUSD_TOKEN_ID);
    const dusdTokenAddress = dusdTokenDeployment.address;

    // Fetch the AaveProtocolDataProvider and get the aToken address for dUSD
    const poolDataProviderDeployment = await deployments.get(
      POOL_DATA_PROVIDER_ID
    );
    const poolDataProviderContract = await ethers.getContractAt(
      "AaveProtocolDataProvider",
      poolDataProviderDeployment.address
    );
    const reserveTokens =
      await poolDataProviderContract.getReserveTokensAddresses(
        dusdTokenAddress
      );
    const aTokenDUSDAddress = reserveTokens.aTokenAddress;

    const deployArgs = [
      dStakeCollateralVaultAddress,
      dStakeRouterAddress,
      incentivesProxyDeployment.address, // Use fetched address
      dLendATokenWrapperDUSDDeployment.address, // Use fetched address
      aTokenDUSDAddress, // Use fetched aToken address
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
          deployment.address
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
            targetRewardsManager
          ))
        ) {
          await rewardManager.grantRole(
            REWARDS_MANAGER_ROLE,
            targetRewardsManager
          );
          console.log(
            `          Granted REWARDS_MANAGER_ROLE to ${targetRewardsManager}`
          );
        }

        if (await rewardManager.hasRole(REWARDS_MANAGER_ROLE, deployer)) {
          await rewardManager.revokeRole(REWARDS_MANAGER_ROLE, deployer);
          console.log(
            `          Revoked REWARDS_MANAGER_ROLE from ${deployer}`
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
func.dependencies = [
  "dStakeCore",
  "dStakeAdapters",
  "dLendCore",
  "dlend-market",
  DUSD_A_TOKEN_WRAPPER_ID,
  DS_A_TOKEN_WRAPPER_ID,
  INCENTIVES_PROXY_ID,
  POOL_DATA_PROVIDER_ID,
  DUSD_TOKEN_ID,
];
func.runAtTheEnd = true;
