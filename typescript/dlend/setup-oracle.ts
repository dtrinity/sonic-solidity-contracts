import { ZeroAddress } from "ethers";

// Helper function to perform sanity checks on oracle wrappers
/**
 * Performs sanity checks on oracle wrapper feeds by verifying normalized prices are within a reasonable range.
 *
 * @param wrapper The oracle wrapper contract instance.
 * @param feeds A record mapping asset addresses to feed configurations.
 * @param baseCurrencyUnit The base currency unit for price calculations.
 * @param wrapperName The name of the wrapper for logging purposes.
 * @param minPrice The minimum acceptable price.
 * @param maxPrice The maximum acceptable price.
 * @returns void
 */
export async function performOracleSanityChecks(
  wrapper: any,
  feeds: Record<string, any>,
  baseCurrencyUnit: bigint,
  wrapperName: string,
  minPrice: number,
  maxPrice: number,
): Promise<void> {
  for (const [assetAddress] of Object.entries(feeds)) {
    try {
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < minPrice || normalizedPrice > maxPrice) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [${minPrice}, ${maxPrice}]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [${minPrice}, ${maxPrice}]`,
        );
      } else {
        console.log(
          `Sanity check passed for asset ${assetAddress} in ${wrapperName}: Normalized price is ${normalizedPrice} (range: [${minPrice}, ${maxPrice}])`,
        );
      }
    } catch (error) {
      console.error(`Error performing sanity check for asset ${assetAddress} in ${wrapperName}:`, error);
      throw new Error(`Error performing sanity check for asset ${assetAddress} in ${wrapperName}: ${error}`);
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
 * @param minPrice The minimum acceptable price for sanity checks
 * @param maxPrice The maximum acceptable price for sanity checks
 * @param deployerAddress The deployer address for permission checks
 */
export async function setupRedstoneCompositeFeedsForAssets(
  assetAddresses: string[],
  config: any,
  redstoneCompositeWrapper: any,
  oracleAggregator: any,
  baseCurrencyUnit: bigint,
  minPrice: number,
  maxPrice: number,
  deployerAddress: string,
): Promise<void> {
  const allCompositeFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};

  for (const assetAddress of assetAddresses) {
    const feedConfig = allCompositeFeeds[assetAddress];

    if (!feedConfig) {
      console.log(`⚠️  No composite feed configuration found for asset ${assetAddress}. Skipping.`);
      continue;
    }

    // Check if composite feed already exists
    const existingFeed = await redstoneCompositeWrapper.compositeFeeds(assetAddress);

    if (existingFeed.feed1 !== ZeroAddress) {
      console.log(`- Composite feed for asset ${assetAddress} already configured. Skipping setup.`);
      continue;
    }

    console.log(`- Composite feed for asset ${assetAddress} not found. Proceeding with setup...`);

    // Check permissions before attempting to add feed
    try {
      const oracleManagerRole = await redstoneCompositeWrapper.ORACLE_MANAGER_ROLE();
      const hasRole = await redstoneCompositeWrapper.hasRole(oracleManagerRole, deployerAddress);
      console.log(`  - Deployer has ORACLE_MANAGER_ROLE: ${hasRole}`);

      if (!hasRole) {
        const errorMessage = `❌ Deployer (${deployerAddress}) lacks ORACLE_MANAGER_ROLE on RedstoneChainlinkCompositeWrapperWithThresholding (${redstoneCompositeWrapper.target}). Please grant this role before running the deployment.`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("lacks ORACLE_MANAGER_ROLE")) {
        throw error; // Re-throw our custom error
      }
      console.warn(`  - Could not check ORACLE_MANAGER_ROLE:`, error);
    }

    console.log(`- Adding composite feed for asset ${assetAddress}...`);
    console.log(`  - feedAsset: ${feedConfig.feedAsset}`);
    console.log(`  - feed1: ${feedConfig.feed1}`);
    console.log(`  - feed2: ${feedConfig.feed2}`);
    console.log(`  - lowerThresholdInBase1: ${feedConfig.lowerThresholdInBase1}`);
    console.log(`  - fixedPriceInBase1: ${feedConfig.fixedPriceInBase1}`);
    console.log(`  - lowerThresholdInBase2: ${feedConfig.lowerThresholdInBase2}`);
    console.log(`  - fixedPriceInBase2: ${feedConfig.fixedPriceInBase2}`);

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
      console.error(`❌ Error adding composite feed for ${assetAddress}:`, error);
      console.error(`   Feed config was:`, feedConfig);
      throw new Error(`Failed to add composite feed for ${assetAddress}: ${error}`);
    }

    try {
      await oracleAggregator.setOracle(feedConfig.feedAsset, redstoneCompositeWrapper.target);
      console.log(`✅ Set composite Redstone wrapper for asset ${feedConfig.feedAsset} to ${redstoneCompositeWrapper.target}`);
    } catch (error) {
      console.error(`❌ Error setting oracle for ${assetAddress}:`, error);
      throw new Error(`Failed to set oracle for ${assetAddress}: ${error}`);
    }

    // Perform sanity check AFTER the feed is set up
    console.log(`- Performing sanity check for asset ${assetAddress}...`);
    await performOracleSanityChecks(
      redstoneCompositeWrapper,
      { [assetAddress]: feedConfig },
      baseCurrencyUnit,
      `${assetAddress} composite feed`,
      minPrice,
      maxPrice,
    );
  }
}

/**
 * Setup simple redstone feeds with thresholding for a list of asset addresses
 *
 * @param assetAddresses Array of asset addresses to setup simple feeds for
 * @param config Network configuration
 * @param redstoneWrapper The redstone wrapper contract
 * @param oracleAggregator The oracle aggregator contract
 * @param baseCurrencyUnit The base currency unit for calculations
 * @param minPrice The minimum acceptable price for sanity checks
 * @param maxPrice The maximum acceptable price for sanity checks
 * @param deployerAddress The deployer address for permission checks
 */
export async function setupRedstoneSimpleFeedsForAssets(
  assetAddresses: string[],
  config: any,
  redstoneWrapper: any,
  oracleAggregator: any,
  baseCurrencyUnit: bigint,
  minPrice: number,
  maxPrice: number,
  deployerAddress: string,
): Promise<void> {
  const allSimpleFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding || {};

  for (const assetAddress of assetAddresses) {
    const feedConfig = allSimpleFeeds[assetAddress];

    if (!feedConfig) {
      console.log(`⚠️  No simple feed configuration found for asset ${assetAddress}. Skipping.`);
      continue;
    }

    // Check if feed already exists
    const existingFeed = await redstoneWrapper.assetToFeed(assetAddress);

    if (existingFeed !== ZeroAddress) {
      console.log(`- Simple feed for asset ${assetAddress} already configured. Skipping setup.`);
      continue;
    }

    console.log(`- Simple feed for asset ${assetAddress} not found. Proceeding with setup...`);

    // Check permissions before attempting to add feed
    try {
      const oracleManagerRole = await redstoneWrapper.ORACLE_MANAGER_ROLE();
      const hasRole = await redstoneWrapper.hasRole(oracleManagerRole, deployerAddress);
      console.log(`  - Deployer has ORACLE_MANAGER_ROLE: ${hasRole}`);

      if (!hasRole) {
        const errorMessage = `❌ Deployer (${deployerAddress}) lacks ORACLE_MANAGER_ROLE on RedstoneChainlinkWrapperWithThresholding (${redstoneWrapper.target}). Please grant this role before running the deployment.`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("lacks ORACLE_MANAGER_ROLE")) {
        throw error; // Re-throw our custom error
      }
      console.warn(`  - Could not check ORACLE_MANAGER_ROLE:`, error);
    }

    console.log(`- Adding simple feed for asset ${assetAddress}...`);

    try {
      // Set the feed
      await redstoneWrapper.setFeed(assetAddress, feedConfig.feed);
      console.log(`✅ Set simple Redstone feed for asset ${assetAddress}`);
    } catch (error) {
      console.error(`❌ Error adding simple feed for ${assetAddress}:`, error);
      throw new Error(`Failed to add simple feed for ${assetAddress}: ${error}`);
    }

    try {
      // Set threshold configuration if thresholds are specified
      if (feedConfig.lowerThreshold && feedConfig.lowerThreshold > 0) {
        await redstoneWrapper.setThresholdConfig(assetAddress, feedConfig.lowerThreshold, feedConfig.fixedPrice);
        console.log(`✅ Set threshold config for asset ${assetAddress}`);
      }
    } catch (error) {
      console.error(`❌ Error setting threshold for ${assetAddress}:`, error);
      throw new Error(`Failed to set threshold for ${assetAddress}: ${error}`);
    }

    try {
      await oracleAggregator.setOracle(assetAddress, redstoneWrapper.target);
      console.log(`✅ Set simple Redstone wrapper for asset ${assetAddress} to ${redstoneWrapper.target}`);
    } catch (error) {
      console.error(`❌ Error setting oracle for ${assetAddress}:`, error);
      throw new Error(`Failed to set oracle for ${assetAddress}: ${error}`);
    }

    // Perform sanity check AFTER the feed is set up
    console.log(`- Performing sanity check for asset ${assetAddress}...`);
    await performOracleSanityChecks(
      redstoneWrapper,
      { [assetAddress]: feedConfig },
      baseCurrencyUnit,
      `${assetAddress} simple feed`,
      minPrice,
      maxPrice,
    );
  }
}
