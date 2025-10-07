import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  S_ORACLE_AGGREGATOR_ID,
  S_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  S_REDSTONE_ORACLE_WRAPPER_ID,
  S_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);

  // Get S OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(S_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address);

  // Get S RedstoneChainlinkWrapper for plain feeds
  const redstoneWrapperDeployment = await hre.deployments.get(S_REDSTONE_ORACLE_WRAPPER_ID);
  const redstoneWrapperAddress = redstoneWrapperDeployment.address;

  // Get S RedstoneChainlinkWrapperWithThresholding for feeds with thresholding
  const redstoneWrapperWithThresholdingDeployment = await hre.deployments.get(S_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneWrapperWithThresholdingAddress = redstoneWrapperWithThresholdingDeployment.address;

  // Get S RedstoneChainlinkCompositeWrapperWithThresholding for composite feeds
  const redstoneCompositeWrapperDeployment = await hre.deployments.get(S_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneCompositeWrapperAddress = redstoneCompositeWrapperDeployment.address;

  // Set plain Redstone oracle wrappers
  const plainFeeds = config.oracleAggregators.S.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  for (const [assetAddress, _feed] of Object.entries(plainFeeds)) {
    const currentOracle = await oracleAggregator.assetOracles(assetAddress);

    if (currentOracle.toLowerCase() !== redstoneWrapperAddress.toLowerCase()) {
      const tx = await oracleAggregator.setOracle(assetAddress, redstoneWrapperAddress);
      await tx.wait();
      console.log(`Set plain Redstone wrapper for asset ${assetAddress} to ${redstoneWrapperAddress}`);
    } else {
      console.log(`Plain Redstone wrapper for asset ${assetAddress} already set to ${redstoneWrapperAddress}. Skipping.`);
    }
  }

  // Set Redstone oracle wrappers with thresholding
  const thresholdFeeds = config.oracleAggregators.S.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding || {};

  for (const [assetAddress, _config] of Object.entries(thresholdFeeds)) {
    const currentOracle = await oracleAggregator.assetOracles(assetAddress);

    if (currentOracle.toLowerCase() !== redstoneWrapperWithThresholdingAddress.toLowerCase()) {
      const tx = await oracleAggregator.setOracle(assetAddress, redstoneWrapperWithThresholdingAddress);
      await tx.wait();
      console.log(`Set Redstone wrapper with thresholding for asset ${assetAddress} to ${redstoneWrapperWithThresholdingAddress}`);
    } else {
      console.log(
        `Redstone wrapper with thresholding for asset ${assetAddress} already set to ${redstoneWrapperWithThresholdingAddress}. Skipping.`,
      );
    }
  }

  // Set composite Redstone wrapper for assets
  const compositeFeeds = config.oracleAggregators.S.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};

  for (const [_assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    const currentOracle = await oracleAggregator.assetOracles(feedConfig.feedAsset);

    if (currentOracle.toLowerCase() !== redstoneCompositeWrapperAddress.toLowerCase()) {
      const tx = await oracleAggregator.setOracle(feedConfig.feedAsset, redstoneCompositeWrapperAddress);
      await tx.wait();
      console.log(`Set composite Redstone wrapper for asset ${feedConfig.feedAsset} to ${redstoneCompositeWrapperAddress}`);
    } else {
      console.log(
        `Composite Redstone wrapper for asset ${feedConfig.feedAsset} already set to ${redstoneCompositeWrapperAddress}. Skipping.`,
      );
    }
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["s-oracle", "oracle-aggregator", "oracle-wrapper", "s-redstone-wrapper"];
func.dependencies = [
  S_REDSTONE_ORACLE_WRAPPER_ID,
  S_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  S_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  S_ORACLE_AGGREGATOR_ID,
];
func.id = "point-s-aggregator-to-redstone-wrappers";

export default func;
