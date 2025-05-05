import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/dlend/helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (!isMainnet(hre)) {
    console.log("Skipping: This deployment is only for mainnet");
    return false;
  }

  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const assetAddresses = [config.tokenAddresses.wstkscUSD];
  const allCompositeFeeds =
    config.oracleAggregators.USD.redstoneOracleAssets
      ?.compositeRedstoneOracleWrappersWithThresholding || {};

  const filteredCompositeFeeds = Object.keys(allCompositeFeeds)
    .filter((asset) => assetAddresses.includes(asset))
    .reduce(
      (obj, key) => {
        obj[key] = allCompositeFeeds[key];
        return obj;
      },
      {} as typeof allCompositeFeeds,
    );

  if (Object.keys(filteredCompositeFeeds).length === 0) {
    throw new Error("No target composite feeds found");
  }

  const { address: redstoneCompositeWrapperAddress } =
    await hre.deployments.get(
      USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
    );

  if (!redstoneCompositeWrapperAddress) {
    throw new Error(
      "RedstoneChainlinkCompositeWrapperWithThresholding artifact not found",
    );
  }

  const deployerSigner = await hre.ethers.getSigner(deployer);
  const redstoneCompositeWrapper = await hre.ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholding",
    redstoneCompositeWrapperAddress,
    deployerSigner,
  );

  // Add composite feeds
  for (const [assetAddress, feedConfig] of Object.entries(
    filteredCompositeFeeds,
  )) {
    await redstoneCompositeWrapper.addCompositeFeed(
      feedConfig.feedAsset,
      feedConfig.feed1,
      feedConfig.feed2,
      feedConfig.lowerThresholdInBase1,
      feedConfig.fixedPriceInBase1,
      feedConfig.lowerThresholdInBase2,
      feedConfig.fixedPriceInBase2,
    );
    console.log(`Set composite Redstone feed for asset ${assetAddress}`);
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-redstone-oracle-wrapper",
  "wstkscusd-chainlink-composite-feed",
];
func.dependencies = [];
func.id = "setup-wstkscusd-for-usd-redstone-composite-oracle-wrapper";

export default func;
