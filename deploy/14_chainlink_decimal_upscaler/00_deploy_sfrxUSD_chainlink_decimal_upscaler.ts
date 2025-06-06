import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { CHAINLINK_DECIMAL_CONVERTER_SFRXUSD_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";

// Source Chainlink feed constants
const SFRXUSD_FEED_ADDRESS = "0xebE443E20ADf302B59419648c4dbA0c7299cf1A2"; // sfrxUSD/frxUSD Chainlink fundamental feed with 8 decimals
const EXPECTED_SOURCE_DECIMALS = 8;
const TARGET_DECIMALS = 18;

/**
 * Deploys the ChainlinkDecimalUpscaler for the specified oracle
 * This converts the feed from 8 decimals to 18 decimals for compatibility
 *
 * @param hre The Hardhat runtime environment.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // The hard-coded values are only valid for mainnet
  if (!isMainnet(hre.network.name)) {
    console.log(
      `\n🔑 ${__filename.split("/").slice(-2).join("/")}: Skipping non-mainnet network`
    );
    return true;
  }
  const { deployer } = await hre.getNamedAccounts();
  const { deployments, ethers } = hre;

  // Connect to the source Chainlink feed
  const sourceFeed = await ethers.getContractAt(
    "AggregatorV3Interface",
    SFRXUSD_FEED_ADDRESS
  );

  // Verify the source feed has the expected number of decimals
  const sourceDecimals = await sourceFeed.decimals();

  if (Number(sourceDecimals) !== EXPECTED_SOURCE_DECIMALS) {
    throw new Error(
      `Source feed has ${sourceDecimals} decimals, expected ${EXPECTED_SOURCE_DECIMALS}`
    );
  }

  // Deploy the ChainlinkDecimalUpscaler
  await deployments.deploy(CHAINLINK_DECIMAL_CONVERTER_SFRXUSD_ID, {
    from: deployer,
    args: [SFRXUSD_FEED_ADDRESS, TARGET_DECIMALS],
    contract: "ChainlinkDecimalUpscaler",
    autoMine: true,
    log: false,
  });

  // Log the successful deployment
  console.log(`🔗 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = CHAINLINK_DECIMAL_CONVERTER_SFRXUSD_ID;
func.tags = ["oracle", "chainlink", "upscaler"];

export default func;
