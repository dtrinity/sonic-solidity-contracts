import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ERC4626_SAFE_RATE_PROVIDER_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

/**
 * Build a Safe transaction payload to set a feed on the ERC4626SafeRateProviderWrapper.
 */
function createSetFeedTransaction(
  wrapperAddress: string,
  asset: string,
  erc4626Vault: string,
  rateProvider: string,
  rateProviderUnit: bigint,
  lowerThresholdInBase1: bigint,
  fixedPriceInBase1: bigint,
  lowerThresholdInBase2: bigint,
  fixedPriceInBase2: bigint,
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setFeed", [
      asset,
      erc4626Vault,
      rateProvider,
      rateProviderUnit,
      lowerThresholdInBase1,
      fixedPriceInBase1,
      lowerThresholdInBase2,
      fixedPriceInBase2,
    ]),
  };
}

/**
 * Build a Safe transaction payload to set an oracle on the OracleAggregator.
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

  // Deploy ERC4626SafeRateProviderWrapperWithThresholding
  console.log(`\n🚀 Deploying ERC4626SafeRateProviderWrapperWithThresholding...`);
  const wrapperDeployResult = await deployments.deploy(
    USD_ERC4626_SAFE_RATE_PROVIDER_WRAPPER_ID,
    {
      from: deployer,
      contract: "ERC4626SafeRateProviderWrapperWithThresholding",
      args: [baseCurrency, baseCurrencyUnit],
      log: true,
      autoMine: true,
    },
  );

  const wrapperAddress = wrapperDeployResult.address;
  const wrapper = await ethers.getContractAt(
    "ERC4626SafeRateProviderWrapperWithThresholding",
    wrapperAddress,
  );

  console.log(`✅ ERC4626SafeRateProviderWrapper deployed at: ${wrapperAddress}`);

  // Configure feeds from config
  const erc4626Feeds = usdConfig.safeRateProviderAssets?.erc4626SafeRateProviderWrappers || {};
  let allOperationsComplete = true;

  if (Object.keys(erc4626Feeds).length > 0) {
    console.log(`\n🔧 Configuring ERC4626SafeRateProvider feeds...`);

    for (const [assetAddress, feedConfig] of Object.entries(erc4626Feeds)) {
      console.log(`  📊 Setting feed for asset ${assetAddress}...`);

      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.setFeed(
            feedConfig.feedAsset,
            feedConfig.erc4626Vault,
            feedConfig.rateProvider,
            feedConfig.rateProviderUnit,
            feedConfig.lowerThresholdInBase1,
            feedConfig.fixedPriceInBase1,
            feedConfig.lowerThresholdInBase2,
            feedConfig.fixedPriceInBase2,
          );
          console.log(`    ✅ Set ERC4626SafeRateProvider feed for ${feedConfig.feedAsset}`);
        },
        () =>
          createSetFeedTransaction(
            wrapperAddress,
            feedConfig.feedAsset,
            feedConfig.erc4626Vault,
            feedConfig.rateProvider,
            feedConfig.rateProviderUnit,
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
    console.log(`\n🔗 Pointing USD Oracle Aggregator to ERC4626SafeRateProvider wrapper...`);
    const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
    const oracleAggregator = await ethers.getContractAt(
      "OracleAggregator",
      oracleAggregatorDeployment.address,
    );

    for (const [assetAddress, feedConfig] of Object.entries(erc4626Feeds)) {
      console.log(`  🎯 Setting oracle for asset ${feedConfig.feedAsset}...`);

      const complete = await executor.tryOrQueue(
        async () => {
          await oracleAggregator.setOracle(feedConfig.feedAsset, wrapperAddress);
          console.log(`    ✅ Set oracle for ${feedConfig.feedAsset} to ERC4626SafeRateProvider wrapper`);
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
    console.log(`ℹ️  No ERC4626SafeRateProvider feeds configured in config`);
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(
      `Deploy ERC4626SafeRateProvider wrapper: governance operations`,
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

func.id = "deploy-erc4626-safe-rate-provider-wrapper";
func.tags = ["usd-oracle", "oracle-wrapper", "erc4626-safe-rate-provider"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];

export default func;
