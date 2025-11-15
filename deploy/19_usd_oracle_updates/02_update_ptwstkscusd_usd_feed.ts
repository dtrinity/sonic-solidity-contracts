import { Signer, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { SafeTransactionData } from "../../.shared/lib/roles/types";
import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID, USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

type CompositePriceDiagnostics = {
  candidatePrice: bigint;
  priceInBase1: bigint;
  priceInBase2: bigint;
  chainlinkAnswer1: bigint;
  chainlinkAnswer2: bigint;
  feed1Decimals: number;
  feed2Decimals: number;
  updatedAt1: bigint;
  updatedAt2: bigint;
};

/**
 * Read the live Chainlink feeds to mirror the on-chain composition.
 *
 * @param ethers - Hardhat ethers helper.
 * @param feed1 - First Chainlink feed address
 * @param feed2 - Second Chainlink feed address
 * @param baseCurrencyUnit - Base currency scaling factor (e.g. 1e8).
 * @param signer - Signer used to perform read-only calls.
 * @returns Composite price diagnostics for logging and safety checks.
 */
async function buildCompositePriceDiagnostics(
  ethers: HardhatRuntimeEnvironment["ethers"],
  feed1: string,
  feed2: string,
  baseCurrencyUnit: bigint,
  signer: Signer,
): Promise<CompositePriceDiagnostics> {
  const priceFeed1 = new ethers.Contract(feed1, PRICE_FEED_ABI, signer);
  const priceFeed2 = new ethers.Contract(feed2, PRICE_FEED_ABI, signer);

  const feed1DecimalsRaw = await priceFeed1.decimals();
  const feed1Decimals = typeof feed1DecimalsRaw === "number" ? feed1DecimalsRaw : Number(feed1DecimalsRaw);

  const feed2DecimalsRaw = await priceFeed2.decimals();
  const feed2Decimals = typeof feed2DecimalsRaw === "number" ? feed2DecimalsRaw : Number(feed2DecimalsRaw);

  if (feed1Decimals === 0) {
    throw new Error(`Feed1 ${feed1} reports 0 decimals`);
  }

  if (feed2Decimals === 0) {
    throw new Error(`Feed2 ${feed2} reports 0 decimals`);
  }

  const feed1Unit = 10n ** BigInt(feed1Decimals);
  const feed2Unit = 10n ** BigInt(feed2Decimals);

  const roundData1 = await priceFeed1.latestRoundData();
  const answer1 = BigInt(roundData1.answer ?? roundData1[1]);
  const updatedAt1 = BigInt(roundData1.updatedAt ?? roundData1[3]);

  const roundData2 = await priceFeed2.latestRoundData();
  const answer2 = BigInt(roundData2.answer ?? roundData2[1]);
  const updatedAt2 = BigInt(roundData2.updatedAt ?? roundData2[3]);

  if (answer1 <= 0n) {
    throw new Error(`Feed1 ${feed1} returned non-positive answer ${answer1}`);
  }

  if (answer2 <= 0n) {
    throw new Error(`Feed2 ${feed2} returned non-positive answer ${answer2}`);
  }

  // Convert both prices to BASE_CURRENCY_UNIT first
  const priceInBase1 = (answer1 * baseCurrencyUnit) / feed1Unit;
  const priceInBase2 = (answer2 * baseCurrencyUnit) / feed2Unit;

  // Calculate composite price: (price1 * price2) / BASE_CURRENCY_UNIT
  const candidatePrice = (priceInBase1 * priceInBase2) / baseCurrencyUnit;

  return {
    candidatePrice,
    priceInBase1,
    priceInBase2,
    chainlinkAnswer1: answer1,
    chainlinkAnswer2: answer2,
    feed1Decimals,
    feed2Decimals,
    updatedAt1,
    updatedAt2,
  };
}

/**
 * Build a Safe transaction payload to remove a composite feed.
 *
 * @param wrapperAddress - The address of the wrapper contract
 * @param asset - The asset address for which to remove the composite feed
 * @param wrapperInterface - The contract interface for encoding function data
 */
function createRemoveCompositeFeedTransaction(wrapperAddress: string, asset: string, wrapperInterface: any): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("removeCompositeFeed", [asset]),
  };
}

/**
 * Build a Safe transaction payload to add a composite feed.
 *
 * @param wrapperAddress - The address of the wrapper contract
 * @param asset - The asset address for which to add the composite feed
 * @param feed1 - The first Chainlink price feed address
 * @param feed2 - The second Chainlink price feed address
 * @param lowerThresholdInBase1 - Lower threshold for the first price feed in base currency units
 * @param fixedPriceInBase1 - Fixed price for the first price feed in base currency units
 * @param lowerThresholdInBase2 - Lower threshold for the second price feed in base currency units
 * @param fixedPriceInBase2 - Fixed price for the second price feed in base currency units
 * @param wrapperInterface - The contract interface for encoding function data
 */
function createAddCompositeFeedTransaction(
  wrapperAddress: string,
  asset: string,
  feed1: string,
  feed2: string,
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
      feed1,
      feed2,
      lowerThresholdInBase1,
      fixedPriceInBase1,
      lowerThresholdInBase2,
      fixedPriceInBase2,
    ]),
  };
}

/**
 * Handle the PT-wstkscUSD feed update.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when the update completed or actions were queued.
 */
async function executeUpdate(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const usdConfig = config.oracleAggregators.USD;
  const baseCurrencyUnit = BigInt(10) ** BigInt(usdConfig.priceDecimals);

  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  // Get existing wrapper
  const { address: wrapperAddress } = await deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const wrapper = await ethers.getContractAt("RedstoneChainlinkCompositeWrapperWithThresholding", wrapperAddress, deployerSigner);

  console.log(`✅ Using RedstoneChainlinkCompositeWrapperWithThresholding at: ${wrapperAddress}`);

  // PT-wstkscUSD configuration
  const ptwstkscUSDAddress = config.tokenAddresses.PTwstkscUSD;

  if (!ptwstkscUSDAddress) {
    console.log("\n⚠️ PT-wstkscUSD address not configured for this network; skipping PT-wstkscUSD oracle update.");
    return true;
  }

  // Feed addresses
  const feed1 = "0x2EfEb81d6A0E5638bfe917C6cFCeb42989058d08"; // PT-wstkscUSD/scUSD Pendle Chainlink feed (keep)
  const feed2New = "0x55bCa887199d5520B3Ce285D41e6dC10C08716C9"; // USDC/USD (new)

  // Threshold configuration (keep same as current)
  const lowerThresholdInBase1 = 0n; // No thresholding
  const fixedPriceInBase1 = 0n;
  const lowerThresholdInBase2 = baseCurrencyUnit; // Threshold at BASE_CURRENCY_UNIT
  const fixedPriceInBase2 = baseCurrencyUnit;

  // Check current feed configuration
  const existingFeed = await wrapper.compositeFeeds(ptwstkscUSDAddress);
  const needsUpdate =
    existingFeed.feed1.toLowerCase() !== feed1.toLowerCase() || existingFeed.feed2.toLowerCase() !== feed2New.toLowerCase();

  if (!needsUpdate && existingFeed.feed1 !== ZeroAddress) {
    console.log(`✅ PT-wstkscUSD composite feed already configured correctly.`);
    console.log(`   Feed1: ${existingFeed.feed1}`);
    console.log(`   Feed2: ${existingFeed.feed2}`);
    return true;
  }

  console.log(`\n🔧 Updating PT-wstkscUSD composite feed...`);
  console.log(`  📊 Asset: ${ptwstkscUSDAddress}`);
  console.log(`    Feed1 (PT-wstkscUSD/scUSD): ${feed1} ${existingFeed.feed1.toLowerCase() === feed1.toLowerCase() ? "✓" : "→ UPDATE"}`);
  console.log(`    Feed2: ${existingFeed.feed2 !== ZeroAddress ? existingFeed.feed2 : "NOT SET"} → ${feed2New} (USDC/USD)`);

  // Build price diagnostics with new feed
  const diagnostics = await buildCompositePriceDiagnostics(ethers, feed1, feed2New, baseCurrencyUnit, deployerSigner);
  console.log(
    `    ℹ️ Feed1 answer=${diagnostics.chainlinkAnswer1} (decimals=${diagnostics.feed1Decimals}), feed2 answer=${diagnostics.chainlinkAnswer2} (decimals=${diagnostics.feed2Decimals})`,
  );
  console.log(
    `    ℹ️ Candidate composite price=${diagnostics.candidatePrice}, leg1=${diagnostics.priceInBase1}, leg2=${diagnostics.priceInBase2}`,
  );

  const removalRequired = existingFeed.feed1 !== ZeroAddress;
  let removalComplete = false;

  // Remove existing feed if it exists
  if (removalRequired) {
    const removeComplete = await executor.tryOrQueue(
      async () => {
        const tx = await wrapper.removeCompositeFeed(ptwstkscUSDAddress);
        await tx.wait();
        console.log(`    ✅ Removed existing composite feed for PT-wstkscUSD`);
      },
      () => createRemoveCompositeFeedTransaction(wrapperAddress, ptwstkscUSDAddress, wrapper.interface),
    );

    if (!removeComplete) {
      console.log(`    📝 Queued Safe transaction to remove existing feed.`);
    } else {
      removalComplete = true;
    }
  }

  // Add new composite feed
  const addComplete = await executor.tryOrQueue(
    async () => {
      const tx = await wrapper.addCompositeFeed(
        ptwstkscUSDAddress,
        feed1,
        feed2New,
        lowerThresholdInBase1,
        fixedPriceInBase1,
        lowerThresholdInBase2,
        fixedPriceInBase2,
      );
      await tx.wait();
      console.log(`    ✅ Added updated composite feed for PT-wstkscUSD with USDC/USD feed`);
    },
    () =>
      createAddCompositeFeedTransaction(
        wrapperAddress,
        ptwstkscUSDAddress,
        feed1,
        feed2New,
        lowerThresholdInBase1,
        fixedPriceInBase1,
        lowerThresholdInBase2,
        fixedPriceInBase2,
        wrapper.interface,
      ),
  );

  if (!addComplete) {
    console.log(`    📝 Queued Safe transaction to add updated feed.`);
  }

  // Verify price if update completed immediately
  const updateComplete = addComplete && (!removalRequired || removalComplete);

  if (updateComplete) {
    try {
      const price = await wrapper.getAssetPrice(ptwstkscUSDAddress);
      console.log(`    💵 Updated wrapper price for PT-wstkscUSD: ${price}`);
    } catch (error) {
      console.warn(`    ⚠️ Could not read wrapper price after update: ${error}`);
    }
  } else {
    console.log(`    ℹ️ Wrapper price for PT-wstkscUSD will be available once Safe transactions are executed.`);
  }

  // Handle governance operations if needed
  if (!updateComplete) {
    const flushed = await executor.flush(`Update PT-wstkscUSD oracle feed to USDC/USD`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
        return false;
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The update script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

/**
 * Hardhat deploy entry point.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when the script finishes or queues governance actions.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeUpdate(hre);
};

func.id = "update-ptwstkscusd-usd-feed";
func.tags = ["usd-oracle", "oracle-wrapper", "ptwstkscusd"];
func.dependencies = [USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, USD_ORACLE_AGGREGATOR_ID];

export default func;
