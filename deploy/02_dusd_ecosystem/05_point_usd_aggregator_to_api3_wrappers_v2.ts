import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { executeStateCheckedMutationBatch, ContractMutationFactory } from "../../typescript/deploy-utils/state-checked-mutations";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);

  // Get USD OracleAggregator contract
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address);

  // Get wrapper addresses
  const api3WrapperAddress = (await hre.deployments.get(USD_API3_ORACLE_WRAPPER_ID)).address;
  const api3WrapperWithThresholdingAddress = (await hre.deployments.get(USD_API3_WRAPPER_WITH_THRESHOLDING_ID)).address;
  const api3CompositeWrapperAddress = (await hre.deployments.get(USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID)).address;

  // Build mutation list
  const mutations = [];

  // Plain API3 wrapper for assets
  const plainFeeds = config.oracleAggregators.USD.api3OracleAssets.plainApi3OracleWrappers || {};
  for (const [assetAddress] of Object.entries(plainFeeds)) {
    mutations.push(ContractMutationFactory.setOracle(oracleAggregator, assetAddress, api3WrapperAddress));
  }

  // API3 wrapper with thresholding for assets
  const thresholdFeeds = config.oracleAggregators.USD.api3OracleAssets.api3OracleWrappersWithThresholding || {};
  for (const [assetAddress] of Object.entries(thresholdFeeds)) {
    mutations.push(ContractMutationFactory.setOracle(oracleAggregator, assetAddress, api3WrapperWithThresholdingAddress));
  }

  // Composite API3 wrapper for assets
  const compositeFeeds = config.oracleAggregators.USD.api3OracleAssets.compositeApi3OracleWrappersWithThresholding || {};
  for (const [, feedConfig] of Object.entries(compositeFeeds)) {
    const typedFeedConfig = feedConfig as { feedAsset: string };
    mutations.push(ContractMutationFactory.setOracle(oracleAggregator, typedFeedConfig.feedAsset, api3CompositeWrapperAddress));
  }

  // Execute all mutations
  console.log(`🔮 Configuring ${mutations.length} API3 oracle assignments...`);
  const results = await executeStateCheckedMutationBatch(mutations);

  // Summary
  const executed = results.filter(r => r.executed).length;
  const skipped = results.filter(r => !r.executed).length;
  console.log(`📊 Oracle configuration complete: ${executed} executed, ${skipped} skipped`);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-oracle-wrapper"];
func.dependencies = [
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
];
func.id = "point-usd-aggregator-to-api3-wrappers-v2";

export default func;