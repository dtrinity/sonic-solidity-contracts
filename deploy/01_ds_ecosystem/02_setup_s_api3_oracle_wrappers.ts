import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  S_API3_ORACLE_WRAPPER_ID,
  S_API3_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregators.S.priceDecimals);
  const baseCurrency = config.oracleAggregators.S.baseCurrency;

  // Deploy API3Wrapper for plain oracle feeds
  const api3WrapperDeployment = await hre.deployments.deploy(
    S_API3_ORACLE_WRAPPER_ID,
    {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "API3Wrapper",
      autoMine: true,
      log: false,
    },
  );

  const api3Wrapper = await hre.ethers.getContractAt(
    "API3Wrapper",
    api3WrapperDeployment.address,
  );

  // Set proxies for plain oracle feeds
  const plainFeeds =
    config.oracleAggregators.S.api3OracleAssets.plainApi3OracleWrappers || {};

  for (const [assetAddress, proxyAddress] of Object.entries(plainFeeds)) {
    await api3Wrapper.setProxy(assetAddress, proxyAddress);
    console.log(
      `Set plain API3 proxy for asset ${assetAddress} to ${proxyAddress}`,
    );
  }

  // Deploy API3WrapperWithThresholding for feeds with thresholding
  const thresholdFeeds =
    config.oracleAggregators.S.api3OracleAssets
      .api3OracleWrappersWithThresholding || {};

  const api3WrapperWithThresholdingDeployment = await hre.deployments.deploy(
    S_API3_WRAPPER_WITH_THRESHOLDING_ID,
    {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "API3WrapperWithThresholding",
      autoMine: true,
      log: false,
    },
  );

  const api3WrapperWithThresholding = await hre.ethers.getContractAt(
    "API3WrapperWithThresholding",
    api3WrapperWithThresholdingDeployment.address,
  );

  // Set proxies and thresholds for feeds with thresholding
  for (const [assetAddress, feedConfig] of Object.entries(thresholdFeeds)) {
    const typedFeedConfig = feedConfig as {
      proxy: string;
      lowerThreshold: bigint;
      fixedPrice: bigint;
    };

    await api3WrapperWithThresholding.setProxy(
      assetAddress,
      typedFeedConfig.proxy,
    );
    await api3WrapperWithThresholding.setThresholdConfig(
      assetAddress,
      typedFeedConfig.lowerThreshold,
      typedFeedConfig.fixedPrice,
    );
    console.log(
      `Set API3 proxy with thresholding for asset ${assetAddress}:`,
      `\n  - Proxy: ${typedFeedConfig.proxy}`,
      `\n  - Lower threshold: ${typedFeedConfig.lowerThreshold}`,
      `\n  - Fixed price: ${typedFeedConfig.fixedPrice}`,
    );
  }

  // Deploy API3CompositeWrapperWithThresholding for composite feeds
  const compositeFeeds =
    config.oracleAggregators.S.api3OracleAssets
      .compositeApi3OracleWrappersWithThresholding || {};

  const api3CompositeWrapperDeployment = await hre.deployments.deploy(
    S_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
    {
      from: deployer,
      args: [baseCurrency, baseCurrencyUnit],
      contract: "API3CompositeWrapperWithThresholding",
      autoMine: true,
      log: false,
    },
  );

  const api3CompositeWrapper = await hre.ethers.getContractAt(
    "API3CompositeWrapperWithThresholding",
    api3CompositeWrapperDeployment.address,
  );

  // Add composite feeds
  for (const [assetAddress, feedConfig] of Object.entries(compositeFeeds)) {
    const typedFeedConfig = feedConfig as {
      feedAsset: string;
      proxy1: string;
      proxy2: string;
      lowerThresholdInBase1: bigint;
      fixedPriceInBase1: bigint;
      lowerThresholdInBase2: bigint;
      fixedPriceInBase2: bigint;
    };

    await api3CompositeWrapper.addCompositeFeed(
      typedFeedConfig.feedAsset,
      typedFeedConfig.proxy1,
      typedFeedConfig.proxy2,
      typedFeedConfig.lowerThresholdInBase1,
      typedFeedConfig.fixedPriceInBase1,
      typedFeedConfig.lowerThresholdInBase2,
      typedFeedConfig.fixedPriceInBase2,
    );
    console.log(
      `Set composite API3 feed for asset ${assetAddress} with:`,
      `\n  - Proxy1: ${typedFeedConfig.proxy1}`,
      `\n  - Proxy2: ${typedFeedConfig.proxy2}`,
      `\n  - Lower threshold in base1: ${typedFeedConfig.lowerThresholdInBase1}`,
      `\n  - Fixed price in base1: ${typedFeedConfig.fixedPriceInBase1}`,
      `\n  - Lower threshold in base2: ${typedFeedConfig.lowerThresholdInBase2}`,
      `\n  - Fixed price in base2: ${typedFeedConfig.fixedPriceInBase2}`,
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
  "s-api3-oracle-wrapper",
];
func.dependencies = [];
func.id = "setup-s-api3-oracle-wrappers";

export default func;
