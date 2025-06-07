import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

// Helper function to perform sanity checks on oracle wrappers
/**
 * Performs sanity checks on oracle wrapper feeds by verifying normalized prices are within a reasonable range.
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
  for (const [assetAddress] of Object.entries(feeds)) {
    try {
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);

      if (normalizedPrice < 0.99 || normalizedPrice > 2) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.01, 1e6]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.01, 1e6]`,
        );
      } else {
        console.log(
          `Sanity check passed for asset ${assetAddress} in ${wrapperName}: Normalized price is ${normalizedPrice}`,
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

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const wstkscUSDAddress = config.tokenAddresses.wstkscUSD;

  if (!wstkscUSDAddress) {
    throw new Error("wstkscUSD address not found in config");
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

  const existingFeed =
    await redstoneCompositeWrapper.compositeFeeds(wstkscUSDAddress);

  if (existingFeed.feed1 !== ZeroAddress) {
    console.log(
      `- Composite feed for wstkscUSD (${wstkscUSDAddress}) already configured. Skipping setup.`,
    );
    return true;
  }
  console.log(
    `- Composite feed for wstkscUSD not found. Proceeding with setup...`,
  );

  const allCompositeFeeds =
    config.oracleAggregators.USD.redstoneOracleAssets
      ?.compositeRedstoneOracleWrappersWithThresholding || {};

  const feedConfig = allCompositeFeeds[wstkscUSDAddress];

  if (!feedConfig) {
    throw new Error(
      `Configuration for wstkscUSD not found in compositeRedstoneOracleWrappersWithThresholding`,
    );
  }

  // Perform sanity check for wstkscUSD feed
  await performOracleSanityChecks(
    redstoneCompositeWrapper,
    { [wstkscUSDAddress]: feedConfig },
    BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals), // Using priceDecimals for USD
    "wstkscUSD composite feed",
  );

  console.log(`- Adding composite feed for wstkscUSD (${wstkscUSDAddress})...`);

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
    console.log(`- Set composite Redstone feed for asset ${wstkscUSDAddress}`);
  } catch (error) {
    console.error(`❌ Error adding composite feed for wstkscUSD:`, error);
    throw new Error(`Failed to add composite feed for wstkscUSD: ${error}`);
  }

  try {
    await oracleAggregator.setOracle(
      feedConfig.feedAsset,
      redstoneCompositeWrapperAddress,
    );
    console.log(
      `Set composite Redstone wrapper for asset ${feedConfig.feedAsset} to ${redstoneCompositeWrapperAddress}`,
    );
  } catch (error) {
    console.error(`❌ Error setting oracle for wstkscUSD:`, error);
    throw new Error(`Failed to set oracle for wstkscUSD: ${error}`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-redstone-oracle-wrapper",
  "wstkscusd-chainlink-composite-feed",
];
func.dependencies = [USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID];
func.id = "setup-wstkscusd-for-usd-redstone-composite-oracle-wrapper";

export default func;
