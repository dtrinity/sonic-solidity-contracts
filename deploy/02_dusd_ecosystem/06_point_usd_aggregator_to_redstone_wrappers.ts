import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address);

  // Get USD RedstoneChainlinkWrapper for plain feeds
  const redstoneWrapperDeployment = await hre.deployments.get(USD_REDSTONE_ORACLE_WRAPPER_ID);
  const redstoneWrapperAddress = redstoneWrapperDeployment.address;

  // Get USD RedstoneChainlinkWrapperWithThresholding for feeds with thresholding
  const redstoneWrapperWithThresholdingDeployment = await hre.deployments.get(USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneWrapperWithThresholdingAddress = redstoneWrapperWithThresholdingDeployment.address;

  // Get USD RedstoneChainlinkCompositeWrapperWithThresholding for composite feeds
  const redstoneCompositeWrapperDeployment = await hre.deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneCompositeWrapperAddress = redstoneCompositeWrapperDeployment.address;

  // Set plain Redstone oracle wrappers
  const plainFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  for (const [assetAddress, _feed] of Object.entries(plainFeeds)) {
    await oracleAggregator.setOracle(assetAddress, redstoneWrapperAddress);
    console.log(`Set plain Redstone wrapper for asset ${assetAddress} to ${redstoneWrapperAddress}`);
  }

  // Set Redstone oracle wrappers with thresholding
  const thresholdFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding || {};

  for (const [assetAddress, _config] of Object.entries(thresholdFeeds)) {
    await oracleAggregator.setOracle(assetAddress, redstoneWrapperWithThresholdingAddress);
    console.log(`Set Redstone wrapper with thresholding for asset ${assetAddress} to ${redstoneWrapperWithThresholdingAddress}`);
  }

  // Set composite Redstone wrapper for assets
  const compositeFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};

  for (const [_assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    await oracleAggregator.setOracle(feedConfig.feedAsset, redstoneCompositeWrapperAddress);
    console.log(`Set composite Redstone wrapper for asset ${feedConfig.feedAsset} to ${redstoneCompositeWrapperAddress}`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-redstone-wrapper"];
func.dependencies = [
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
];
func.id = "point-usd-aggregator-to-redstone-wrappers";

export default func;
