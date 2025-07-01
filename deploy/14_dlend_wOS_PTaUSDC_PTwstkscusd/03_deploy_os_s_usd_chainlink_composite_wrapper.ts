import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ChainlinkCompositeWrapperConfig } from "../../config/types";
import {
  ORACLE_CHAINLINK_AGGREGATOR_BASE_CURRENCY_UNIT,
  ORACLE_CHAINLINK_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";

/**
 * This script deploys ChainlinkCompositeWrapper contracts to composite two Chainlink price feeds.
 *
 * For this deployment, we're creating OS/USD composite price feed by combining:
 * - OS/S price feed (sourceFeed1)
 * - S/USD price feed (sourceFeed2)
 *
 * The composite price is calculated as: (OS/S * S/USD) / baseCurrencyUnit
 *
 * Saved deployments:
 * - ChainlinkCompositeWrapper_{assetName} (e.g., ChainlinkCompositeWrapper_OS_USD)
 *
 * To reuse wrapper:
 * const wrapper = await hre.deployments.get("ChainlinkCompositeWrapper_OS_USD");
 * const wrapperContract = await hre.ethers.getContractAt("ChainlinkCompositeWrapper", wrapper.address);
 */

/**
 * Deploy ChainlinkCompositeWrapper contracts based on configuration
 *
 * @param hre - Hardhat runtime environment
 * @param configs - Configuration for composite wrappers
 */
async function deployChainlinkCompositeWrappers(
  hre: HardhatRuntimeEnvironment,
  configs: { [assetAddress: string]: ChainlinkCompositeWrapperConfig },
): Promise<{ assetAddress: string; address: string }[]> {
  const { deployer } = await hre.getNamedAccounts();
  const { ethers } = hre;
  const results = [];

  for (const [assetAddress, config] of Object.entries(configs)) {
    console.log(
      `🔍 Processing ChainlinkCompositeWrapper for asset ${assetAddress}...`,
    );

    // Create deployment name
    const deploymentName = `ChainlinkCompositeWrapper_${config.name}`;

    try {
      // Check if wrapper is already deployed
      const existingDeployment = await hre.deployments.get(deploymentName);
      console.log(
        `♻️  Using existing ChainlinkCompositeWrapper for asset ${assetAddress}: ${existingDeployment.address}`,
      );
      results.push({
        assetAddress,
        address: existingDeployment.address,
      });
      continue;
    } catch {
      // Wrapper doesn't exist, deploy it
      console.log(
        `🚀 Deploying ChainlinkCompositeWrapper for asset ${assetAddress}...`,
      );
    }

    // Prepare constructor arguments
    const primaryThreshold = {
      lowerThresholdInBase: config.lowerThresholdInBase1,
      fixedPriceInBase: config.fixedPriceInBase1,
    };

    const secondaryThreshold = {
      lowerThresholdInBase: config.lowerThresholdInBase2,
      fixedPriceInBase: config.fixedPriceInBase2,
    };

    // Deploy the composite wrapper
    await hre.deployments.deploy(deploymentName, {
      from: deployer,
      contract: "ChainlinkCompositeWrapper",
      args: [
        config.sourceFeed1,
        config.sourceFeed2,
        ORACLE_CHAINLINK_AGGREGATOR_PRICE_DECIMALS,
        ORACLE_CHAINLINK_AGGREGATOR_BASE_CURRENCY_UNIT,
        primaryThreshold,
        secondaryThreshold,
      ],
      autoMine: true,
      log: true,
    });

    const deployment = await hre.deployments.get(deploymentName);
    console.log(
      `✅ Deployed ChainlinkCompositeWrapper for asset ${assetAddress}: ${deployment.address}`,
    );

    // Verify the deployment by calling description
    try {
      const wrapperContract = await ethers.getContractAt(
        "ChainlinkCompositeWrapper",
        deployment.address,
      );
      const description = await wrapperContract.description();
      console.log(`📝 Wrapper description: ${description}`);
    } catch (error) {
      console.warn(`⚠️  Could not verify wrapper description: ${error}`);
    }

    results.push({
      assetAddress,
      address: deployment.address,
    });
  }

  return results;
}

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const config = await getConfig(hre);
  const { oracleAggregators } = config;

  // Find USD oracle aggregator configuration
  const usdOracleConfig = oracleAggregators.USD;

  if (!usdOracleConfig) {
    console.log("❌ No USD oracle aggregator configuration found");
    return false;
  }

  const chainlinkCompositeConfigs =
    usdOracleConfig.chainlinkCompositeWrapperAggregator;

  if (!chainlinkCompositeConfigs) {
    console.log(
      "❌ No ChainlinkCompositeWrapper configurations found in USD oracle aggregator",
    );
    return false;
  }

  console.log("🚀 Starting ChainlinkCompositeWrapper deployment...");
  console.log(
    `📊 Found ${Object.keys(chainlinkCompositeConfigs).length} composite wrapper configurations`,
  );

  try {
    const deployedWrappers = await deployChainlinkCompositeWrappers(
      hre,
      chainlinkCompositeConfigs,
    );

    console.log("\n📋 Deployment Summary:");
    console.log("======================");

    for (const wrapper of deployedWrappers) {
      console.log(`✅ Asset ${wrapper.assetAddress}: ${wrapper.address}`);
    }

    console.log(
      "\n🎉 ChainlinkCompositeWrapper deployment completed successfully!",
    );
    return true;
  } catch (error) {
    console.error("❌ ChainlinkCompositeWrapper deployment failed:", error);
    return false;
  }
};

func.tags = ["oracle", "chainlink-composite-wrapper", "os-s-usd"];
func.dependencies = [];
func.id = "ChainlinkCompositeWrapper_OS_S_USD";

export default func;
