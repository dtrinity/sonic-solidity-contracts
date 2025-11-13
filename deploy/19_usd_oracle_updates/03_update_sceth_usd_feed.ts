import { Signer, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { SafeTransactionData } from "../../.shared/lib/roles/types";
import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID, USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

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

/**
 * Read the live Chainlink feed to validate it works.
 *
 * @param ethers - Hardhat ethers helper.
 * @param feed - Chainlink feed address
 * @param baseCurrencyUnit - Base currency scaling factor (e.g. 1e8).
 * @param signer - Signer used to perform read-only calls.
 * @returns Price diagnostics for logging and safety checks.
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

  // Convert price to BASE_CURRENCY_UNIT
  const price = (answer * baseCurrencyUnit) / feedUnit;

  return {
    price,
    answer,
    feedDecimals,
    updatedAt,
  };
}

/**
 * Build a Safe transaction payload to set a feed.
 *
 * @param wrapperAddress - The address of the wrapper contract
 * @param asset - The asset address for which to set the feed
 * @param feed - The Chainlink price feed address
 * @param wrapperInterface - The contract interface for encoding function data
 */
function createSetFeedTransaction(wrapperAddress: string, asset: string, feed: string, wrapperInterface: any): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setFeed", [asset, feed]),
  };
}

/**
 * Handle the scETH feed update.
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
  const { address: wrapperAddress } = await deployments.get(USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID);
  const wrapper = await ethers.getContractAt("RedstoneChainlinkWrapper", wrapperAddress, deployerSigner);

  console.log(`✅ Using RedstoneChainlinkWrapper at: ${wrapperAddress}`);

  // scETH configuration
  const scETHAddress = config.tokenAddresses.scETH;

  if (!scETHAddress) {
    throw new Error("scETH address not found in config");
  }

  // Feed addresses

  const feedNew = "0x824364077993847f71293B24ccA8567c00c2de11"; // WETH/USD (new)

  // Check current feed configuration
  const currentFeed = await wrapper.assetToFeed(scETHAddress);
  const needsUpdate = currentFeed.toLowerCase() !== feedNew.toLowerCase();

  if (!needsUpdate && currentFeed !== ZeroAddress) {
    console.log(`✅ scETH feed already configured correctly.`);
    console.log(`   Feed: ${currentFeed}`);
    return true;
  }

  console.log(`\n🔧 Updating scETH feed...`);
  console.log(`  📊 Asset: ${scETHAddress}`);
  console.log(`    Feed: ${currentFeed !== ZeroAddress ? currentFeed : "NOT SET"} → ${feedNew} (WETH/USD)`);

  // Build price diagnostics with new feed
  const diagnostics = await buildPriceDiagnostics(ethers, feedNew, baseCurrencyUnit, deployerSigner);
  console.log(`    ℹ️ Feed answer=${diagnostics.answer} (decimals=${diagnostics.feedDecimals})`);
  console.log(`    ℹ️ Candidate price=${diagnostics.price}`);

  // Update feed (setFeed overwrites existing feeds)
  const updateComplete = await executor.tryOrQueue(
    async () => {
      const tx = await wrapper.setFeed(scETHAddress, feedNew);
      await tx.wait();
      console.log(`    ✅ Updated scETH feed to WETH/USD`);
    },
    () => createSetFeedTransaction(wrapperAddress, scETHAddress, feedNew, wrapper.interface),
  );

  if (!updateComplete) {
    console.log(`    📝 Queued Safe transaction to update feed.`);
  }

  // Verify price if update completed immediately
  if (updateComplete) {
    try {
      const price = await wrapper.getAssetPrice(scETHAddress);
      console.log(`    💵 Updated wrapper price for scETH: ${price}`);
    } catch (error) {
      console.warn(`    ⚠️ Could not read wrapper price after update: ${error}`);
    }
  } else {
    console.log(`    ℹ️ Wrapper price for scETH will be available once Safe transaction is executed.`);
  }

  // Handle governance operations if needed
  if (!updateComplete) {
    const flushed = await executor.flush(`Update scETH oracle feed to WETH/USD`);

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

func.id = "update-sceth-usd-feed";
func.tags = ["usd-oracle", "oracle-wrapper", "sceth"];
func.dependencies = [USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID, USD_ORACLE_AGGREGATOR_ID];

export default func;
