import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { Config } from "../../config/types";
import { USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

const RATIO_PRECISION = 10_000n;
const MAX_RATIO = (101n * RATIO_PRECISION) / 100n;
const MIN_RATIO = (99n * RATIO_PRECISION) / 100n;

type ThirdFeedConfig = {
  feedAsset: string;
  erc4626Vault: string;
  rateProvider: string;
  thirdFeed: string;
  lowerThresholdInBase1: bigint;
  fixedPriceInBase1: bigint;
  lowerThresholdInBase2: bigint;
  fixedPriceInBase2: bigint;
  lowerThresholdInBase3: bigint;
  fixedPriceInBase3: bigint;
};

/**
 * Build a Safe transaction payload to update an OracleAggregator route.
 *
 * @param aggregatorAddress - OracleAggregator contract address.
 * @param asset - Asset address to configure.
 * @param oracle - New oracle address for the asset.
 * @param aggregatorInterface - Contract interface used to encode the call.
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
 * Build a Safe transaction payload for granting a role.
 *
 * @param contractAddress - Contract address that owns the role.
 * @param role - Role identifier to grant.
 * @param grantee - Account that should receive the role.
 * @param contractInterface - Contract interface used to encode the call.
 */
function createGrantRoleTransaction(contractAddress: string, role: string, grantee: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [role, grantee]),
  };
}

/**
 * Check whether an equivalent Safe transaction is already queued.
 *
 * @param executor - Governance executor tracking queued transactions.
 * @param transaction - Transaction payload to search for.
 */
function hasQueuedTransaction(executor: GovernanceExecutor, transaction: SafeTransactionData): boolean {
  return executor.queuedTransactions.some(
    (queued) => queued.to === transaction.to && queued.value === transaction.value && queued.data === transaction.data,
  );
}

/**
 * Ensure governance can manage the OracleAggregator before queueing oracle flips.
 *
 * @param oracleAggregator - OracleAggregator contract instance.
 * @param aggregatorAddress - OracleAggregator contract address.
 * @param governanceMultisig - Governance multisig that should hold the role.
 * @param executor - Governance executor used for direct calls or Safe queueing.
 */
async function ensureGovernanceCanManageAggregator(
  oracleAggregator: any,
  aggregatorAddress: string,
  governanceMultisig: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  if (!executor.useSafe) {
    return true;
  }

  const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();

  if (await oracleAggregator.hasRole(oracleManagerRole, governanceMultisig)) {
    console.log(`✓ Governance already has ORACLE_MANAGER_ROLE on OracleAggregator`);
    return true;
  }

  const grantRoleTx = createGrantRoleTransaction(aggregatorAddress, oracleManagerRole, governanceMultisig, oracleAggregator.interface);

  if (hasQueuedTransaction(executor, grantRoleTx)) {
    console.log(`📝 ORACLE_MANAGER_ROLE grant already queued for OracleAggregator`);
    return false;
  }

  return executor.tryOrQueue(
    async () => {
      await oracleAggregator.grantRole(oracleManagerRole, governanceMultisig);
      console.log(`➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig} on OracleAggregator`);
    },
    () => grantRoleTx,
  );
}

/**
 * Compare an on-chain wrapper config against the expected feed configuration.
 *
 * @param existingFeed - Current on-chain feed config.
 * @param feedConfig - Expected feed config from repo config.
 */
function feedMatchesConfig(existingFeed: any, feedConfig: ThirdFeedConfig): boolean {
  return (
    existingFeed.erc4626Vault.toLowerCase() === feedConfig.erc4626Vault.toLowerCase() &&
    existingFeed.rateProvider.toLowerCase() === feedConfig.rateProvider.toLowerCase() &&
    existingFeed.thirdFeed.toLowerCase() === feedConfig.thirdFeed.toLowerCase() &&
    existingFeed.primaryThreshold.lowerThresholdInBase === feedConfig.lowerThresholdInBase1 &&
    existingFeed.primaryThreshold.fixedPriceInBase === feedConfig.fixedPriceInBase1 &&
    existingFeed.secondaryThreshold.lowerThresholdInBase === feedConfig.lowerThresholdInBase2 &&
    existingFeed.secondaryThreshold.fixedPriceInBase === feedConfig.fixedPriceInBase2 &&
    existingFeed.tertiaryThreshold.lowerThresholdInBase === feedConfig.lowerThresholdInBase3 &&
    existingFeed.tertiaryThreshold.fixedPriceInBase === feedConfig.fixedPriceInBase3
  );
}

/**
 * Validate that the three-leg wrapper is configured and pricing correctly before an oracle flip.
 *
 * @param hre - Hardhat runtime environment.
 * @param signer - Signer used for read-only calls.
 * @param wrapperAddress - Wrapper contract address.
 * @param feedConfig - Expected feed config from repo config.
 */
async function verifyThirdFeedReadiness(
  hre: HardhatRuntimeEnvironment,
  signer: Signer,
  wrapperAddress: string,
  feedConfig: ThirdFeedConfig,
): Promise<{ feed: any; candidatePrice: bigint }> {
  const wrapper = await hre.ethers.getContractAt("ERC4626RateProviderThirdFeedWrapperWithThresholding", wrapperAddress, signer);
  const feed = await wrapper.feeds(feedConfig.feedAsset);

  if (
    feed.erc4626Vault === hre.ethers.ZeroAddress ||
    feed.rateProvider === hre.ethers.ZeroAddress ||
    feed.thirdFeed === hre.ethers.ZeroAddress
  ) {
    throw new Error(`3-leg feed for asset ${feedConfig.feedAsset} is not configured on wrapper ${wrapperAddress}`);
  }

  if (!feedMatchesConfig(feed, feedConfig)) {
    throw new Error(`3-leg feed on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  const priceInfo = await wrapper.getPriceInfo(feedConfig.feedAsset);
  const candidatePrice = BigInt(priceInfo[0]);
  const candidateAlive = Boolean(priceInfo[1]);

  if (!candidateAlive || candidatePrice <= 0n) {
    throw new Error(`3-leg wrapper price for asset ${feedConfig.feedAsset} is not alive or non-positive`);
  }

  return { feed, candidatePrice };
}

/**
 * Queue or execute OracleAggregator flips for assets using the three-leg wrapper.
 *
 * @param hre - Hardhat runtime environment.
 * @param options - Optional execution overrides.
 * @param options.config - Preloaded config override used by tests or composed scripts.
 */
export async function executeOracleFlip(hre: HardhatRuntimeEnvironment, options?: { config?: Config }): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = options?.config ?? (await getConfig(hre));

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const wrapperDeployment = await deployments.get(USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID);
  const wrapperAddress = wrapperDeployment.address;

  const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  const feeds = config.oracleAggregators.USD.safeRateProviderAssets?.erc4626RateProviderThirdFeedWrappers || {};

  if (Object.keys(feeds).length === 0) {
    console.log(`ℹ️  No ERC4626RateProviderThirdFeed feeds configured in config; nothing to queue.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
    return true;
  }

  let allOperationsComplete = true;
  const governanceReady = await ensureGovernanceCanManageAggregator(
    oracleAggregator,
    oracleAggregatorDeployment.address,
    governanceMultisig,
    executor,
  );
  if (!governanceReady) allOperationsComplete = false;

  for (const [_asset, feedConfig] of Object.entries(feeds)) {
    const asset = feedConfig.feedAsset;
    console.log(`\n  🔍 Validating 3-leg feed readiness for asset ${asset}...`);
    const { feed, candidatePrice } = await verifyThirdFeedReadiness(hre, deployerSigner, wrapperAddress, feedConfig);

    console.log(
      `    ℹ️ Wrapper erc4626Vault=${feed.erc4626Vault}, rateProvider=${feed.rateProvider}, thirdFeed=${feed.thirdFeed}, candidatePrice=${candidatePrice}`,
    );

    const currentOracleAddress = await oracleAggregator.assetOracles(asset);

    if (currentOracleAddress.toLowerCase() === wrapperAddress.toLowerCase()) {
      console.log(`    ✅ OracleAggregator already points to ${wrapperAddress}; skipping.`);
      continue;
    }

    if (currentOracleAddress === ethers.ZeroAddress) {
      console.log(`    ℹ️ OracleAggregator has no existing oracle for ${asset}; treating this as initial oracle setup.`);
    } else {
      const currentPriceInfo = await oracleAggregator.getPriceInfo(asset);
      const currentPrice = BigInt(currentPriceInfo[0]);
      const currentAlive = Boolean(currentPriceInfo[1]);

      if (!currentAlive || currentPrice <= 0n) {
        throw new Error(`Current oracle price for asset ${asset} is not alive or non-positive; aborting flip.`);
      }

      const ratio = (candidatePrice * RATIO_PRECISION) / currentPrice;
      console.log(
        `    ℹ️ Current oracle address=${currentOracleAddress}, price=${currentPrice}, ratio=${ratio} (precision=${RATIO_PRECISION})`,
      );

      if (ratio > MAX_RATIO || ratio < MIN_RATIO) {
        throw new Error(
          `Candidate price ${candidatePrice} deviates from current oracle price ${currentPrice} by more than 1% for ${asset} (ratio=${ratio}).`,
        );
      }
    }

    console.log(`  🎯 Queueing OracleAggregator.setOracle for asset ${asset} -> wrapper ${wrapperAddress}`);
    const complete = await executor.tryOrQueue(
      async () => {
        await oracleAggregator.setOracle(asset, wrapperAddress);
        console.log(`    ✅ Oracle flipped for ${asset}`);
      },
      () => createSetOracleTransaction(oracleAggregatorDeployment.address, asset, wrapperAddress, oracleAggregator.interface),
    );

    if (!complete) allOperationsComplete = false;
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush("Queue ERC4626RateProviderThirdFeed wrapper oracle updates");

    if (executor.useSafe) {
      if (!flushed) {
        throw new Error("Failed to prepare Safe batch for ERC4626RateProviderThirdFeed wrapper oracle updates.");
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }
  }

  console.log(`\n✅ All ERC4626RateProviderThirdFeed oracle flip operations completed or queued.`);
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeOracleFlip(hre);
};

func.id = "queue-erc4626-rate-provider-third-feed-oracle-updates";
func.tags = ["usd-oracle", "oracle-wrapper", "erc4626-rate-provider-third-feed", "oracle-flip"];
func.dependencies = [USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID];

export default func;
