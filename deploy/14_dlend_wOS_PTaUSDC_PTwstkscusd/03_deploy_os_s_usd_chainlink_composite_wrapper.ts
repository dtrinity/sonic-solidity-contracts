import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ChainlinkCompositeAggregatorConfig } from "../../config/types";

/**
 * This script deploys ChainlinkCompositeAggregator contracts to composite two Chainlink price feeds.
 *
 * For this deployment, we're creating OS/USD composite price feed by combining:
 * - OS/S price feed (sourceFeed1)
 * - S/USD price feed (sourceFeed2)
 *
 * The composite price is calculated as: (OS/S * S/USD) / baseCurrencyUnit
 *
 * Saved deployments:
 * - ChainlinkCompositeAggregator_{assetName} (e.g., ChainlinkCompositeAggregator_OS_USD)
 *
 * To reuse wrapper:
 * const wrapper = await hre.deployments.get("ChainlinkCompositeAggregator_OS_USD");
 * const wrapperContract = await hre.ethers.getContractAt("ChainlinkCompositeAggregator", wrapper.address);
 */

/**
 * Deploy ChainlinkCompositeAggregator contracts based on configuration
 *
 * @param hre - Hardhat runtime environment
 * @param configs - Configuration for composite aggregators
 */
async function deployChainlinkCompositeAggregators(
  hre: HardhatRuntimeEnvironment,
  configs: { [assetAddress: string]: ChainlinkCompositeAggregatorConfig },
): Promise<{ assetAddress: string; address: string }[]> {
  const { deployer } = await hre.getNamedAccounts();
  const { ethers } = hre;
  const results = [];

  for (const [assetAddress, config] of Object.entries(configs)) {
    console.log(
      `🔍 Processing ChainlinkCompositeAggregator for asset ${assetAddress}...`,
    );

    // Create deployment name
    const deploymentName = `ChainlinkCompositeAggregator_${config.name}`;

    try {
      // Check if wrapper is already deployed
      const existingDeployment = await hre.deployments.get(deploymentName);
      console.log(
        `♻️  Using existing ChainlinkCompositeAggregator for asset ${assetAddress}: ${existingDeployment.address}`,
      );
      results.push({
        assetAddress,
        address: existingDeployment.address,
      });
      continue;
    } catch {
      // Wrapper doesn't exist, deploy it
      console.log(
        `🚀 Deploying ChainlinkCompositeAggregator for asset ${assetAddress}...`,
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
      contract: "ChainlinkCompositeAggregator",
      args: [
        config.sourceFeed1,
        config.sourceFeed2,
        primaryThreshold,
        secondaryThreshold,
      ],
      autoMine: true,
      log: true,
    });

    const deployment = await hre.deployments.get(deploymentName);
    console.log(
      `✅ Deployed ChainlinkCompositeAggregator for asset ${assetAddress}: ${deployment.address}`,
    );

    // Verify the deployment by calling description
    try {
      const aggregatorContract = await ethers.getContractAt(
        "ChainlinkCompositeAggregator",
        deployment.address,
      );
      const description = await aggregatorContract.description();
      console.log(`📝 Aggregator description: ${description}`);
    } catch (error) {
      console.warn(`⚠️  Could not verify aggregator description: ${error}`);
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
    return true;
  }

  const chainlinkCompositeConfigs =
    usdOracleConfig.chainlinkCompositeAggregator;

  if (!chainlinkCompositeConfigs) {
    console.log(
      "❌ No ChainlinkCompositeAggregator configurations found in USD oracle aggregator",
    );
    return true;
  }

  console.log("🚀 Starting ChainlinkCompositeAggregator deployment...");
  console.log(
    `📊 Found ${Object.keys(chainlinkCompositeConfigs).length} composite aggregator configurations`,
  );

  try {
    const deployedAggregators = await deployChainlinkCompositeAggregators(
      hre,
      chainlinkCompositeConfigs,
    );

    console.log("\n📋 Deployment Summary:");
    console.log("======================");

    for (const aggregator of deployedAggregators) {
      console.log(`✅ Asset ${aggregator.assetAddress}: ${aggregator.address}`);
    }

    console.log(
      "\n🎉 ChainlinkCompositeAggregator deployment completed successfully!",
    );
    return true;
  } catch (error) {
    console.error("❌ ChainlinkCompositeAggregator deployment failed:", error);
    return false;
  }
};

func.tags = ["oracle", "chainlink-composite-aggregator", "os-s-usd"];
func.dependencies = [];
func.id = "ChainlinkCompositeAggregator_OS_S_USD";

export default func;
