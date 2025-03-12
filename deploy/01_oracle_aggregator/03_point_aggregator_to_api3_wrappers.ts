import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  API3_ORACLE_WRAPPER_ID,
  API3_WRAPPER_WITH_THRESHOLDING_ID,
  ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  // Get OracleAggregator contract
  const oracleAggregatorDeployment =
    await hre.deployments.get(ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorDeployment.address
  );

  // Get API3Wrapper for plain feeds
  const api3WrapperDeployment = await hre.deployments.get(
    API3_ORACLE_WRAPPER_ID
  );
  const api3WrapperAddress = api3WrapperDeployment.address;

  // Get API3WrapperWithThresholding for feeds with thresholding
  const api3WrapperWithThresholdingDeployment = await hre.deployments.get(
    API3_WRAPPER_WITH_THRESHOLDING_ID
  );
  const api3WrapperWithThresholdingAddress =
    api3WrapperWithThresholdingDeployment.address;

  // Get API3CompositeWrapperWithThresholding for composite feeds
  const api3CompositeWrapperDeployment = await hre.deployments.get(
    API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID
  );
  const api3CompositeWrapperAddress = api3CompositeWrapperDeployment.address;

  // Set plain API3 wrapper for assets
  const plainFeeds =
    config.oracleAggregator.api3OracleAssets.plainApi3OracleWrappers || {};
  for (const assetAddress of Object.keys(plainFeeds)) {
    await oracleAggregator.setOracle(assetAddress, api3WrapperAddress);
    console.log(
      `Set plain API3 wrapper for asset ${assetAddress} to ${api3WrapperAddress}`
    );
  }

  // Set API3 wrapper with thresholding for assets
  const thresholdFeeds =
    config.oracleAggregator.api3OracleAssets
      .api3OracleWrappersWithThresholding || {};
  for (const assetAddress of Object.keys(thresholdFeeds)) {
    await oracleAggregator.setOracle(
      assetAddress,
      api3WrapperWithThresholdingAddress
    );
    console.log(
      `Set API3 wrapper with thresholding for asset ${assetAddress} to ${api3WrapperWithThresholdingAddress}`
    );
  }

  // Set composite API3 wrapper for assets
  const compositeFeeds =
    config.oracleAggregator.api3OracleAssets
      .compositeApi3OracleWrappersWithThresholding || {};
  for (const [assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    await oracleAggregator.setOracle(
      feedConfig.feedAsset,
      api3CompositeWrapperAddress
    );
    console.log(
      `Set composite API3 wrapper for asset ${feedConfig.feedAsset} to ${api3CompositeWrapperAddress}`
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["oracle-aggregator", "oracle-wrapper", "api3-oracle-wrapper"];
func.dependencies = [
  API3_ORACLE_WRAPPER_ID,
  API3_WRAPPER_WITH_THRESHOLDING_ID,
  API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  ORACLE_AGGREGATOR_ID,
];
func.id = "point-aggregator-to-api3-wrappers";

export default func;
