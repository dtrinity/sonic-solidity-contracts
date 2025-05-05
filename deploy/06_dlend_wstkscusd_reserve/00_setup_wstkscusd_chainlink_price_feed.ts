import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const wstkscUSDAddress = config.tokenAddresses.wstkscUSD;

  if (!wstkscUSDAddress) {
    console.log("wstkscUSD address not found in config. Skipping...");
    return true;
  }
  const deployerSigner = await hre.ethers.getSigner(deployer);
  const oracleAggregatorDeployment = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  if (!oracleAggregatorDeployment) {
    console.log("USD OracleAggregator deployment not found. Skipping...");
    return true;
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
    console.log(
      "RedstoneChainlinkCompositeWrapperWithThresholding artifact not found. Skipping...",
    );
    return true;
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
    console.log(
      `Configuration for wstkscUSD not found in compositeRedstoneOracleWrappersWithThresholding. Skipping...`,
    );
    return true;
  }

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
    return false;
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
    return false;
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
