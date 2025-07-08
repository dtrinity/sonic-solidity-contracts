import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import { setupRedstoneCompositeFeedsForAssets } from "../../typescript/dlend/setup-oracle";

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Define the assets to setup - categorized by feed type
  const compositeFeedAssets = [
    config.tokenAddresses.PTaUSDC,
    config.tokenAddresses.PTwstkscUSD,
    config.tokenAddresses.wOS,
  ].filter(Boolean);

  if (compositeFeedAssets.length === 0) {
    console.log("No assets configured for oracle feed setup. Exiting.");
    return true;
  }

  const deployerSigner = await hre.ethers.getSigner(deployer);
  const oracleAggregatorDeployment = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  if (!oracleAggregatorDeployment) {
    throw new Error("USD OracleAggregator deployment not found");
  }

  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorDeployment.address,
    deployerSigner,
  );

  const baseCurrencyUnit =
    BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);

  // Setup composite feeds
  if (compositeFeedAssets.length > 0) {
    const { address: redstoneCompositeWrapperAddress } =
      await hre.deployments.get(
        USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
      );

    if (!redstoneCompositeWrapperAddress) {
      throw new Error(
        "RedstoneChainlinkCompositeWrapperWithThresholding artifact not found",
      );
    }

    const redstoneCompositeWrapper = await hre.ethers.getContractAt(
      "RedstoneChainlinkCompositeWrapperWithThresholding",
      redstoneCompositeWrapperAddress,
      deployerSigner,
    );

    console.log(
      `🔮 Setting up composite feeds for ${compositeFeedAssets.length} assets...`,
    );

    await setupRedstoneCompositeFeedsForAssets(
      compositeFeedAssets,
      config,
      redstoneCompositeWrapper,
      oracleAggregator,
      baseCurrencyUnit,
      0,
      2,
      deployer,
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = [
  "usd-oracle",
  "oracle-aggregator",
  "oracle-wrapper",
  "usd-redstone-oracle-wrapper",
  "ptausdc-ptwstkscusd-wos-chainlink-composite-feeds",
];
func.dependencies = [
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "setup-ptausdc-ptwstkscusd-wos-for-usd-oracle-wrapper";

export default func;
