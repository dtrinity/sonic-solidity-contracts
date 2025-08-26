import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { DLoopCoreConfig } from "../../../config/types";
import { assertNotEmpty } from "../../../typescript/common/assert";
import {
  DLEND_STATIC_A_TOKEN_FACTORY_ID,
  DLOOP_CORE_DLEND_ID,
  DLOOP_CORE_LOGIC_ID,
  DUSD_A_TOKEN_WRAPPER_ID,
  INCENTIVES_PROXY_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER_ID,
} from "../../../typescript/deploy-ids";
import { isLocalNetwork } from "../../../typescript/hardhat/deploy";

/**
 * Deploy dLOOP Core DLend contract
 *
 * @param hre - Hardhat runtime environment
 * @param deployer - The address of the deployer
 * @param dUSDAddress - The dUSD token address
 * @param vaultInfo - The vault information
 * @returns True if the deployment is successful
 */
async function deployDLoopCoreDLend(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  dUSDAddress: string,
  vaultInfo: DLoopCoreConfig,
): Promise<boolean> {
  const { address: lendingPoolAddressesProviderAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Get the incentives proxy (rewards controller)
  const incentivesProxyDeployment = await hre.deployments.get(INCENTIVES_PROXY_ID);

  // Get the pool data provider to fetch the aToken address
  const poolDataProviderDeployment = await hre.deployments.get(POOL_DATA_PROVIDER_ID);
  const poolDataProviderContract = await ethers.getContractAt("AaveProtocolDataProvider", poolDataProviderDeployment.address);

  // Get the aToken address for the underlying asset
  const reserveTokens = await poolDataProviderContract.getReserveTokensAddresses(vaultInfo.underlyingAsset);
  const aTokenAddress = reserveTokens.aTokenAddress;

  if (aTokenAddress === ethers.ZeroAddress) {
    throw new Error(`Could not find aToken for underlying asset ${vaultInfo.underlyingAsset}`);
  }

  const underlyingTokenContract = await hre.ethers.getContractAt(
    ["function symbol() view returns (string)"],
    vaultInfo.underlyingAsset,
    await hre.ethers.getSigner(deployer),
  );
  const underlyingTokenSymbol = await underlyingTokenContract.symbol();

  if (underlyingTokenSymbol === "") {
    throw new Error("The underlying token symbol is empty");
  }

  const deploymentName = `${DLOOP_CORE_DLEND_ID}-${vaultInfo.symbol}`;

  // Extract additional parameters from extraParams or use defaults
  const extraParams = vaultInfo.extraParams;

  if (!extraParams) {
    throw new Error("No extra parameters provided for dLOOP Core DLend");
  }

  // Resolve StaticAToken wrapper, fallback to deployment if not present in config
  let targetStaticATokenWrapperResolved = (extraParams.targetStaticATokenWrapper as string) || "";

  if (!targetStaticATokenWrapperResolved) {
    const wrapperDeployment = await hre.deployments.getOrNull(DUSD_A_TOKEN_WRAPPER_ID);

    if (wrapperDeployment?.address) {
      targetStaticATokenWrapperResolved = wrapperDeployment.address;
    }
  }

  // Final fallback on local: use the aToken address directly to unblock local testing
  // BUT only if we don't have a wrapper deployment
  if (!targetStaticATokenWrapperResolved && isLocalNetwork(hre.network.name)) {
    console.log(`Using aToken address as fallback for targetStaticATokenWrapper: ${aTokenAddress}`);
    targetStaticATokenWrapperResolved = aTokenAddress;
  }

  // Ensure we have a valid targetStaticATokenWrapper
  if (!targetStaticATokenWrapperResolved) {
    throw new Error(`targetStaticATokenWrapper is required but could not be resolved. aTokenAddress: ${aTokenAddress}`);
  }

  const targetStaticATokenWrapper = targetStaticATokenWrapperResolved;
  const treasury = assertNotEmpty(extraParams.treasury);
  const maxTreasuryFeeBps = extraParams.maxTreasuryFeeBps as number | bigint;
  const initialTreasuryFeeBps = (extraParams.initialTreasuryFeeBps as number | bigint) ?? 0;
  const initialExchangeThreshold = (extraParams.initialExchangeThreshold as number | bigint) ?? 0;

  // Log the deployment parameters for debugging
  console.log(`Deploying ${deploymentName} with parameters:`);
  console.log(`  name: ${assertNotEmpty(vaultInfo.name)}`);
  console.log(`  symbol: ${assertNotEmpty(vaultInfo.symbol)}`);
  console.log(`  collateralToken: ${assertNotEmpty(vaultInfo.underlyingAsset)}`);
  console.log(`  debtToken: ${assertNotEmpty(dUSDAddress)}`);
  console.log(`  lendingPoolAddressesProvider: ${assertNotEmpty(lendingPoolAddressesProviderAddress)}`);
  console.log(`  targetLeverageBps: ${vaultInfo.targetLeverageBps}`);
  console.log(`  lowerBoundTargetLeverageBps: ${vaultInfo.lowerBoundTargetLeverageBps}`);
  console.log(`  upperBoundTargetLeverageBps: ${vaultInfo.upperBoundTargetLeverageBps}`);
  console.log(`  maxSubsidyBps: ${vaultInfo.maxSubsidyBps}`);
  console.log(`  minDeviationBps: ${vaultInfo.minDeviationBps}`);
  console.log(`  withdrawalFeeBps: ${vaultInfo.withdrawalFeeBps}`);
  console.log(`  rewardsController: ${assertNotEmpty(incentivesProxyDeployment.address)}`);
  console.log(`  dLendAssetToClaimFor: ${assertNotEmpty(aTokenAddress)}`);
  console.log(`  targetStaticATokenWrapper: ${targetStaticATokenWrapper}`);
  console.log(`  treasury: ${assertNotEmpty(treasury)}`);
  console.log(`  maxTreasuryFeeBps: ${maxTreasuryFeeBps}`);
  console.log(`  initialTreasuryFeeBps: ${initialTreasuryFeeBps}`);
  console.log(`  initialExchangeThreshold: ${initialExchangeThreshold}`);

  await hre.deployments.deploy(deploymentName, {
    from: deployer,
    contract: "DLoopCoreDLend",
    args: [
      assertNotEmpty(vaultInfo.name),
      assertNotEmpty(vaultInfo.symbol),
      assertNotEmpty(vaultInfo.underlyingAsset),
      assertNotEmpty(dUSDAddress),
      assertNotEmpty(lendingPoolAddressesProviderAddress),
      vaultInfo.targetLeverageBps,
      vaultInfo.lowerBoundTargetLeverageBps,
      vaultInfo.upperBoundTargetLeverageBps,
      vaultInfo.maxSubsidyBps,
      vaultInfo.minDeviationBps,
      vaultInfo.withdrawalFeeBps,
      assertNotEmpty(incentivesProxyDeployment.address), // _rewardsController
      assertNotEmpty(aTokenAddress), // _dLendAssetToClaimFor
      targetStaticATokenWrapper, // _targetStaticATokenWrapper
      assertNotEmpty(treasury), // _treasury
      maxTreasuryFeeBps, // _maxTreasuryFeeBps
      initialTreasuryFeeBps, // _initialTreasuryFeeBps
      initialExchangeThreshold, // _initialExchangeThreshold
    ],
    log: true,
    autoMine: true,
    libraries: {
      DLoopCoreLogic: (await hre.deployments.get("DLoopCoreLogic")).address,
    },
  });

  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getChainId } = hre;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

  // Allow local deployments (do not skip on localhost/hardhat)
  // Get network config
  const networkConfig = await getConfig(hre);
  const dloopConfig = networkConfig.dLoop;

  // DLoopCoreLogic library should be deployed via dependency

  // Skip if no dLOOP configuration or no core vaults are defined
  if (!dloopConfig || !dloopConfig.coreVaults || Object.keys(dloopConfig.coreVaults).length === 0) {
    console.log(`No dLOOP core vaults defined for network ${hre.network.name}. Skipping.`);
    return;
  }

  // Get the dUSD token address from the configuration
  const dUSDAddress = dloopConfig.dUSDAddress;

  if (!dUSDAddress) {
    throw new Error("dUSD token address not found in configuration");
  }

  console.log(`Deploying dLOOP core vaults on network ${hre.network.name} (chainId: ${chainId})`);

  // Deploy each core vault
  for (const [vaultKey, vaultInfo] of Object.entries(dloopConfig.coreVaults)) {
    console.log(`Deploying dLOOP core vault: ${vaultKey}`);

    switch (vaultInfo.venue) {
      case "dlend":
        await deployDLoopCoreDLend(hre, deployer, dUSDAddress, vaultInfo);
        break;
      default:
        throw new Error(`Unsupported core vault venue: ${vaultInfo.venue}`);
    }
  }

  console.log("All dLOOP core vaults deployed successfully");

  return true;
};

func.tags = ["dloop", "core", "dlend"];
func.dependencies = [
  DLOOP_CORE_LOGIC_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  INCENTIVES_PROXY_ID,
  POOL_DATA_PROVIDER_ID,
  DLEND_STATIC_A_TOKEN_FACTORY_ID,
  "dStableATokenWrappers",
];
func.id = DLOOP_CORE_DLEND_ID;

export default func;
