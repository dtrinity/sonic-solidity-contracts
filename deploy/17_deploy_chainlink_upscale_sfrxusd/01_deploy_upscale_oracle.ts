import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { SFRXUSD_UPSCALE_DECIMAL_CONVERTER_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";

// Source Redstone feed constants
const SFRXUSD_REDSTONE_FEED_ADDRESS = "0xebE443E20ADf302B59419648c4dbA0c7299cf1A2"; // sfrxUSD Redstone feed
const EXPECTED_SOURCE_DECIMALS = 8;
const TARGET_DECIMALS = 18;

/**
 * Deploys ChainlinkDecimalConverterV2 for sfrxUSD Redstone feed
 * This converts the feed from 8 decimals to 18 decimals (upscaling)
 *
 * The deployment uses the new ChainlinkDecimalConverterV2 which supports:
 * - Both upscaling and downscaling
 * - Both IAggregatorV3Interface and IPriceFeedLegacy interfaces
 * - Automatic detection of legacy interface support
 *
 * Feed details:
 * - Source: sfrxUSD Redstone feed at 0xebE443E20ADf302B59419648c4dbA0c7299cf1A2
 * - Direction: 8 decimals → 18 decimals (upscale by 10^10)
 * - Contract: ChainlinkDecimalConverterV2
 *
 * @param hre The Hardhat runtime environment.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // The hard-coded values are only valid for mainnet
  if (!isMainnet(hre.network.name)) {
    console.log(`\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping non-mainnet network`);
    return true;
  }

  const { deployer } = await hre.getNamedAccounts();
  const { deployments, ethers } = hre;

  console.log(`🚀 Deploying ChainlinkDecimalConverterV2 for sfrxUSD upscaling...`);
  console.log(`   Source feed: ${SFRXUSD_REDSTONE_FEED_ADDRESS}`);
  console.log(`   Direction: ${EXPECTED_SOURCE_DECIMALS} → ${TARGET_DECIMALS} decimals`);

  // Connect to the source Redstone feed
  const sourceFeed = await ethers.getContractAt(
    "contracts/oracle_aggregator/interface/chainlink/IAggregatorV3Interface.sol:AggregatorV3Interface",
    SFRXUSD_REDSTONE_FEED_ADDRESS,
  );

  // Verify the source feed has the expected number of decimals
  const sourceDecimals = await sourceFeed.decimals();
  console.log(`✅ Source feed decimals: ${sourceDecimals}`);

  if (sourceDecimals !== BigInt(EXPECTED_SOURCE_DECIMALS)) {
    throw new Error(`Source feed has ${sourceDecimals} decimals, expected ${EXPECTED_SOURCE_DECIMALS}`);
  }

  // Get feed description for logging
  let feedDescription = "Unknown Feed";

  try {
    feedDescription = await sourceFeed.description();
    console.log(`📝 Source feed description: ${feedDescription}`);
  } catch (error) {
    console.log(`⚠️  Could not get feed description: ${error}`);
  }

  // Deploy the ChainlinkDecimalConverterV2
  console.log(`🔧 Deploying ChainlinkDecimalConverterV2...`);
  await deployments.deploy(SFRXUSD_UPSCALE_DECIMAL_CONVERTER_ID, {
    from: deployer,
    args: [SFRXUSD_REDSTONE_FEED_ADDRESS, TARGET_DECIMALS],
    contract: "ChainlinkDecimalConverterV2",
    autoMine: true,
    log: false,
  });

  // Get the deployment and verify
  const converterDeployment = await deployments.get(SFRXUSD_UPSCALE_DECIMAL_CONVERTER_ID);
  const converter = await ethers.getContractAt("ChainlinkDecimalConverterV2", converterDeployment.address);

  // Verify the converter configuration
  const targetDecimals = await converter.decimals();
  const converterSourceDecimals = await converter.sourceDecimals();
  const isUpscaling = await converter.isUpscaling();

  console.log(`✅ Deployed ChainlinkDecimalConverterV2: ${converterDeployment.address}`);
  console.log(`   Source decimals: ${converterSourceDecimals}`);
  console.log(`   Target decimals: ${targetDecimals}`);
  console.log(`   Is upscaling: ${isUpscaling}`);
  console.log(
    `   Scaling factor: 10^${TARGET_DECIMALS - EXPECTED_SOURCE_DECIMALS} = ${10n ** BigInt(TARGET_DECIMALS - EXPECTED_SOURCE_DECIMALS)}`,
  );

  if (targetDecimals !== BigInt(TARGET_DECIMALS)) {
    throw new Error(`Converter has ${targetDecimals} decimals, expected ${TARGET_DECIMALS}`);
  }

  if (!isUpscaling) {
    throw new Error(`Converter should be upscaling but isUpscaling is false`);
  }

  // Test the converter by getting a price (if available)
  try {
    const latestRoundData = await converter.latestRoundData();
    const originalPrice = await sourceFeed.latestRoundData();

    console.log(`💰 Original price: ${originalPrice.answer} (${EXPECTED_SOURCE_DECIMALS} decimals)`);
    console.log(`💰 Converted price: ${latestRoundData.answer} (${TARGET_DECIMALS} decimals)`);
    console.log(`📊 Price ratio (converted/original): ${Number(latestRoundData.answer) / Number(originalPrice.answer)}`);

    // Verify the scaling is correct (should be 10^10 for 8→18 decimals)
    const expectedRatio = 10n ** BigInt(TARGET_DECIMALS - EXPECTED_SOURCE_DECIMALS);
    const actualRatio = latestRoundData.answer / originalPrice.answer;

    if (actualRatio === expectedRatio) {
      console.log(`✅ Price scaling verified: ${actualRatio}x multiplier`);
    } else {
      console.log(`⚠️  Price scaling mismatch: expected ${expectedRatio}x, got ${actualRatio}x`);
    }
  } catch (priceError) {
    console.log(`⚠️  Could not test price conversion: ${priceError}`);
  }

  // Test legacy interface support (now uses runtime fallback logic)
  try {
    const latestRound = await converter.latestRound();
    const latestAnswer = await converter.latestAnswer();
    console.log(`✅ Legacy interface methods working - Round: ${latestRound}, Answer: ${latestAnswer}`);

    // The V2 converter automatically falls back to modern interface if legacy fails
    console.log(`🔗 Legacy methods successfully use fallback for non-legacy feeds`);
  } catch (legacyError) {
    console.log(`❌ Legacy interface methods failed unexpectedly: ${legacyError}`);
    console.log(`   This suggests an issue with the fallback logic`);
  }

  console.log(`💾 Saved deployment as: ${SFRXUSD_UPSCALE_DECIMAL_CONVERTER_ID}`);
  console.log(`🔗 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = SFRXUSD_UPSCALE_DECIMAL_CONVERTER_ID;
func.tags = ["sfrxusd", "oracle", "chainlink", "upscale", "redstone"];

export default func;
