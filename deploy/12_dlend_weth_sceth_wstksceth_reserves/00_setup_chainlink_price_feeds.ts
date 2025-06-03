import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

// Helper function to perform sanity checks on oracle wrappers
/**
 * Performs sanity checks on oracle wrapper feeds by verifying normalized prices are within a reasonable range.
 * This function is specifically for ETH assets and expects prices in the range [1000, 4000] USD.
 *
 * @param wrapper The oracle wrapper contract instance.
 * @param feeds A record mapping asset addresses to feed configurations.
 * @param baseCurrencyUnit The base currency unit for price calculations.
 * @param wrapperName The name of the wrapper for logging purposes.
 * @returns void
 */
async function performOracleSanityChecks(
  wrapper: any,
  feeds: Record<string, any>,
  baseCurrencyUnit: bigint,
  wrapperName: string,
): Promise<void> {
  // ETH assets should be priced in USD range [1000, 4000]
  const minPrice = 1000;
  const maxPrice = 4000;

  for (const [assetAddress] of Object.entries(feeds)) {
    try {
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < minPrice || normalizedPrice > maxPrice) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the ETH range [${minPrice}, ${maxPrice}]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the ETH range [${minPrice}, ${maxPrice}]`,
        );
      } else {
        console.log(
          `Sanity check passed for asset ${assetAddress} in ${wrapperName}: Normalized price is ${normalizedPrice} (ETH range: [${minPrice}, ${maxPrice}])`,
        );
      }
    } catch (error) {
      console.error(
        `Error performing sanity check for asset ${assetAddress} in ${wrapperName}:`,
        error,
      );
      throw new Error(
        `Error performing sanity check for asset ${assetAddress} in ${wrapperName}: ${error}`,
      );
    }
  }
}

/**
 * Setup composite feeds for a list of asset addresses
 *
 * @param assetAddresses Array of asset addresses to setup composite feeds for
 * @param config Network configuration
 * @param redstoneCompositeWrapper The composite wrapper contract
 * @param oracleAggregator The oracle aggregator contract
 * @param baseCurrencyUnit The base currency unit for calculations
 * @returns Promise<boolean> True if all setups were successful
 */
async function setupCompositeFeedsForAssets(
  assetAddresses: string[],
  config: any,
  redstoneCompositeWrapper: any,
  oracleAggregator: any,
  baseCurrencyUnit: bigint,
): Promise<boolean> {
  const allCompositeFeeds =
    config.oracleAggregators.USD.redstoneOracleAssets
      ?.compositeRedstoneOracleWrappersWithThresholding || {};

  let allSuccessful = true;

  for (const assetAddress of assetAddresses) {
    const feedConfig = allCompositeFeeds[assetAddress];

    if (!feedConfig) {
      console.log(
        `⚠️  No composite feed configuration found for asset ${assetAddress}. Skipping.`,
      );
      continue;
    }

    // Check if composite feed already exists
    const existingFeed =
      await redstoneCompositeWrapper.compositeFeeds(assetAddress);

    if (existingFeed.feed1 !== ZeroAddress) {
      console.log(
        `- Composite feed for asset ${assetAddress} already configured. Skipping setup.`,
      );
      continue;
    }

    console.log(
      `- Composite feed for asset ${assetAddress} not found. Proceeding with setup...`,
    );

    // Perform sanity check for the asset feed
    try {
      await performOracleSanityChecks(
        redstoneCompositeWrapper,
        { [assetAddress]: feedConfig },
        baseCurrencyUnit,
        `${assetAddress} composite feed`,
      );
    } catch (error) {
      console.error(`❌ Sanity check failed for asset ${assetAddress}:`, error);
      allSuccessful = false;
      continue;
    }

    console.log(`- Adding composite feed for asset ${assetAddress}...`);

    try {
      await redstoneCompositeWrapper.addCompositeFeed(
        feedConfig.feedAsset,
        feedConfig.feed1,
        feedConfig.feed2,
        feedConfig.lowerThresholdInBase1,
        feedConfig.fixedPriceInBase1,
        feedConfig.lowerThresholdInBase2,
        feedConfig.fixedPriceInBase2,
      );
      console.log(`✅ Set composite Redstone feed for asset ${assetAddress}`);
    } catch (error) {
      console.error(
        `❌ Error adding composite feed for ${assetAddress}:`,
        error,
      );
      allSuccessful = false;
      continue;
    }

    try {
      await oracleAggregator.setOracle(
        feedConfig.feedAsset,
        redstoneCompositeWrapper.target,
      );
      console.log(
        `✅ Set composite Redstone wrapper for asset ${feedConfig.feedAsset} to ${redstoneCompositeWrapper.target}`,
      );
    } catch (error) {
      console.error(`❌ Error setting oracle for ${assetAddress}:`, error);
      allSuccessful = false;
      continue;
    }
  }

  return allSuccessful;
}

/**
 * Setup simple redstone feeds with thresholding for a list of asset addresses
 *
 * @param assetAddresses Array of asset addresses to setup simple feeds for
 * @param config Network configuration
 * @param redstoneWrapper The redstone wrapper contract
 * @param oracleAggregator The oracle aggregator contract
 * @param baseCurrencyUnit The base currency unit for calculations
 * @returns Promise<boolean> True if all setups were successful
 */
async function setupSimpleFeedsForAssets(
  assetAddresses: string[],
  config: any,
  redstoneWrapper: any,
  oracleAggregator: any,
  baseCurrencyUnit: bigint,
): Promise<boolean> {
  const allSimpleFeeds =
    config.oracleAggregators.USD.redstoneOracleAssets
      ?.redstoneOracleWrappersWithThresholding || {};

  let allSuccessful = true;

  for (const assetAddress of assetAddresses) {
    const feedConfig = allSimpleFeeds[assetAddress];

    if (!feedConfig) {
      console.log(
        `⚠️  No simple feed configuration found for asset ${assetAddress}. Skipping.`,
      );
      continue;
    }

    // Check if feed already exists
    const existingFeed = await redstoneWrapper.thresholdFeeds(assetAddress);

    if (existingFeed.feed !== ZeroAddress) {
      console.log(
        `- Simple feed for asset ${assetAddress} already configured. Skipping setup.`,
      );
      continue;
    }

    console.log(
      `- Simple feed for asset ${assetAddress} not found. Proceeding with setup...`,
    );

    // Perform sanity check for the asset feed
    try {
      await performOracleSanityChecks(
        redstoneWrapper,
        { [assetAddress]: feedConfig },
        baseCurrencyUnit,
        `${assetAddress} simple feed`,
      );
    } catch (error) {
      console.error(`❌ Sanity check failed for asset ${assetAddress}:`, error);
      allSuccessful = false;
      continue;
    }

    console.log(`- Adding simple feed for asset ${assetAddress}...`);

    try {
      await redstoneWrapper.addThresholdFeed(
        assetAddress,
        feedConfig.feed,
        feedConfig.lowerThreshold,
        feedConfig.fixedPrice,
      );
      console.log(`✅ Set simple Redstone feed for asset ${assetAddress}`);
    } catch (error) {
      console.error(`❌ Error adding simple feed for ${assetAddress}:`, error);
      allSuccessful = false;
      continue;
    }

    try {
      await oracleAggregator.setOracle(assetAddress, redstoneWrapper.target);
      console.log(
        `✅ Set simple Redstone wrapper for asset ${assetAddress} to ${redstoneWrapper.target}`,
      );
    } catch (error) {
      console.error(`❌ Error setting oracle for ${assetAddress}:`, error);
      allSuccessful = false;
      continue;
    }
  }

  return allSuccessful;
}

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Define the assets to setup - categorized by feed type
  const compositeFeedAssets = [config.tokenAddresses.wstkscETH].filter(Boolean);

  const simpleFeedAssets = [
    config.tokenAddresses.WETH,
    config.tokenAddresses.scETH,
  ].filter(Boolean);

  if (compositeFeedAssets.length === 0 && simpleFeedAssets.length === 0) {
    console.log("No assets configured for oracle feed setup. Exiting.");
    return true;
  }

  const deployerSigner = await hre.ethers.getSigner(deployer);
  const oracleAggregatorDeployment = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  if (!oracleAggregatorDeployment) {
    throw new Error("USD OracleAggregator deployment not found");
  }

  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorDeployment.address,
    deployerSigner,
  );

  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);

  let overallSuccess = true;

  // Setup composite feeds
  if (compositeFeedAssets.length > 0) {
    const { address: redstoneCompositeWrapperAddress } =
      await hre.deployments.get(
        USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
      );

    if (!redstoneCompositeWrapperAddress) {
      throw new Error(
        "RedstoneChainlinkCompositeWrapperWithThresholding artifact not found",
      );
    }

    const redstoneCompositeWrapper = await hre.ethers.getContractAt(
      "RedstoneChainlinkCompositeWrapperWithThresholding",
      redstoneCompositeWrapperAddress,
      deployerSigner,
    );

    console.log(
      `🔮 Setting up composite feeds for ${compositeFeedAssets.length} assets...`,
    );

    const compositeSuccess = await setupCompositeFeedsForAssets(
      compositeFeedAssets,
      config,
      redstoneCompositeWrapper,
      oracleAggregator,
      baseCurrencyUnit,
    );

    overallSuccess = overallSuccess && compositeSuccess;
  }

  // Setup simple feeds
  if (simpleFeedAssets.length > 0) {
    const { address: redstoneWrapperAddress } = await hre.deployments.get(
      USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
    );

    if (!redstoneWrapperAddress) {
      throw new Error("RedstoneWrapperWithThresholding artifact not found");
    }

    const redstoneWrapper = await hre.ethers.getContractAt(
      "RedstoneWrapperWithThresholding",
      redstoneWrapperAddress,
      deployerSigner,
    );

    console.log(
      `🔮 Setting up simple feeds for ${simpleFeedAssets.length} assets...`,
    );

    const simpleSuccess = await setupSimpleFeedsForAssets(
      simpleFeedAssets,
      config,
      redstoneWrapper,
      oracleAggregator,
      baseCurrencyUnit,
    );

    overallSuccess = overallSuccess && simpleSuccess;
  }

  if (overallSuccess) {
    console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  } else {
    console.log(
      `🔮 ${__filename.split("/").slice(-2).join("/")}: ⚠️  Some setups failed`,
    );
  }

  return overallSuccess;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-redstone-oracle-wrapper",
  "weth-sceth-wstksceth-chainlink-composite-feed",
];
func.dependencies = [
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "setup-weth-sceth-wstksceth-for-usd-oracle-wrapper";

export default func;
