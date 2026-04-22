import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT } from "../../typescript/oracle-wrapper-artifacts";

const RATIO_PRECISION = 10_000n;
const MAX_RATIO = 10_100n; // 1.01x
const MIN_RATIO = 9_900n; // 0.99x

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

type CompositeFeedConfig = {
  feedAsset: string;
  feed1: string;
  feed2: string;
  lowerThresholdInBase1: bigint;
  fixedPriceInBase1: bigint;
  lowerThresholdInBase2: bigint;
  fixedPriceInBase2: bigint;
};

type SimpleFeedConfig = {
  feed: string;
  lowerThreshold: bigint;
  fixedPrice: bigint;
};

type FlipTarget = {
  label: string;
  asset: string;
  kind: "simple" | "composite";
};

/**
 * Build a Safe transaction payload that flips an asset's oracle.
 *
 * @param aggregatorAddress - OracleAggregator contract address.
 * @param asset - Asset whose oracle should be updated.
 * @param oracle - New oracle address to set for the asset.
 * @param aggregatorInterface - OracleAggregator contract interface used for encoding.
 * @returns Encoded governance transaction data.
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
 * Build a Safe transaction payload to grant a role.
 *
 * @param contractAddress - Contract address.
 * @param role - Role hash to grant.
 * @param grantee - Account receiving the role.
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
 * Check whether an equivalent transaction is already queued locally.
 *
 * @param executor - Governance executor holding queued transactions.
 * @param transaction - Transaction to find.
 */
function hasQueuedTransaction(executor: GovernanceExecutor, transaction: SafeTransactionData): boolean {
  return executor.queuedTransactions.some(
    (queued) => queued.to === transaction.to && queued.value === transaction.value && queued.data === transaction.data,
  );
}

/**
 * Ensure governance can call ORACLE_MANAGER_ROLE-protected aggregator methods.
 *
 * @param oracleAggregator - OracleAggregator contract.
 * @param aggregatorAddress - OracleAggregator address.
 * @param governanceMultisig - Governance Safe address.
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
      const tx = await oracleAggregator.grantRole(oracleManagerRole, governanceMultisig);
      await tx.wait();
      console.log(`➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig} on OracleAggregator`);
    },
    () => grantRoleTx,
  );
}

/**
 * Ensure a simple wrapper feed is configured exactly as expected and can price the asset.
 *
 * @param hre - Hardhat runtime environment.
 * @param wrapperAddress - Chainlink wrapper address.
 * @param asset - Asset to validate.
 * @param feedConfig - Expected feed and threshold config.
 * @param signer - Signer used for read-only calls.
 */
async function verifySimpleFeedReadiness(
  hre: HardhatRuntimeEnvironment,
  wrapperAddress: string,
  asset: string,
  feedConfig: SimpleFeedConfig,
  signer: any,
): Promise<bigint> {
  const { ethers } = hre;
  const wrapper = await ethers.getContractAt(CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT, wrapperAddress, signer);
  const configured = await wrapper.assetToFeed(asset);

  if (configured.feed === ZeroAddress) {
    throw new Error(`Simple feed for asset ${asset} is not configured on wrapper ${wrapperAddress}`);
  }

  if (configured.feed.toLowerCase() !== feedConfig.feed.toLowerCase()) {
    throw new Error(`Configured feed ${configured.feed} does not match expected ${feedConfig.feed}`);
  }

  if (
    BigInt(configured.threshold.lowerThresholdInBase) !== feedConfig.lowerThreshold ||
    BigInt(configured.threshold.fixedPriceInBase) !== feedConfig.fixedPrice
  ) {
    throw new Error(`Threshold on wrapper does not match configuration for asset ${asset}`);
  }

  const priceInfo = await wrapper.getPriceInfo(asset);
  const candidatePrice = BigInt(priceInfo[0]);
  const candidateAlive = Boolean(priceInfo[1]);

  if (!candidateAlive || candidatePrice <= 0n) {
    throw new Error(`Wrapper price for asset ${asset} is not alive or non-positive; aborting flip.`);
  }

  return candidatePrice;
}

/**
 * Ensure the composite wrapper already holds the exact configuration expected for the asset and can price it.
 *
 * @param hre - Hardhat runtime environment.
 * @param wrapperAddress - Deployed composite wrapper address.
 * @param feedConfig - Expected composite feed configuration.
 * @param signer - Signer used for read-only calls.
 * @returns Candidate price produced by the wrapper.
 */
async function verifyCompositeFeedReadiness(
  hre: HardhatRuntimeEnvironment,
  wrapperAddress: string,
  feedConfig: CompositeFeedConfig,
  signer: any,
): Promise<bigint> {
  const { ethers } = hre;
  const wrapper = await ethers.getContractAt(CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT, wrapperAddress, signer);
  const composite = await wrapper.compositeFeeds(feedConfig.feedAsset);

  if (composite.feed1 === ZeroAddress || composite.feed2 === ZeroAddress) {
    throw new Error(`Composite feed for asset ${feedConfig.feedAsset} is not configured on wrapper ${wrapperAddress}`);
  }

  if (composite.feed1.toLowerCase() !== feedConfig.feed1.toLowerCase()) {
    throw new Error(`Configured feed1 ${composite.feed1} does not match expected ${feedConfig.feed1}`);
  }

  if (composite.feed2.toLowerCase() !== feedConfig.feed2.toLowerCase()) {
    throw new Error(`Configured feed2 ${composite.feed2} does not match expected ${feedConfig.feed2}`);
  }

  if (
    BigInt(composite.primaryThreshold.lowerThresholdInBase) !== feedConfig.lowerThresholdInBase1 ||
    BigInt(composite.primaryThreshold.fixedPriceInBase) !== feedConfig.fixedPriceInBase1
  ) {
    throw new Error(`Primary threshold on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  if (
    BigInt(composite.secondaryThreshold.lowerThresholdInBase) !== feedConfig.lowerThresholdInBase2 ||
    BigInt(composite.secondaryThreshold.fixedPriceInBase) !== feedConfig.fixedPriceInBase2
  ) {
    throw new Error(`Secondary threshold on wrapper does not match configuration for asset ${feedConfig.feedAsset}`);
  }

  const priceInfo = await wrapper.getPriceInfo(feedConfig.feedAsset);
  const candidatePrice = BigInt(priceInfo[0]);
  const candidateAlive = Boolean(priceInfo[1]);

  if (!candidateAlive || candidatePrice <= 0n) {
    throw new Error(`Wrapper price for asset ${feedConfig.feedAsset} is not alive or non-positive; aborting flip.`);
  }

  return candidatePrice;
}

/**
 * Queue or execute OracleAggregator pointer updates for the in-scope USD composite assets after readiness checks.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when flips complete or false when governance actions were queued.
 */
async function executeOracleFlip(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);
  console.log(`🔐 Governance multisig: ${config.walletAddresses.governanceMultisig}`);

  const wrapperDeployment = await deployments.get(USD_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID);
  const wrapperAddress = wrapperDeployment.address;
  const wrapperAddressLower = wrapperAddress.toLowerCase();

  const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  const thresholdFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding || {};
  const compositeFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};

  const targets: FlipTarget[] = [
    { label: "frxUSD", asset: config.tokenAddresses.frxUSD, kind: "simple" as const },
    { label: "scUSD", asset: config.tokenAddresses.scUSD, kind: "simple" as const },
    { label: "sfrxUSD", asset: config.tokenAddresses.sfrxUSD, kind: "composite" as const },
    { label: "stS", asset: config.tokenAddresses.stS, kind: "composite" as const },
    { label: "PTaUSDC", asset: config.tokenAddresses.PTaUSDC, kind: "composite" as const },
    { label: "PTwstkscUSD", asset: config.tokenAddresses.PTwstkscUSD, kind: "composite" as const },
  ].filter((target) => Boolean(target.asset));

  if (targets.length === 0) {
    console.log("\n⚠️ No in-scope USD composite assets configured for this network; skipping oracle flips.");
    return true;
  }

  let allOperationsComplete = true;
  const governanceReady = await ensureGovernanceCanManageAggregator(
    oracleAggregator,
    oracleAggregatorDeployment.address,
    config.walletAddresses.governanceMultisig,
    executor,
  );

  if (!governanceReady) {
    allOperationsComplete = false;
  }

  for (const target of targets) {
    let candidatePrice: bigint;

    if (target.kind === "simple") {
      const feedConfig = thresholdFeeds[target.asset];

      if (!feedConfig) {
        throw new Error(`Missing Chainlink-backed USD simple threshold configuration for ${target.label} (${target.asset}).`);
      }

      console.log(`\n  🔍 Validating simple feed readiness for ${target.label} (${target.asset})...`);
      candidatePrice = await verifySimpleFeedReadiness(hre, wrapperAddress, target.asset, feedConfig, deployerSigner);
    } else {
      const feedConfig = compositeFeeds[target.asset];

      if (!feedConfig) {
        throw new Error(`Missing Chainlink-backed USD composite configuration for ${target.label} (${target.asset}).`);
      }

      console.log(`\n  🔍 Validating composite feed readiness for ${target.label} (${target.asset})...`);
      candidatePrice = await verifyCompositeFeedReadiness(hre, wrapperAddress, feedConfig, deployerSigner);
    }

    console.log(`    ℹ️ Candidate wrapper price=${candidatePrice}`);

    const currentOracleAddress = await oracleAggregator.assetOracles(target.asset);

    if (currentOracleAddress.toLowerCase() === wrapperAddressLower) {
      console.log(`    ✅ OracleAggregator already points ${target.label} to ${wrapperAddress}; nothing to do.`);
      continue;
    }

    if (currentOracleAddress === ZeroAddress) {
      throw new Error(`OracleAggregator has no existing oracle configured for ${target.label}; aborting flip.`);
    }

    const currentPriceInfo = await oracleAggregator.getPriceInfo(target.asset);
    const currentPrice = BigInt(currentPriceInfo[0]);
    const currentAlive = Boolean(currentPriceInfo[1]);

    if (!currentAlive || currentPrice <= 0n) {
      throw new Error(`Current oracle price for ${target.label} is not alive or non-positive; aborting flip.`);
    }

    const ratio = (candidatePrice * RATIO_PRECISION) / currentPrice;
    console.log(`    ℹ️ Current oracle=${currentOracleAddress}, price=${currentPrice}, ratio=${ratio} (precision=${RATIO_PRECISION})`);

    if (ratio > MAX_RATIO || ratio < MIN_RATIO) {
      throw new Error(
        `Candidate price ${candidatePrice} deviates from current oracle price ${currentPrice} beyond safe bounds for ${target.label} (ratio=${ratio}).`,
      );
    }

    console.log(`  🎯 Queueing OracleAggregator.setOracle for ${target.label} -> ${wrapperAddress}`);

    const complete = await executor.tryOrQueue(
      async () => {
        const tx = await oracleAggregator.setOracle(target.asset, wrapperAddress);
        await tx.wait();
        console.log(`    ✅ Oracle flipped for ${target.label}`);
      },
      () => createSetOracleTransaction(oracleAggregatorDeployment.address, target.asset, wrapperAddress, oracleAggregator.interface),
    );

    if (!complete) {
      allOperationsComplete = false;
    }
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush("Queue USD composite oracle flips");

    if (executor.useSafe) {
      if (!flushed) {
        throw new Error("Failed to prepare Safe batch for USD composite oracle flips.");
      }

      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   Re-run this script after governance executes the queued transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }

    console.log("\n❌ Non-Safe mode: direct execution failed and no Safe batch was prepared.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: incomplete ❌`);
    return false;
  }

  console.log("\n✅ All USD composite oracle flip operations completed or were already in place.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeOracleFlip(hre);
};

func.id = "queue-usd-composite-oracle-flips";
func.tags = ["oracle", "usd-oracle", "chainlink", "oracle-flip", "usd-composite-feeds"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID, "update-usd-composite-wrapper-feeds"];

export default func;
