import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

/**
 * Build a Safe transaction payload to add a composite feed on the ChainlinkSafeRateProviderCompositeWrapper.
 *
 * @param wrapperAddress - The address of the ChainlinkSafeRateProviderCompositeWrapper contract
 * @param asset - The asset address for which to add the composite feed
 * @param chainlinkFeed - The Chainlink price feed address
 * @param rateProvider - The rate provider address
 * @param lowerThresholdInBase1 - Lower threshold for the first price feed in base currency units
 * @param fixedPriceInBase1 - Fixed price for the first price feed in base currency units
 * @param lowerThresholdInBase2 - Lower threshold for the second price feed in base currency units
 * @param fixedPriceInBase2 - Fixed price for the second price feed in base currency units
 * @param wrapperInterface - The contract interface for encoding function data
 */
function createAddCompositeFeedTransaction(
  wrapperAddress: string,
  asset: string,
  chainlinkFeed: string,
  rateProvider: string,
  lowerThresholdInBase1: bigint,
  fixedPriceInBase1: bigint,
  lowerThresholdInBase2: bigint,
  fixedPriceInBase2: bigint,
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("addCompositeFeed", [
      asset,
      chainlinkFeed,
      rateProvider,
      lowerThresholdInBase1,
      fixedPriceInBase1,
      lowerThresholdInBase2,
      fixedPriceInBase2,
    ]),
  };
}

/**
 * Build a Safe transaction payload to set an oracle on the OracleAggregator.
 *
 * @param aggregatorAddress - The address of the OracleAggregator contract
 * @param asset - The asset address for which to set the oracle
 * @param oracle - The oracle address to set for the asset
 * @param aggregatorInterface - The contract interface for encoding function data
 */
function createSetOracleTransaction(
  aggregatorAddress: string,
  asset: string,
  oracle: string,
  aggregatorInterface: any,
): SafeTransactionData {
  return {
    to: aggregatorAddress,
    value: "0",
    data: aggregatorInterface.encodeFunctionData("setOracle", [asset, oracle]),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Initialize governance executor (decides Safe vs direct execution)
  const executor = new GovernanceExecutor(
    hre,
    deployerSigner,
    config.safeConfig,
  );
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Get USD oracle aggregator configuration
  const usdConfig = config.oracleAggregators.USD;
  const baseCurrency = usdConfig.baseCurrency;
  const baseCurrencyUnit = BigInt(10) ** BigInt(usdConfig.priceDecimals);

  console.log(`🔮 Base currency: ${baseCurrency}`);
  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  // Deploy ChainlinkSafeRateProviderCompositeWrapperWithThresholding
  console.log(
    `\n🚀 Deploying ChainlinkSafeRateProviderCompositeWrapperWithThresholding...`,
  );
  const wrapperDeployResult = await deployments.deploy(
    USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID,
    {
      from: deployer,
      contract: "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
      args: [baseCurrency, baseCurrencyUnit],
      log: true,
      autoMine: true,
    },
  );

  const wrapperAddress = wrapperDeployResult.address;
  const wrapper = await ethers.getContractAt(
    "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
    wrapperAddress,
  );

  console.log(
    `✅ ChainlinkSafeRateProviderCompositeWrapper deployed at: ${wrapperAddress}`,
  );

  // Configure feeds from config
  const chainlinkFeeds =
    usdConfig.safeRateProviderAssets
      ?.chainlinkSafeRateProviderCompositeWrappers || {};
  let allOperationsComplete = true;

  if (Object.keys(chainlinkFeeds).length > 0) {
    console.log(`\n🔧 Configuring ChainlinkSafeRateProviderComposite feeds...`);

    for (const [_assetAddress, feedConfig] of Object.entries(chainlinkFeeds)) {
      console.log(
        `  📊 Adding composite feed for asset ${feedConfig.feedAsset}...`,
      );

      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.addCompositeFeed(
            feedConfig.feedAsset,
            feedConfig.chainlinkFeed,
            feedConfig.rateProvider,
            feedConfig.lowerThresholdInBase1,
            feedConfig.fixedPriceInBase1,
            feedConfig.lowerThresholdInBase2,
            feedConfig.fixedPriceInBase2,
          );
          console.log(
            `    ✅ Added ChainlinkSafeRateProviderComposite feed for ${feedConfig.feedAsset}`,
          );
        },
        () =>
          createAddCompositeFeedTransaction(
            wrapperAddress,
            feedConfig.feedAsset,
            feedConfig.chainlinkFeed,
            feedConfig.rateProvider,
            feedConfig.lowerThresholdInBase1,
            feedConfig.fixedPriceInBase1,
            feedConfig.lowerThresholdInBase2,
            feedConfig.fixedPriceInBase2,
            wrapper.interface,
          ),
      );

      if (!complete) allOperationsComplete = false;
    }

    // Point oracle aggregator to this wrapper for configured assets
    console.log(
      `\n🔗 Pointing USD Oracle Aggregator to ChainlinkSafeRateProviderComposite wrapper...`,
    );
    const oracleAggregatorDeployment = await deployments.get(
      USD_ORACLE_AGGREGATOR_ID,
    );
    const oracleAggregator = await ethers.getContractAt(
      "OracleAggregator",
      oracleAggregatorDeployment.address,
    );

    for (const [_assetAddress, feedConfig] of Object.entries(chainlinkFeeds)) {
      console.log(`  🎯 Setting oracle for asset ${feedConfig.feedAsset}...`);

      const complete = await executor.tryOrQueue(
        async () => {
          await oracleAggregator.setOracle(
            feedConfig.feedAsset,
            wrapperAddress,
          );
          console.log(
            `    ✅ Set oracle for ${feedConfig.feedAsset} to ChainlinkSafeRateProviderComposite wrapper`,
          );
        },
        () =>
          createSetOracleTransaction(
            oracleAggregatorDeployment.address,
            feedConfig.feedAsset,
            wrapperAddress,
            oracleAggregator.interface,
          ),
      );

      if (!complete) allOperationsComplete = false;
    }
  } else {
    console.log(
      `ℹ️  No ChainlinkSafeRateProviderComposite feeds configured in config`,
    );
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(
      `Deploy ChainlinkSafeRateProviderComposite wrapper: governance operations`,
    );

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log(
        "\n⏳ Some operations require governance signatures to complete.",
      );
      console.log(
        "   The deployment script will exit and can be re-run after governance executes the transactions.",
      );
      console.log(
        `\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`,
      );
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log(
        "\n⏭️ Non-Safe mode: pending governance operations detected; continuing.",
      );
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "deploy-chainlink-safe-rate-provider-composite-wrapper";
func.tags = ["usd-oracle", "oracle-wrapper", "chainlink-safe-rate-provider"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];

export default func;
