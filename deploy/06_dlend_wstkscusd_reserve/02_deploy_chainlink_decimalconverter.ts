import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { CHAINLINK_DECIMAL_CONVERTER_WSTKSCUSD_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";

// Source Chainlink feed constants
const WSTKSCUSD_FEED_ADDRESS = "0xe5bd703E6C4C7679e10D429D87EF4550a9fA6fF4"; // wstkscUSD/stkscUSD Chainlink price feed
const EXPECTED_SOURCE_DECIMALS = 18;
const TARGET_DECIMALS = 8;

/**
 * Deploys the ChainlinkDecimalConverter for wstkscUSD/stkscUSD
 * This converts the feed from 18 decimals to 8 decimals for compatibility
 *
 * @param hre The Hardhat runtime environment.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // The hard-coded values are only valid for mainnet
  if (!isMainnet(hre.network.name)) {
    console.log(
      `\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping non-mainnet network`,
    );
    return true;
  }
  const { deployer } = await hre.getNamedAccounts();
  const { deployments, ethers } = hre;

  // Connect to the source Chainlink feed
  const sourceFeed = await ethers.getContractAt(
    "AggregatorV3Interface",
    WSTKSCUSD_FEED_ADDRESS,
  );

  // Verify the source feed has the expected number of decimals
  const sourceDecimals = await sourceFeed.decimals();

  if (sourceDecimals !== BigInt(EXPECTED_SOURCE_DECIMALS)) {
    throw new Error(
      `Source feed has ${sourceDecimals} decimals, expected ${EXPECTED_SOURCE_DECIMALS}`,
    );
  }

  // Deploy the ChainlinkDecimalConverter
  await deployments.deploy(CHAINLINK_DECIMAL_CONVERTER_WSTKSCUSD_ID, {
    from: deployer,
    args: [WSTKSCUSD_FEED_ADDRESS, TARGET_DECIMALS],
    contract: "ChainlinkDecimalConverter",
    autoMine: true,
    log: false,
  });

  // Log the successful deployment
  console.log(`🔗 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = CHAINLINK_DECIMAL_CONVERTER_WSTKSCUSD_ID;
func.tags = ["wstkscusd", "oracle", "chainlink"];

export default func;
