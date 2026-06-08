import { Signer, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { SafeTransactionData } from "../../.shared/lib/roles/types";
import { getConfig } from "../../config/config";
import { USD_CHAINLINK_FEED_WRAPPER_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT } from "../../typescript/oracle-wrapper-artifacts";

const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

type PriceDiagnostics = {
  price: bigint;
  answer: bigint;
  feedDecimals: number;
  updatedAt: bigint;
};

type FeedTarget = {
  label: string;
  asset: string;
};

/**
 * Read a live Chainlink-backed feed to confirm it returns a sane value.
 *
 * @param ethers - Hardhat ethers helper.
 * @param feed - Chainlink-backed price feed address.
 * @param baseCurrencyUnit - Base currency scaling factor for the wrapper.
 * @param signer - Signer used for read-only calls.
 */
async function buildPriceDiagnostics(
  ethers: HardhatRuntimeEnvironment["ethers"],
  feed: string,
  baseCurrencyUnit: bigint,
  signer: Signer,
): Promise<PriceDiagnostics> {
  const priceFeed = new ethers.Contract(feed, PRICE_FEED_ABI, signer);

  const feedDecimalsRaw = await priceFeed.decimals();
  const feedDecimals = typeof feedDecimalsRaw === "number" ? feedDecimalsRaw : Number(feedDecimalsRaw);

  if (feedDecimals === 0) {
    throw new Error(`Feed ${feed} reports 0 decimals`);
  }

  const feedUnit = 10n ** BigInt(feedDecimals);

  const roundData = await priceFeed.latestRoundData();
  const answer = BigInt(roundData.answer ?? roundData[1]);
  const updatedAt = BigInt(roundData.updatedAt ?? roundData[3]);

  if (answer <= 0n) {
    throw new Error(`Feed ${feed} returned non-positive answer ${answer}`);
  }

  return {
    price: (answer * baseCurrencyUnit) / feedUnit,
    answer,
    feedDecimals,
    updatedAt,
  };
}

/**
 * Build a Safe transaction payload to set a wrapper feed.
 *
 * @param wrapperAddress - Wrapper contract address.
 * @param asset - Asset address to configure.
 * @param feed - Chainlink-backed feed address to set.
 * @param wrapperInterface - Contract interface used to encode the call.
 */
function createSetFeedTransaction(wrapperAddress: string, asset: string, feed: string, wrapperInterface: any): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setFeed", [asset, feed]),
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
 * Ensure governance can manage the wrapper before queueing feed updates.
 *
 * @param wrapper - Wrapper contract instance.
 * @param wrapperAddress - Wrapper contract address.
 * @param governanceMultisig - Governance multisig that should hold the role.
 * @param executor - Governance executor used for direct calls or Safe queueing.
 */
async function ensureGovernanceCanManageWrapper(
  wrapper: any,
  wrapperAddress: string,
  governanceMultisig: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  if (!executor.useSafe) {
    return true;
  }

  const oracleManagerRole = await wrapper.ORACLE_MANAGER_ROLE();

  if (await wrapper.hasRole(oracleManagerRole, governanceMultisig)) {
    console.log(`   ✓ Governance already has ORACLE_MANAGER_ROLE on ${wrapperAddress}`);
    return true;
  }

  const grantRoleTx = createGrantRoleTransaction(wrapperAddress, oracleManagerRole, governanceMultisig, wrapper.interface);

  if (hasQueuedTransaction(executor, grantRoleTx)) {
    console.log(`   📝 ORACLE_MANAGER_ROLE grant already queued for governance on ${wrapperAddress}`);
    return false;
  }

  return executor.tryOrQueue(
    async () => {
      const tx = await wrapper.grantRole(oracleManagerRole, governanceMultisig);
      await tx.wait();
      console.log(`   ➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig}`);
    },
    () => grantRoleTx,
  );
}

/**
 * Update or confirm Chainlink-backed S/USD simple wrapper feeds for wS and dS.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when the script completes immediately, false when governance actions are queued.
 */
async function executeUpdate(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const usdConfig = config.oracleAggregators.USD;
  const baseCurrencyUnit = 10n ** BigInt(usdConfig.priceDecimals);
  const plainFeeds = usdConfig.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  const { address: wrapperAddress } = await deployments.get(USD_CHAINLINK_FEED_WRAPPER_ID);
  const wrapper = await ethers.getContractAt(LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT, wrapperAddress, deployerSigner);

  console.log(`🔐 Governance multisig: ${config.walletAddresses.governanceMultisig}`);
  console.log(`✅ Using Chainlink feed wrapper at: ${wrapperAddress}`);
  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  const targets: FeedTarget[] = [
    { label: "wS", asset: config.tokenAddresses.wS },
    { label: "dS", asset: config.tokenAddresses.dS },
  ].filter((target) => Boolean(target.asset));

  if (targets.length === 0) {
    console.log("\n⚠️ No in-scope S/USD assets configured for this network; skipping wrapper feed migration.");
    return true;
  }

  let hasPendingGovernance = false;

  const governanceReady = await ensureGovernanceCanManageWrapper(
    wrapper,
    wrapperAddress,
    config.walletAddresses.governanceMultisig,
    executor,
  );

  if (!governanceReady) {
    hasPendingGovernance = true;
  }

  for (const target of targets) {
    const expectedFeed = plainFeeds[target.asset];

    if (!expectedFeed) {
      throw new Error(`Missing Chainlink-backed S/USD feed configuration for ${target.label} (${target.asset}).`);
    }

    const currentFeed = await wrapper.assetToFeed(target.asset);
    const needsUpdate = currentFeed.toLowerCase() !== expectedFeed.toLowerCase();

    if (!needsUpdate && currentFeed !== ZeroAddress) {
      console.log(`\n✅ ${target.label} already points at the expected Chainlink-backed S/USD feed.`);
      console.log(`   Asset: ${target.asset}`);
      console.log(`   Feed: ${currentFeed}`);

      try {
        const price = await wrapper.getAssetPrice(target.asset);
        console.log(`   💵 Wrapper price: ${price}`);
      } catch (error) {
        console.warn(`   ⚠️ Could not read wrapper price for ${target.label}: ${error}`);
      }

      continue;
    }

    console.log(`\n🔧 Updating ${target.label} to the configured Chainlink-backed S/USD feed...`);
    console.log(`   Asset: ${target.asset}`);
    console.log(`   Feed: ${currentFeed !== ZeroAddress ? currentFeed : "NOT SET"} → ${expectedFeed}`);

    const diagnostics = await buildPriceDiagnostics(ethers, expectedFeed, baseCurrencyUnit, deployerSigner);
    console.log(`   ℹ️ Chainlink answer=${diagnostics.answer} (decimals=${diagnostics.feedDecimals}, updatedAt=${diagnostics.updatedAt})`);
    console.log(`   ℹ️ Candidate wrapper price=${diagnostics.price}`);

    const updateComplete = await executor.tryOrQueue(
      async () => {
        const tx = await wrapper.setFeed(target.asset, expectedFeed);
        await tx.wait();
        console.log(`   ✅ Updated ${target.label} to the configured Chainlink-backed S/USD feed.`);
      },
      () => createSetFeedTransaction(wrapperAddress, target.asset, expectedFeed, wrapper.interface),
    );

    if (!updateComplete) {
      hasPendingGovernance = true;
      console.log(`   📝 Queued Safe transaction to update ${target.label}.`);
      console.log(`   ℹ️ Wrapper price for ${target.label} will be available once the Safe transaction is executed.`);
      continue;
    }

    try {
      const price = await wrapper.getAssetPrice(target.asset);
      console.log(`   💵 Updated wrapper price for ${target.label}: ${price}`);
    } catch (error) {
      throw new Error(`Failed to read wrapper price for ${target.label} after updating its Chainlink-backed S/USD feed. ${error}`);
    }
  }

  if (hasPendingGovernance) {
    const flushed = await executor.flush("Configure Chainlink-backed S/USD simple wrapper feeds");

    if (executor.useSafe) {
      if (!flushed) {
        throw new Error("Failed to prepare Safe batch for Chainlink-backed S/USD simple wrapper feed updates.");
      }

      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   Re-run this script after governance executes the queued transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }
  }

  console.log("\n✅ All S/USD simple wrapper feed operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeUpdate(hre);
};

func.id = "update-s-usd-simple-wrapper-feeds";
func.tags = ["oracle", "usd-oracle", "chainlink", "wrapper-migration", "s-usd-simple-feeds"];
func.dependencies = [USD_CHAINLINK_FEED_WRAPPER_ID];

export default func;
