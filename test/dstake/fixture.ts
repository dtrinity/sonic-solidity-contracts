import { BigNumberish, ethers } from "ethers";
import { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { ERC20 } from "../../typechain-types";
import { IERC20 } from "../../typechain-types/@openzeppelin/contracts/token/ERC20/IERC20";
import {
  DS_A_TOKEN_WRAPPER_ID,
  DUSD_A_TOKEN_WRAPPER_ID,
  EMISSION_MANAGER_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  PULL_REWARDS_TRANSFER_STRATEGY_ID,
  SDS_COLLATERAL_VAULT_ID,
  SDS_DSTAKE_TOKEN_ID,
  SDS_ROUTER_ID,
  SDUSD_COLLATERAL_VAULT_ID,
  SDUSD_DSTAKE_TOKEN_ID,
  SDUSD_ROUTER_ID,
} from "../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import {
  DS_CONFIG,
  DStableFixtureConfig,
  DUSD_CONFIG,
} from "../dstable/fixtures";

export interface DStakeFixtureConfig {
  dStableSymbol: "dUSD" | "dS";
  DStakeTokenSymbol: string;
  DStakeTokenContractId: string;
  collateralVaultContractId: string;
  routerContractId: string;
  defaultVaultAssetSymbol: string;
  name?: string;
  underlyingDStableConfig: DStableFixtureConfig;
  deploymentTags: string[];
}

export const SDUSD_CONFIG: DStakeFixtureConfig = {
  dStableSymbol: "dUSD",
  DStakeTokenSymbol: "sdUSD",
  DStakeTokenContractId: SDUSD_DSTAKE_TOKEN_ID,
  collateralVaultContractId: SDUSD_COLLATERAL_VAULT_ID,
  routerContractId: SDUSD_ROUTER_ID,
  defaultVaultAssetSymbol: "wddUSD",
  underlyingDStableConfig: DUSD_CONFIG,
  deploymentTags: [
    "local-setup", // mock tokens and oracles
    "oracle", // mock oracle setup uses this tag
    "dusd", // underlying dStable token tag
    "dUSD-aTokenWrapper", // static aToken wrapper for dUSD
    "dlend", // dLend core and periphery
    "dStake", // dStake core, adapters, and configuration
    "ds", // Required by the Redstone plain feed setup
  ],
};

export const SDS_CONFIG: DStakeFixtureConfig = {
  dStableSymbol: "dS",
  DStakeTokenSymbol: "sdS",
  DStakeTokenContractId: SDS_DSTAKE_TOKEN_ID,
  collateralVaultContractId: SDS_COLLATERAL_VAULT_ID,
  routerContractId: SDS_ROUTER_ID,
  defaultVaultAssetSymbol: "wdS",
  underlyingDStableConfig: DS_CONFIG,
  deploymentTags: [
    "local-setup",
    "oracle",
    "ds",
    "dS-aTokenWrapper",
    "dlend",
    "dStake",
  ],
};

// Array of all DStake configurations
export const DSTAKE_CONFIGS: DStakeFixtureConfig[] = [SDUSD_CONFIG, SDS_CONFIG];

// Core logic for fetching dStake components *after* deployments are done
/**
 *
 * @param hreElements
 * @param hreElements.deployments
 * @param hreElements.getNamedAccounts
 * @param hreElements.ethers
 * @param hreElements.globalHre
 * @param config
 */
async function fetchDStakeComponents(
  hreElements: {
    deployments: HardhatRuntimeEnvironment["deployments"];
    getNamedAccounts: HardhatRuntimeEnvironment["getNamedAccounts"];
    ethers: HardhatRuntimeEnvironment["ethers"];
    globalHre: HardhatRuntimeEnvironment; // For getTokenContractForSymbol
  },
  config: DStakeFixtureConfig,
) {
  const { deployments, getNamedAccounts, ethers, globalHre } = hreElements;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  const { contract: dStableToken, tokenInfo: dStableInfo } =
    await getTokenContractForSymbol(globalHre, deployer, config.dStableSymbol);

  const DStakeToken = await ethers.getContractAt(
    "DStakeToken",
    (await deployments.get(config.DStakeTokenContractId)).address,
  );

  const collateralVault = await ethers.getContractAt(
    "DStakeCollateralVault",
    (await deployments.get(config.collateralVaultContractId)).address,
  );

  const router = await ethers.getContractAt(
    "DStakeRouterDLend",
    (await deployments.get(config.routerContractId)).address,
  );

  const wrappedATokenAddress = (
    await deployments.get(
      config.dStableSymbol === "dUSD"
        ? DUSD_A_TOKEN_WRAPPER_ID
        : DS_A_TOKEN_WRAPPER_ID,
    )
  ).address;
  const wrappedAToken = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    wrappedATokenAddress,
  );

  const vaultAssetAddress = wrappedATokenAddress;
  let adapterAddress;
  let adapter;
  adapterAddress = await router.vaultAssetToAdapter(vaultAssetAddress);

  if (adapterAddress !== ethers.ZeroAddress) {
    adapter = await ethers.getContractAt(
      "IDStableConversionAdapter",
      adapterAddress,
    );
  } else {
    adapter = null;
  }

  return {
    config,
    DStakeToken,
    collateralVault,
    router,
    dStableToken: dStableToken as unknown as ERC20,
    dStableInfo,
    vaultAssetToken: wrappedAToken as unknown as IERC20,
    vaultAssetAddress,
    adapter,
    adapterAddress,
    deployer: deployerSigner,
  };
}

// Main fixture setup function to be called from tests
/**
 *
 * @param hreElements
 * @param hreElements.deployments
 * @param hreElements.ethers
 * @param hreElements.getNamedAccounts
 * @param hreElements.globalHre
 * @param config
 * @param rewardTokenSymbol
 * @param rewardAmount
 * @param emissionPerSecondSetting
 * @param distributionDuration
 */
export async function executeSetupDLendRewards(
  hreElements: {
    deployments: HardhatRuntimeEnvironment["deployments"];
    ethers: HardhatRuntimeEnvironment["ethers"];
    getNamedAccounts: HardhatRuntimeEnvironment["getNamedAccounts"];
    globalHre: HardhatRuntimeEnvironment; // For helpers
  },
  config: DStakeFixtureConfig,
  rewardTokenSymbol: string,
  rewardAmount: BigNumberish,
  emissionPerSecondSetting?: BigNumberish, // Optional, with default below
  distributionDuration: number = 3600,
) {
  const { deployments, ethers, getNamedAccounts, globalHre } = hreElements;

  // Combine all necessary tags for a single deployment run
  const allDeploymentTags = [
    ...config.deploymentTags, // from SDUSD_CONFIG (includes local-setup, oracles, dStable, dlend, dStake)
    "dlend-static-wrapper-factory", // ensure static wrapper factory runs before static wrappers
    "dStakeRewards", // Tag for DStakeRewardManagerDLend deployment script and its dependencies
    // Add "dlend-static-wrapper-factory" if it's not reliably covered by dStake->dStakeAdapters dependency chain
    // However, the current setup should have dStake depend on dStakeAdapters, which depends on StaticATokenFactory
  ];

  // Single fixture execution for all deployments
  await deployments.fixture(allDeploymentTags);

  // Fetch base dStake components (now that all deployments are done)
  const dStakeBase = await fetchDStakeComponents(hreElements, config);
  const { deployer: signer } = dStakeBase; // deployer is an Ethers Signer

  // Get DStakeRewardManagerDLend related contracts
  const rewardManagerDeployment = await deployments.get(
    `DStakeRewardManagerDLend_${config.DStakeTokenSymbol}`,
  );
  const rewardManager = await ethers.getContractAt(
    "DStakeRewardManagerDLend",
    rewardManagerDeployment.address,
  );

  const targetStaticATokenWrapper =
    await rewardManager.targetStaticATokenWrapper();
  const dLendAssetToClaimFor = await rewardManager.dLendAssetToClaimFor();

  const { contract: rewardToken, tokenInfo: rewardTokenInfo } =
    await getTokenContractForSymbol(
      globalHre,
      signer.address,
      rewardTokenSymbol,
    );

  // Get EmissionManager and RewardsController instances
  const emissionManagerDeployment = await deployments.get(EMISSION_MANAGER_ID);
  const emissionManager = await ethers.getContractAt(
    "EmissionManager",
    emissionManagerDeployment.address,
  );
  const incentivesProxy = await deployments.get(INCENTIVES_PROXY_ID);
  const rewardsController = await ethers.getContractAt(
    "RewardsController",
    incentivesProxy.address,
  );

  // For configureAssets, deployer (owner of EmissionManager) must set itself as emission admin for the reward token first
  await emissionManager
    .connect(signer)
    .setEmissionAdmin(rewardTokenInfo.address, signer.address);

  const transferStrategyAddress = (
    await deployments.get(PULL_REWARDS_TRANSFER_STRATEGY_ID)
  ).address;
  const block = (await ethers.provider.getBlock("latest"))!;
  const distributionEnd = block.timestamp + distributionDuration;
  const poolAddressesProviderDeployment = await deployments.get(
    POOL_ADDRESSES_PROVIDER_ID,
  );
  const poolAddressesProvider = await ethers.getContractAt(
    "PoolAddressesProvider",
    poolAddressesProviderDeployment.address,
  );
  const rewardOracle = await poolAddressesProvider.getPriceOracle();

  const emissionPerSecond =
    emissionPerSecondSetting ??
    ethers.parseUnits("1", rewardTokenInfo.decimals ?? 18);

  // Call configureAssets via EmissionManager, now that signer is emissionAdmin for the rewardToken
  await emissionManager.connect(signer).configureAssets([
    {
      asset: dLendAssetToClaimFor,
      reward: rewardTokenInfo.address,
      transferStrategy: transferStrategyAddress,
      rewardOracle,
      emissionPerSecond,
      distributionEnd,
      totalSupply: 0, // This is usually fetched or calculated, 0 for new setup
    },
  ]);

  // Cast to ERC20 for token operations
  const rewardTokenERC20 = rewardToken as unknown as ERC20;

  // Fund the rewards vault for PullRewardsTransferStrategy and approve
  const pullStrategy = await ethers.getContractAt(
    "IPullRewardsTransferStrategy",
    transferStrategyAddress,
  );
  const rewardsVault = await pullStrategy.getRewardsVault();
  // Transfer reward tokens to the vault address
  await rewardTokenERC20.connect(signer).transfer(rewardsVault, rewardAmount);
  // Approve the PullRewardsTransferStrategy to pull rewards from the vault
  const vaultSigner = await ethers.getSigner(rewardsVault);
  await rewardTokenERC20
    .connect(vaultSigner)
    .approve(transferStrategyAddress, rewardAmount);

  return {
    ...dStakeBase,
    rewardManager,
    rewardsController,
    rewardToken,
    targetStaticATokenWrapper,
    dLendAssetToClaimFor,
  };
}

export const createDStakeFixture = (config: DStakeFixtureConfig) => {
  return deployments.createFixture(
    async (hreFixtureEnv: HardhatRuntimeEnvironment) => {
      // Clean slate: run all default deployment scripts
      await hreFixtureEnv.deployments.fixture();
      // Run DStake-specific deployment tags
      await hreFixtureEnv.deployments.fixture(config.deploymentTags);
      // Fetch DStake components using fixture environment
      return fetchDStakeComponents(
        {
          deployments: hreFixtureEnv.deployments,
          getNamedAccounts: hreFixtureEnv.getNamedAccounts,
          ethers: hreFixtureEnv.ethers,
          globalHre: hreFixtureEnv,
        },
        config,
      );
    },
  );
};

export const setupDLendRewardsFixture = (
  config: DStakeFixtureConfig,
  rewardTokenSymbol: string,
  rewardAmount: BigNumberish,
  emissionPerSecond?: BigNumberish,
  distributionDuration: number = 3600,
) =>
  deployments.createFixture(
    async (hreFixtureEnv: HardhatRuntimeEnvironment) => {
      // Execute DStake rewards setup, which includes its own deployments.fixture(allDeploymentTags)
      // Don't run all deployments to avoid interference from RedeemerWithFees
      return executeSetupDLendRewards(
        {
          deployments: hreFixtureEnv.deployments,
          ethers: hreFixtureEnv.ethers,
          getNamedAccounts: hreFixtureEnv.getNamedAccounts,
          globalHre: hreFixtureEnv,
        },
        config,
        rewardTokenSymbol,
        rewardAmount,
        emissionPerSecond,
        distributionDuration,
      );
    },
  );

// Pre-bound SDUSD rewards fixture for tests
export const SDUSDRewardsFixture = setupDLendRewardsFixture(
  SDUSD_CONFIG,
  "sfrxUSD",
  ethers.parseUnits("100", 6), // total reward amount
  ethers.parseUnits("1", 6), // emission per second (1 token/sec in 6-decimals)
);

// Pre-bound SDS rewards fixture for table-driven tests
export const SDSRewardsFixture = setupDLendRewardsFixture(
  SDS_CONFIG,
  "stS",
  ethers.parseUnits("100", 18),
);
