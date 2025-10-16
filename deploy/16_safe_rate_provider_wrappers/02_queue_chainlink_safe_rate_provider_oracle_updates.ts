import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];
const RATIO_PRECISION = 10_000n;
const MAX_RATIO = 10n * RATIO_PRECISION; // 10x
const MIN_RATIO = RATIO_PRECISION / 10n; // 0.1x

type ChainlinkCompositeFeedConfig = {
  feedAsset: string;
  chainlinkFeed: string;
  rateProvider: string;
  lowerThresholdInBase1?: bigint;
  fixedPriceInBase1?: bigint;
  lowerThresholdInBase2?: bigint;
  fixedPriceInBase2?: bigint;
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
 * Ensure the composite feed is configured and alive before scheduling the flip.
 *
 * @param hre - Hardhat runtime environment.
 * @param signer - Signer used for read-only calls.
 * @param wrapperAddress - Address of the Chainlink composite wrapper.
 * @param feedConfig - Static configuration for the composite feed.
 * @returns Wrapper composite metadata and the candidate price.
 */
async function verifyCompositeFeedReadiness(
  hre: HardhatRuntimeEnvironment,
  signer: Signer,
  wrapperAddress: string,
  feedConfig: ChainlinkCompositeFeedConfig,
): Promise<{ composite: any; candidatePrice: bigint }> {
  const { ethers } = hre;
  const wrapper = await ethers.getContractAt("ChainlinkSafeRateProviderCompositeWrapperWithThresholding", wrapperAddress, signer);
  const composite = await wrapper.compositeFeeds(feedConfig.feedAsset);

  if (composite.feed1 === ethers.ZeroAddress || composite.rateProvider === ethers.ZeroAddress) {
    throw new Error(`Composite feed for asset ${feedConfig.feedAsset} is not configured on wrapper ${wrapperAddress}`);
  }

  if (composite.feed1.toLowerCase() !== feedConfig.chainlinkFeed.toLowerCase()) {
    throw new Error(`Configured feed ${composite.feed1} does not match expected Chainlink feed ${feedConfig.chainlinkFeed}`);
  }

  if (composite.rateProvider.toLowerCase() !== feedConfig.rateProvider.toLowerCase()) {
    throw new Error(`Configured rate provider ${composite.rateProvider} does not match expected ${feedConfig.rateProvider}`);
  }

  const primaryLower = feedConfig.lowerThresholdInBase1 ?? 0n;
  const primaryFixed = feedConfig.fixedPriceInBase1 ?? 0n;
  const secondaryLower = feedConfig.lowerThresholdInBase2 ?? 0n;
  const secondaryFixed = feedConfig.fixedPriceInBase2 ?? 0n;

  if (composite.primaryThreshold.lowerThresholdInBase !== primaryLower || composite.primaryThreshold.fixedPriceInBase !== primaryFixed) {
    throw new Error(`Primary threshold on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  if (
    composite.secondaryThreshold.lowerThresholdInBase !== secondaryLower ||
    composite.secondaryThreshold.fixedPriceInBase !== secondaryFixed
  ) {
    throw new Error(`Secondary threshold on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  const priceFeed = new ethers.Contract(composite.feed1, PRICE_FEED_ABI, signer);
  const onchainFeedDecimalsRaw = await priceFeed.decimals();
  const onchainFeedDecimals = typeof onchainFeedDecimalsRaw === "number" ? onchainFeedDecimalsRaw : Number(onchainFeedDecimalsRaw);

  if (onchainFeedDecimals !== composite.feed1Decimals) {
    throw new Error(
      `Feed decimals changed for ${feedConfig.feedAsset}: cached=${composite.feed1Decimals}, on-chain=${onchainFeedDecimals}`,
    );
  }

  const roundData = await priceFeed.latestRoundData();
  const answer = BigInt(roundData.answer ?? roundData[1]);

  if (answer <= 0n) {
    throw new Error(`Chainlink feed ${composite.feed1} returned non-positive answer ${answer}`);
  }

  const priceInfo = await wrapper.getPriceInfo(feedConfig.feedAsset);
  const candidatePrice = BigInt(priceInfo[0]);
  const candidateAlive = Boolean(priceInfo[1]);

  if (!candidateAlive || candidatePrice <= 0n) {
    throw new Error(`Wrapper price for asset ${feedConfig.feedAsset} is not alive or non-positive`);
  }

  return { composite, candidatePrice };
}

/**
 * Execute the oracle flip stage on networks where the composite wrapper is ready.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when flips complete or governance payloads are queued.
 */
async function executeOracleFlip(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const wrapperDeployment = await deployments.get(USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID);
  const wrapperAddress = wrapperDeployment.address;

  const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  const usdConfig = config.oracleAggregators.USD;
  const chainlinkFeeds = usdConfig.safeRateProviderAssets?.chainlinkSafeRateProviderCompositeWrappers || {};

  if (Object.keys(chainlinkFeeds).length === 0) {
    console.log(`ℹ️  No ChainlinkSafeRateProviderComposite feeds configured in config; nothing to queue.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  let allOperationsComplete = true;
  const wrapperAddressLower = wrapperAddress.toLowerCase();

  for (const [_assetAddress, feedConfig] of Object.entries(chainlinkFeeds)) {
    const asset = feedConfig.feedAsset;
    console.log(`\n  🔍 Validating composite feed readiness for asset ${asset}...`);
    const { composite, candidatePrice } = await verifyCompositeFeedReadiness(hre, deployerSigner, wrapperAddress, feedConfig);

    console.log(`    ℹ️ Wrapper feed=${composite.feed1}, rateProvider=${composite.rateProvider}, candidatePrice=${candidatePrice}`);

    const currentOracleAddress = await oracleAggregator.assetOracles(asset);

    if (currentOracleAddress.toLowerCase() === wrapperAddressLower) {
      console.log(`    ✅ OracleAggregator already points to ${wrapperAddress}; skipping.`);
      continue;
    }

    if (currentOracleAddress === ethers.ZeroAddress) {
      throw new Error(`OracleAggregator has no existing oracle configured for asset ${asset}; aborting flip.`);
    }

    let currentPrice: bigint | undefined;
    let currentAlive = false;

    try {
      const currentPriceInfo = await oracleAggregator.getPriceInfo(asset);
      currentPrice = BigInt(currentPriceInfo[0]);
      currentAlive = Boolean(currentPriceInfo[1]);
    } catch (error) {
      console.error(`    ❌ Failed to fetch current oracle price for asset ${asset}:`, error);
      throw error;
    }

    if (!currentAlive || !currentPrice || currentPrice <= 0n) {
      throw new Error(`Current oracle price for asset ${asset} is not alive or non-positive; aborting flip.`);
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

    console.log(`  🎯 Queueing OracleAggregator.setOracle for asset ${asset} -> wrapper ${wrapperAddress}`);

    const complete = await executor.tryOrQueue(
      async () => {
        await oracleAggregator.setOracle(asset, wrapperAddress);
        console.log(`    ✅ Oracle flipped for ${asset}`);
      },
      () => createSetOracleTransaction(oracleAggregatorDeployment.address, asset, wrapperAddress, oracleAggregator.interface),
    );

    if (!complete) {
      allOperationsComplete = false;
    }
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Queue ChainlinkSafeRateProvider composite wrapper oracle updates`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log(`\n✅ All oracle flip operations completed or queued.`);
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

/**
 * Hardhat deploy entry point for the oracle flip phase. Skips on Sonic mainnet.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when flips are complete or governance payloads are queued.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (await func.skip?.(hre)) {
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: skipping (already executed on Sonic mainnet)`);
    console.log(`   ℹ️ Oracle flip safety checks are available for future forks.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (no-op)`);
    return true;
  }

  return executeOracleFlip(hre);
};

func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const network = hre.network.name;
  return network === "sonic_mainnet" || network === "sonic";
};

func.id = "queue-chainlink-safe-rate-provider-oracle-updates";
func.tags = ["usd-oracle", "oracle-wrapper", "chainlink-safe-rate-provider", "oracle-flip"];
func.dependencies = [
  USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
  "deploy-chainlink-safe-rate-provider-composite-wrapper",
];

export default func;
