import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_TOKEN_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
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

      if (normalizedPrice < 0.01 || normalizedPrice > 1e6) {
        console.error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.9, 2]`,
        );
        throw new Error(
          `Sanity check failed for asset ${assetAddress} in ${wrapperName}: Normalized price ${normalizedPrice} is outside the range [0.9, 2]`,
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
  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);
  const baseCurrency = config.oracleAggregators.USD.baseCurrency;

  // Deploy API3Wrapper for plain oracle feeds
  const api3WrapperDeployment = await hre.deployments.deploy(
    USD_API3_ORACLE_WRAPPER_ID,
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
    config.oracleAggregators.USD.api3OracleAssets.plainApi3OracleWrappers || {};

  for (const [assetAddress, proxyAddress] of Object.entries(plainFeeds)) {
    await api3Wrapper.setProxy(assetAddress, proxyAddress);
    console.log(
      `Set plain API3 proxy for asset ${assetAddress} to ${proxyAddress}`,
    );
  }

  // Sanity check for plain API3 proxies
  await performOracleSanityChecks(
    api3Wrapper,
    plainFeeds,
    baseCurrencyUnit,
    "plain API3 proxies",
  );

  // Deploy API3WrapperWithThresholding for feeds with thresholding
  const thresholdFeeds =
    config.oracleAggregators.USD.api3OracleAssets
      .api3OracleWrappersWithThresholding || {};

  const api3WrapperWithThresholdingDeployment = await hre.deployments.deploy(
    USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
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
    console.log(`Set API3 proxy with thresholding for asset ${assetAddress}`);
  }

  // Sanity check for API3 proxies with thresholding
  await performOracleSanityChecks(
    api3WrapperWithThresholding,
    thresholdFeeds,
    baseCurrencyUnit,
    "API3 proxies with thresholding",
  );

  // Deploy API3CompositeWrapperWithThresholding for composite feeds
  const compositeFeeds =
    config.oracleAggregators.USD.api3OracleAssets
      .compositeApi3OracleWrappersWithThresholding || {};

  const api3CompositeWrapperDeployment = await hre.deployments.deploy(
    USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
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
    console.log(`Set composite API3 feed for asset ${assetAddress}`);
  }

  // Sanity check for composite API3 feeds
  await performOracleSanityChecks(
    api3CompositeWrapper,
    compositeFeeds,
    baseCurrencyUnit,
    "composite API3 feeds",
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-api3-oracle-wrapper",
];
func.dependencies = [DS_TOKEN_ID];
func.id = "setup-usd-api3-oracle-wrappers";

export default func;
