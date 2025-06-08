import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import {
  setupRedstoneCompositeFeedsForAssets,
  setupRedstoneSimpleFeedsForAssets,
} from "../../typescript/dlend/setup-oracle";

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Define the assets to setup - categorized by feed type
  const compositeFeedAssets = [config.tokenAddresses.wstkscETH].filter(Boolean);

  const simpleFeedAssets = [
    config.tokenAddresses.WETH,
    config.tokenAddresses.scETH,
  ].filter(Boolean);

  if (compositeFeedAssets.length === 0 && simpleFeedAssets.length === 0) {
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

  // ETH price range for sanity checks
  const ETH_MIN_PRICE = 1000;
  const ETH_MAX_PRICE = 4000;

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
      ETH_MIN_PRICE,
      ETH_MAX_PRICE,
      deployer,
    );
  }

  // Setup simple feeds
  if (simpleFeedAssets.length > 0) {
    const { address: redstoneWrapperAddress } = await hre.deployments.get(
      USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
    );

    if (!redstoneWrapperAddress) {
      throw new Error(
        "RedstoneChainlinkWrapperWithThresholding artifact not found",
      );
    }

    const redstoneWrapper = await hre.ethers.getContractAt(
      "RedstoneChainlinkWrapperWithThresholding",
      redstoneWrapperAddress,
      deployerSigner,
    );

    console.log(
      `🔮 Setting up simple feeds for ${simpleFeedAssets.length} assets...`,
    );

    await setupRedstoneSimpleFeedsForAssets(
      simpleFeedAssets,
      config,
      redstoneWrapper,
      oracleAggregator,
      baseCurrencyUnit,
      ETH_MIN_PRICE,
      ETH_MAX_PRICE,
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
  "weth-sceth-wstksceth-chainlink-composite-feeds",
];
func.dependencies = [
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
];
func.id = "setup-weth-sceth-wstksceth-for-usd-oracle-wrapper";

export default func;
