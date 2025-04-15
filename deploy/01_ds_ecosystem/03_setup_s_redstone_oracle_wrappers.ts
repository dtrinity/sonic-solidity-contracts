import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  S_REDSTONE_ORACLE_WRAPPER_ID,
  S_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  S_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregators.S.priceDecimals);
  const baseCurrency = config.oracleAggregators.S.baseCurrency;

  // Deploy RedstoneChainlinkWrapper for plain oracle feeds
  const redstoneWrapperDeployment = await hre.deployments.deploy(
    S_REDSTONE_ORACLE_WRAPPER_ID,
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
    config.oracleAggregators.S.redstoneOracleAssets
      ?.plainRedstoneOracleWrappers || {};

  for (const [assetAddress, feed] of Object.entries(plainFeeds)) {
    await redstoneWrapper.setFeed(assetAddress, feed);
    console.log(`Set plain Redstone feed for asset ${assetAddress} to ${feed}`);
  }

  // Deploy RedstoneChainlinkWrapperWithThresholding for feeds with thresholding
  const thresholdFeeds =
    config.oracleAggregators.S.redstoneOracleAssets
      ?.redstoneOracleWrappersWithThresholding || {};

  const redstoneWrapperWithThresholdingDeployment =
    await hre.deployments.deploy(S_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID, {
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
      `Set Redstone feed with thresholding for asset ${assetAddress}:`,
      `\n  - Feed: ${feedConfig.feed}`,
      `\n  - Lower threshold: ${feedConfig.lowerThreshold}`,
      `\n  - Fixed price: ${feedConfig.fixedPrice}`
    );
  }

  // Deploy RedstoneChainlinkCompositeWrapperWithThresholding for composite feeds
  const compositeFeeds =
    config.oracleAggregators.S.redstoneOracleAssets
      ?.compositeRedstoneOracleWrappersWithThresholding || {};

  const redstoneCompositeWrapperDeployment = await hre.deployments.deploy(
    S_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
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
    console.log(
      `Set composite Redstone feed for asset ${assetAddress} with:`,
      `\n  - Feed1: ${feedConfig.feed1}`,
      `\n  - Feed2: ${feedConfig.feed2}`,
      `\n  - Lower threshold in base1: ${feedConfig.lowerThresholdInBase1}`,
      `\n  - Fixed price in base1: ${feedConfig.fixedPriceInBase1}`,
      `\n  - Lower threshold in base2: ${feedConfig.lowerThresholdInBase2}`,
      `\n  - Fixed price in base2: ${feedConfig.fixedPriceInBase2}`
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = [
  "s-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "s-redstone-oracle-wrapper",
];
func.dependencies = [];
func.id = "setup-s-redstone-oracle-wrappers";

export default func;
