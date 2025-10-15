import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
} from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

const SANITY_TOLERANCE_BPS = 100n; // 1%

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const governance = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await governance.initialize();

  const redstoneWrapperDeployment = await deployments.get(USD_REDSTONE_ORACLE_WRAPPER_ID);
  const redstoneWrapper = await ethers.getContractAt("RedstoneChainlinkWrapper", redstoneWrapperDeployment.address, deployerSigner);

  const redstoneCompositeDeployment = await deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneCompositeWrapper = await ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholding",
    redstoneCompositeDeployment.address,
    deployerSigner,
  );

  const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  const plainFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  const sAssets = [config.tokenAddresses.wS, config.tokenAddresses.dS].filter((address): address is string =>
    Boolean(address && address !== ""),
  );

  for (const asset of sAssets) {
    const expectedFeed = plainFeeds[asset];

    if (!expectedFeed) {
      throw new Error(`No S/USD plain feed configured for asset ${asset}. Stage 1 must be updated.`);
    }

    const storedFeed = await redstoneWrapper.assetToFeed(asset);

    if (storedFeed.toLowerCase() !== expectedFeed.toLowerCase()) {
      throw new Error(
        `Wrapper feed mismatch for ${asset}. Expected ${expectedFeed}, found ${storedFeed}. Run Stage 1 (update_s_chainlink_feeds) first.`,
      );
    }

    const wrapperPrice = await redstoneWrapper.getAssetPrice(asset);
    let aggregatorPrice: bigint | undefined = undefined;

    try {
      aggregatorPrice = await oracleAggregator.getAssetPrice(asset);
    } catch (error) {
      console.warn(`⚠️ Current oracle price unavailable for ${asset}: ${error}`);
    }

    if (aggregatorPrice !== undefined) {
      const withinTolerance = isWithinTolerance(wrapperPrice, aggregatorPrice, SANITY_TOLERANCE_BPS);

      if (!withinTolerance) {
        throw new Error(`Wrapper/oracle price drift for ${asset}: wrapper ${wrapperPrice} vs oracle ${aggregatorPrice}. Aborting Stage 2.`);
      }
    }

    const currentOracle = await oracleAggregator.assetOracles(asset);

    if (currentOracle.toLowerCase() !== redstoneWrapperDeployment.address.toLowerCase()) {
      const safeTx: SafeTransactionData = {
        to: oracleAggregatorDeployment.address,
        value: "0",
        data: oracleAggregator.interface.encodeFunctionData("setOracle", [asset, redstoneWrapperDeployment.address]),
      };

      const complete = await governance.tryOrQueue(
        async () => {
          const tx = await oracleAggregator.setOracle(asset, redstoneWrapperDeployment.address);
          await tx.wait();
          console.log(`🔄 Pointed oracle aggregator to Redstone wrapper for asset ${asset}`);
        },
        () => safeTx,
      );

      if (!complete) {
        console.log(`📝 Queued Safe transaction to point oracle aggregator to Redstone wrapper for asset ${asset}.`);
      }
    } else {
      console.log(`✅ Oracle aggregator already points to Redstone wrapper for asset ${asset}.`);
    }
  }

  const stSAddress = config.tokenAddresses.stS;
  const compositeFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};
  const stSCompositeConfig = stSAddress ? compositeFeeds[stSAddress] : undefined;

  if (stSAddress && stSCompositeConfig) {
    const storedComposite = await redstoneCompositeWrapper.compositeFeeds(stSAddress);

    const compositeMatches =
      storedComposite.feed1.toLowerCase() === stSCompositeConfig.feed1.toLowerCase() &&
      storedComposite.feed2.toLowerCase() === stSCompositeConfig.feed2.toLowerCase() &&
      storedComposite.primaryThreshold.lowerThresholdInBase === stSCompositeConfig.lowerThresholdInBase1 &&
      storedComposite.primaryThreshold.fixedPriceInBase === stSCompositeConfig.fixedPriceInBase1 &&
      storedComposite.secondaryThreshold.lowerThresholdInBase === stSCompositeConfig.lowerThresholdInBase2 &&
      storedComposite.secondaryThreshold.fixedPriceInBase === stSCompositeConfig.fixedPriceInBase2;

    if (!compositeMatches) {
      throw new Error("stS composite feed does not match configuration. Run Stage 1 (update_s_chainlink_feeds) before Stage 2.");
    }

    const compositePrice = await redstoneCompositeWrapper.getAssetPrice(stSAddress);
    let stSAggregatorPrice: bigint | undefined = undefined;

    try {
      stSAggregatorPrice = await oracleAggregator.getAssetPrice(stSAddress);
    } catch (error) {
      console.warn(`⚠️ Current oracle price unavailable for stS: ${error}`);
    }

    if (stSAggregatorPrice !== undefined) {
      const withinTolerance = isWithinTolerance(compositePrice, stSAggregatorPrice, SANITY_TOLERANCE_BPS);

      if (!withinTolerance) {
        throw new Error(`Wrapper/oracle price drift for stS: wrapper ${compositePrice} vs oracle ${stSAggregatorPrice}. Aborting Stage 2.`);
      }
    }

    const currentStSOracle = await oracleAggregator.assetOracles(stSAddress);

    if (currentStSOracle.toLowerCase() !== redstoneCompositeDeployment.address.toLowerCase()) {
      const safeTx: SafeTransactionData = {
        to: oracleAggregatorDeployment.address,
        value: "0",
        data: oracleAggregator.interface.encodeFunctionData("setOracle", [stSAddress, redstoneCompositeDeployment.address]),
      };

      const complete = await governance.tryOrQueue(
        async () => {
          const tx = await oracleAggregator.setOracle(stSAddress, redstoneCompositeDeployment.address);
          await tx.wait();
          console.log(`🔄 Pointed oracle aggregator to composite wrapper for stS.`);
        },
        () => safeTx,
      );

      if (!complete) {
        console.log(`📝 Queued Safe transaction to point oracle aggregator to composite wrapper for stS.`);
      }
    } else {
      console.log("✅ Oracle aggregator already points to composite wrapper for stS.");
    }
  } else {
    console.log("⚠️ No stS composite configuration found; skipping stS oracle update.");
  }

  const flushed = await governance.flush("Stage 2: switch Chainlink S/USD oracles");

  if (!flushed) {
    throw new Error("Failed to create Safe batch for Stage 2 (Chainlink S/USD oracle switch).");
  }

  console.log("📬 Safe transaction batch prepared for Stage 2 (Chainlink S/USD oracle switch).");
  return true;
};

/**
 * Check whether two prices fall within the provided tolerance (in BPS).
 *
 * @param newPrice - Newly observed price
 * @param referencePrice - Reference price to compare against
 * @param toleranceBps - Maximum tolerated deviation in basis points
 */
function isWithinTolerance(newPrice: bigint, referencePrice: bigint, toleranceBps: bigint): boolean {
  if (referencePrice === 0n) {
    return newPrice === 0n;
  }

  const diff = newPrice > referencePrice ? newPrice - referencePrice : referencePrice - newPrice;
  return diff * 10_000n <= referencePrice * toleranceBps;
}

func.tags = ["oracle", "usd-oracle", "chainlink", "s-feed-stage2"];
func.dependencies = [USD_REDSTONE_ORACLE_WRAPPER_ID, USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, "update-s-chainlink-feeds"];
func.runAtTheEnd = true;
func.id = "switch-s-chainlink-oracles";

export default func;
