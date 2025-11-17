import { Signer, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { SafeTransactionData } from "../../typescript/safe/types";
import { getConfig } from "../../config/config";
import { USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_WITH_USD_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const RATIO_PRECISION = 10_000n;
const MAX_RATIO = 10n * RATIO_PRECISION; // 10x
const MIN_RATIO = RATIO_PRECISION / 10n; // 0.1x

type ChainlinkCompositeFeedWithUSDConfig = {
  feedAsset: string;
  chainlinkFeed1: string;
  rateProvider: string;
  chainlinkFeed3: string;
  lowerThresholdInBase1?: bigint;
  fixedPriceInBase1?: bigint;
  lowerThresholdInBase2?: bigint;
  fixedPriceInBase2?: bigint;
  lowerThresholdInBase3?: bigint;
  fixedPriceInBase3?: bigint;
};

/**
 * Build a Safe transaction payload that flips an asset's oracle.
 *
 * @param aggregatorAddress - OracleAggregator contract address.
 * @param asset - Asset whose oracle should be updated.
 * @param oracle - New oracle address to set for the asset.
 * @param aggregatorInterface - OracleAggregator contract interface instance.
 * @returns Encoded Safe transaction data.
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

/**
 * Ensure the USD composite wrapper is configured for wstkscETH and emit candidate price diagnostics.
 *
 * @param hre - Hardhat runtime environment.
 * @param signer - Signer used for read-only calls.
 * @param wrapperAddress - Deployed USD composite wrapper address.
 * @param feedConfig - Expected feed configuration.
 * @returns Wrapper composite metadata and candidate price.
 */
async function verifyCompositeFeedReadiness(
  hre: HardhatRuntimeEnvironment,
  signer: Signer,
  wrapperAddress: string,
  feedConfig: ChainlinkCompositeFeedWithUSDConfig,
): Promise<{ composite: any; candidatePrice: bigint }> {
  const { ethers } = hre;
  const wrapper = await ethers.getContractAt(
    "ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding",
    wrapperAddress,
    signer,
  );
  const composite = await wrapper.compositeFeeds(feedConfig.feedAsset);

  if (composite.feed1 === ZeroAddress || composite.rateProvider === ZeroAddress || composite.feed3 === ZeroAddress) {
    throw new Error(`Composite feed for asset ${feedConfig.feedAsset} is not configured on wrapper ${wrapperAddress}`);
  }

  if (composite.feed1.toLowerCase() !== feedConfig.chainlinkFeed1.toLowerCase()) {
    throw new Error(`Configured feed1 ${composite.feed1} does not match expected ${feedConfig.chainlinkFeed1}`);
  }

  if (composite.rateProvider.toLowerCase() !== feedConfig.rateProvider.toLowerCase()) {
    throw new Error(`Configured rate provider ${composite.rateProvider} does not match expected ${feedConfig.rateProvider}`);
  }

  if (composite.feed3.toLowerCase() !== feedConfig.chainlinkFeed3.toLowerCase()) {
    throw new Error(`Configured feed3 ${composite.feed3} does not match expected ${feedConfig.chainlinkFeed3}`);
  }

  const primaryLower = feedConfig.lowerThresholdInBase1 ?? 0n;
  const primaryFixed = feedConfig.fixedPriceInBase1 ?? 0n;
  const secondaryLower = feedConfig.lowerThresholdInBase2 ?? 0n;
  const secondaryFixed = feedConfig.fixedPriceInBase2 ?? 0n;
  const tertiaryLower = feedConfig.lowerThresholdInBase3 ?? 0n;
  const tertiaryFixed = feedConfig.fixedPriceInBase3 ?? 0n;

  if (
    BigInt(composite.primaryThreshold.lowerThresholdInBase) !== primaryLower ||
    BigInt(composite.primaryThreshold.fixedPriceInBase) !== primaryFixed
  ) {
    throw new Error(`Primary threshold on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  if (
    BigInt(composite.secondaryThreshold.lowerThresholdInBase) !== secondaryLower ||
    BigInt(composite.secondaryThreshold.fixedPriceInBase) !== secondaryFixed
  ) {
    throw new Error(`Secondary threshold on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  if (
    BigInt(composite.tertiaryThreshold.lowerThresholdInBase) !== tertiaryLower ||
    BigInt(composite.tertiaryThreshold.fixedPriceInBase) !== tertiaryFixed
  ) {
    throw new Error(`Tertiary threshold on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  const priceInfo = await wrapper.getPriceInfo(feedConfig.feedAsset);
  const candidatePrice = BigInt(priceInfo[0]);
  const candidateAlive = Boolean(priceInfo[1]);

  if (!candidateAlive || candidatePrice <= 0n) {
    throw new Error(`Composite price for asset ${feedConfig.feedAsset} is not alive or non-positive; aborting flip.`);
  }

  return { composite, candidatePrice };
}

/**
 * Queue the OracleAggregator flip for wstkscETH after sanity checking wrapper prices.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when the flip completed or governance transactions were queued.
 */
async function executeOracleFlip(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const wstkscETHAddress = config.tokenAddresses.wstkscETH;

  if (!wstkscETHAddress) {
    console.log("\n⚠️ wstkscETH address not configured for this network; skipping oracle flip.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (no-op)`);
    return true;
  }

  const wrapperDeployment = await deployments.get(USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_WITH_USD_ID);
  const wrapperAddress = wrapperDeployment.address;
  const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  console.log(`🔮 OracleAggregator: ${oracleAggregatorDeployment.address}`);
  console.log(`🔧 USD Chainlink Safe Rate Provider Composite Wrapper (with USD): ${wrapperAddress}`);

  const feed1 = "0xaA0eA5aa28dCB4280d0469167Bb8Bf99F51427D3"; // ChainlinkDecimalConverter wstkscETH/stkscETH
  const rateProvider = "0x61bE1eC20dfE0197c27B80bA0f7fcdb1a6B236E2"; // stkscETH/scETH rate provider
  const feed3 = "0x824364077993847f71293B24ccA8567c00c2de11"; // USD Chainlink feed (replacing discontinued scETH/USD)

  const feedConfig: ChainlinkCompositeFeedWithUSDConfig = {
    feedAsset: wstkscETHAddress,
    chainlinkFeed1: feed1,
    rateProvider,
    chainlinkFeed3: feed3,
    lowerThresholdInBase1: 0n,
    fixedPriceInBase1: 0n,
    lowerThresholdInBase2: 0n,
    fixedPriceInBase2: 0n,
    lowerThresholdInBase3: 0n,
    fixedPriceInBase3: 0n,
  };

  console.log(`\n  🔍 Validating composite feed readiness for asset ${feedConfig.feedAsset}...`);
  const { composite, candidatePrice } = await verifyCompositeFeedReadiness(hre, deployerSigner, wrapperAddress, feedConfig);

  console.log(
    `    ℹ️ Wrapper feeds -> feed1=${composite.feed1}, rateProvider=${composite.rateProvider}, feed3=${composite.feed3}, candidatePrice=${candidatePrice}`,
  );

  const currentOracleAddress = await oracleAggregator.assetOracles(wstkscETHAddress);
  const wrapperAddressLower = wrapperAddress.toLowerCase();

  if (currentOracleAddress.toLowerCase() === wrapperAddressLower) {
    console.log(`    ✅ OracleAggregator already points to ${wrapperAddress}; nothing to do.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  if (currentOracleAddress === ZeroAddress) {
    throw new Error(`OracleAggregator has no existing oracle configured for wstkscETH; aborting flip.`);
  }

  let currentPrice: bigint | undefined;
  let currentAlive = false;

  try {
    const currentPriceInfo = await oracleAggregator.getPriceInfo(wstkscETHAddress);
    currentPrice = BigInt(currentPriceInfo[0]);
    currentAlive = Boolean(currentPriceInfo[1]);
  } catch (error) {
    console.error(`    ❌ Failed to fetch current oracle price for wstkscETH:`, error);
    throw error;
  }

  if (!currentAlive || !currentPrice || currentPrice <= 0n) {
    throw new Error(`Current oracle price for wstkscETH is not alive or non-positive; aborting flip.`);
  }

  const ratio = (candidatePrice * RATIO_PRECISION) / currentPrice;
  console.log(
    `    ℹ️ Current oracle address=${currentOracleAddress}, price=${currentPrice}, ratio=${ratio} (precision=${RATIO_PRECISION})`,
  );

  if (ratio > MAX_RATIO || ratio < MIN_RATIO) {
    throw new Error(
      `Candidate price ${candidatePrice} deviates from current oracle price ${currentPrice} beyond safe bounds (ratio=${ratio}).`,
    );
  }

  console.log(`  🎯 Queueing OracleAggregator.setOracle for wstkscETH -> wrapper ${wrapperAddress}`);

  let allOperationsComplete = true;

  const complete = await executor.tryOrQueue(
    async () => {
      await oracleAggregator.setOracle(wstkscETHAddress, wrapperAddress);
      console.log(`    ✅ Oracle flipped for wstkscETH`);
    },
    () =>
      createSetOracleTransaction(oracleAggregatorDeployment.address, wstkscETHAddress, wrapperAddress, oracleAggregator.interface),
  );

  if (!complete) {
    allOperationsComplete = false;
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Queue wstkscETH USD oracle flip`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }

    console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
  }

  console.log(`\n✅ Oracle flip completed or queued successfully.`);
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

/**
 * Hardhat deploy entry point for the oracle flip phase.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when flips are complete or governance payloads are queued.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeOracleFlip(hre);
};

func.id = "queue-wstksceth-usd-oracle-flip";
func.tags = ["usd-oracle", "oracle-wrapper", "chainlink-safe-rate-provider", "wstksceth", "oracle-flip"];
func.dependencies = [USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_WITH_USD_ID, USD_ORACLE_AGGREGATOR_ID];

export default func;
