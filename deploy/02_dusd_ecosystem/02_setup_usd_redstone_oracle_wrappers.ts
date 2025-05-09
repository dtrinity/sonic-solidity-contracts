import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

// Helper function to perform sanity checks on oracle wrappers
async function performOracleSanityChecks(
  wrapper: any,
  feeds: Record<string, any>,
  baseCurrencyUnit: bigint,
  wrapperName: string
) {
  for (const [assetAddress] of Object.entries(feeds)) {
    try {
      // Redstone wrappers use getAssetPrice for getting the price
      const price = await wrapper.getAssetPrice(assetAddress);
      const normalizedPrice = Number(price) / Number(baseCurrencyUnit);
      if (normalizedPrice < 0.01 || normalizedPrice > 1e6) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.9, 2]`
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.9, 2]`
        );
      } else {
        console.log(
          `Sanity check passed for asset ${assetAddress} in ${wrapperName}: Normalized price is ${normalizedPrice}`
        );
      }
    } catch (error) {
      console.error(
        `Error performing sanity check for asset ${assetAddress} in ${wrapperName}:`,
        error
      );
      throw new Error(
        `Error performing sanity check for asset ${assetAddress} in ${wrapperName}: ${error}`
      );
    }
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);
  const baseCurrency = config.oracleAggregators.USD.baseCurrency;

  // Deploy RedstoneChainlinkWrapper for plain oracle feeds
  const redstoneWrapperDeployment = await hre.deployments.deploy(
    USD_REDSTONE_ORACLE_WRAPPER_ID,
    {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "RedstoneChainlinkWrapper",
      autoMine: true,
      log: false,
    }
  );

  const redstoneWrapper = await hre.ethers.getContractAt(
    "RedstoneChainlinkWrapper",
    redstoneWrapperDeployment.address
  );

  // Set feeds for plain oracle feeds
  const plainFeeds =
    config.oracleAggregators.USD.redstoneOracleAssets
      ?.plainRedstoneOracleWrappers || {};

  for (const [assetAddress, feed] of Object.entries(plainFeeds)) {
    await redstoneWrapper.setFeed(assetAddress, feed);
    console.log(`Set plain Redstone feed for asset ${assetAddress} to ${feed}`);
  }

  // Sanity check for plain Redstone proxies
  await performOracleSanityChecks(
    redstoneWrapper,
    plainFeeds,
    baseCurrencyUnit,
    "plain Redstone proxies"
  );

  // Deploy RedstoneChainlinkWrapperWithThresholding for feeds with thresholding
  const thresholdFeeds =
    config.oracleAggregators.USD.redstoneOracleAssets
      ?.redstoneOracleWrappersWithThresholding || {};

  const redstoneWrapperWithThresholdingDeployment =
    await hre.deployments.deploy(USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID, {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "RedstoneChainlinkWrapperWithThresholding",
      autoMine: true,
      log: false,
    });

  const redstoneWrapperWithThresholding = await hre.ethers.getContractAt(
    "RedstoneChainlinkWrapperWithThresholding",
    redstoneWrapperWithThresholdingDeployment.address
  );

  // Set feeds and thresholds for feeds with thresholding
  for (const [assetAddress, feedConfig] of Object.entries(thresholdFeeds)) {
    await redstoneWrapperWithThresholding.setFeed(
      assetAddress,
      feedConfig.feed
    );
    await redstoneWrapperWithThresholding.setThresholdConfig(
      assetAddress,
      feedConfig.lowerThreshold,
      feedConfig.fixedPrice
    );
    console.log(
      `Set Redstone feed with thresholding for asset ${assetAddress}`
    );
  }

  // Sanity check for Redstone proxies with thresholding
  await performOracleSanityChecks(
    redstoneWrapperWithThresholding,
    thresholdFeeds,
    baseCurrencyUnit,
    "Redstone proxies with thresholding"
  );

  // Deploy RedstoneChainlinkCompositeWrapperWithThresholding for composite feeds
  const compositeFeeds =
    config.oracleAggregators.USD.redstoneOracleAssets
      ?.compositeRedstoneOracleWrappersWithThresholding || {};

  const redstoneCompositeWrapperDeployment = await hre.deployments.deploy(
    USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
    {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "RedstoneChainlinkCompositeWrapperWithThresholding",
      autoMine: true,
      log: false,
    }
  );

  const redstoneCompositeWrapper = await hre.ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholding",
    redstoneCompositeWrapperDeployment.address
  );

  // Add composite feeds
  for (const [assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    await redstoneCompositeWrapper.addCompositeFeed(
      feedConfig.feedAsset,
      feedConfig.feed1,
      feedConfig.feed2,
      feedConfig.lowerThresholdInBase1,
      feedConfig.fixedPriceInBase1,
      feedConfig.lowerThresholdInBase2,
      feedConfig.fixedPriceInBase2
    );
    console.log(`Set composite Redstone feed for asset ${assetAddress}`);
  }

  // Sanity check for composite Redstone feeds
  await performOracleSanityChecks(
    redstoneCompositeWrapper,
    compositeFeeds,
    baseCurrencyUnit,
    "composite Redstone feeds"
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-redstone-oracle-wrapper",
];
func.dependencies = [];
func.id = "setup-usd-redstone-oracle-wrappers";

export default func;
