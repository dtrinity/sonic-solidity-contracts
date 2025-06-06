import { ethers, deployments } from "hardhat";
import { CHAINLINK_DECIMAL_CONVERTER_SFRXUSD_ID } from "../../typescript/deploy-ids";

async function main() {
  console.log("🔍 Checking sfrxUSD ChainlinkDecimalUpscaler price...\n");

  try {
    // Get the deployed contract
    const deployment = await deployments.get(
      CHAINLINK_DECIMAL_CONVERTER_SFRXUSD_ID
    );
    console.log(`📍 Contract deployed at: ${deployment.address}`);

    // Connect to the contract
    const upscaler = await ethers.getContractAt(
      "ChainlinkDecimalUpscaler",
      deployment.address
    );

    // Get contract details
    const description = await upscaler.description();
    const decimals = await upscaler.decimals();
    const sourceDecimals = await upscaler.sourceDecimals();
    const sourceFeed = await upscaler.sourceFeed();

    console.log(`📊 Description: ${description}`);
    console.log(`🔢 Source Feed: ${sourceFeed}`);
    console.log(`📐 Source Decimals: ${sourceDecimals}`);
    console.log(`📐 Target Decimals: ${decimals}`);
    console.log("");

    // Get the latest price data
    const latestRoundData = await upscaler.latestRoundData();

    console.log("📈 Latest Round Data:");
    console.log(`   Round ID: ${latestRoundData.roundId}`);
    console.log(`   Raw Answer: ${latestRoundData.answer}`);
    console.log(
      `   Formatted Price: ${ethers.formatUnits(latestRoundData.answer, decimals)} (${decimals} decimals)`
    );
    console.log(
      `   Started At: ${new Date(Number(latestRoundData.startedAt) * 1000).toISOString()}`
    );
    console.log(
      `   Updated At: ${new Date(Number(latestRoundData.updatedAt) * 1000).toISOString()}`
    );
    console.log(`   Answered In Round: ${latestRoundData.answeredInRound}`);

    // Also check the source feed for comparison
    console.log("\n🔍 Source Feed Data (for comparison):");
    const sourceFeedContract = await ethers.getContractAt(
      "AggregatorV3Interface",
      sourceFeed
    );

    const sourceData = await sourceFeedContract.latestRoundData();
    console.log(`   Raw Source Answer: ${sourceData.answer}`);
    console.log(
      `   Formatted Source Price: ${ethers.formatUnits(sourceData.answer, sourceDecimals)} (${sourceDecimals} decimals)`
    );

    // Calculate scaling factor
    const scalingFactor = 10n ** (BigInt(decimals) - BigInt(sourceDecimals));
    console.log(
      `\n⚖️  Scaling Factor: ${scalingFactor} (10^${decimals - sourceDecimals})`
    );
    console.log(
      `✅ Verification: ${sourceData.answer} * ${scalingFactor} = ${sourceData.answer * scalingFactor}`
    );
    console.log(`🎯 Expected: ${latestRoundData.answer}`);
    console.log(
      `✅ Match: ${sourceData.answer * scalingFactor === latestRoundData.answer ? "YES" : "NO"}`
    );
  } catch (error) {
    console.error("❌ Error checking price:", error);

    if (
      error instanceof Error &&
      error.message.includes("deployment not found")
    ) {
      console.log(
        "\n💡 Tip: Make sure the contract is deployed on the current network"
      );
      console.log("   Run deployment first if needed");
    }
  }
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
