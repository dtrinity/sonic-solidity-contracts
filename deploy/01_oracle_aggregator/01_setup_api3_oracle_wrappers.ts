import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  API3_ORACLE_WRAPPER_ID,
  API3_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregator.priceDecimals);

  // Deploy API3Wrapper for plain oracle feeds
  const api3WrapperDeployment = await hre.deployments.deploy(
    API3_ORACLE_WRAPPER_ID,
    {
      from: deployer,
      args: [baseCurrencyUnit],
      contract: "API3Wrapper",
      autoMine: true,
      log: false,
    }
  );

  const api3Wrapper = await hre.ethers.getContractAt(
    API3_ORACLE_WRAPPER_ID,
    api3WrapperDeployment.address
  );

  // Set proxies for plain oracle feeds
  const plainFeeds =
    config.oracleAggregator.api3OracleAssets.plainApi3OracleWrappers || {};

  for (const [assetAddress, proxyAddress] of Object.entries(plainFeeds)) {
    await api3Wrapper.setProxy(assetAddress, proxyAddress);
    console.log(
      `Set plain API3 proxy for asset ${assetAddress} to ${proxyAddress}`
    );
  }

  // Deploy API3WrapperWithThresholding for feeds with thresholding
  const thresholdFeeds =
    config.oracleAggregator.api3OracleAssets
      .api3OracleWrappersWithThresholding || {};

  const api3WrapperWithThresholdingDeployment = await hre.deployments.deploy(
    API3_WRAPPER_WITH_THRESHOLDING_ID,
    {
      from: deployer,
      args: [baseCurrencyUnit],
      contract: "API3WrapperWithThresholding",
      autoMine: true,
      log: false,
    }
  );

  const api3WrapperWithThresholding = await hre.ethers.getContractAt(
    "API3WrapperWithThresholding",
    api3WrapperWithThresholdingDeployment.address
  );

  // Set proxies and thresholds for feeds with thresholding
  for (const [assetAddress, feedConfig] of Object.entries(thresholdFeeds)) {
    await api3WrapperWithThresholding.setProxy(assetAddress, feedConfig.proxy);
    await api3WrapperWithThresholding.setThresholdConfig(
      assetAddress,
      feedConfig.lowerThreshold,
      feedConfig.fixedPrice
    );
    console.log(
      `Set API3 proxy with thresholding for asset ${assetAddress}:`,
      `\n  - Proxy: ${feedConfig.proxy}`,
      `\n  - Lower threshold: ${feedConfig.lowerThreshold}`,
      `\n  - Fixed price: ${feedConfig.fixedPrice}`
    );
  }

  // Deploy API3CompositeWrapperWithThresholding for composite feeds
  const compositeFeeds =
    config.oracleAggregator.api3OracleAssets
      .compositeApi3OracleWrappersWithThresholding || {};

  const api3CompositeWrapperDeployment = await hre.deployments.deploy(
    API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
    {
      from: deployer,
      args: [baseCurrencyUnit],
      contract: "API3CompositeWrapperWithThresholding",
      autoMine: true,
      log: false,
    }
  );

  const api3CompositeWrapper = await hre.ethers.getContractAt(
    "API3CompositeWrapperWithThresholding",
    api3CompositeWrapperDeployment.address
  );

  // Add composite feeds
  for (const [assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    await api3CompositeWrapper.addCompositeFeed(
      feedConfig.feedAsset,
      feedConfig.proxy1,
      feedConfig.proxy2,
      feedConfig.lowerThresholdInBase1,
      feedConfig.fixedPriceInBase1,
      feedConfig.lowerThresholdInBase2,
      feedConfig.fixedPriceInBase2
    );
    console.log(
      `Set composite API3 feed for asset ${assetAddress} with:`,
      `\n  - Proxy1: ${feedConfig.proxy1}`,
      `\n  - Proxy2: ${feedConfig.proxy2}`,
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

func.tags = ["oracle-aggregator", "oracle-wrapper", "api3-oracle-wrapper"];
func.dependencies = [];
func.id = API3_ORACLE_WRAPPER_ID;

export default func;
