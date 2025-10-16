import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, USD_REDSTONE_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

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

  const plainFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  const sAssets = [config.tokenAddresses.wS, config.tokenAddresses.dS].filter((address): address is string =>
    Boolean(address && address !== ""),
  );

  for (const asset of sAssets) {
    const expectedFeed = plainFeeds[asset];

    if (!expectedFeed) {
      throw new Error(`No S/USD plain feed configured for asset ${asset}. Update the config before running this script.`);
    }

    const currentFeed = await redstoneWrapper.assetToFeed(asset);

    let feedUpdatedImmediately = false;

    if (currentFeed.toLowerCase() !== expectedFeed.toLowerCase()) {
      const safeTx: SafeTransactionData = {
        to: redstoneWrapperDeployment.address,
        value: "0",
        data: redstoneWrapper.interface.encodeFunctionData("setFeed", [asset, expectedFeed]),
      };

      const complete = await governance.tryOrQueue(
        async () => {
          const tx = await redstoneWrapper.setFeed(asset, expectedFeed);
          await tx.wait();
          console.log(`🔄 Updated Redstone wrapper feed for asset ${asset} to ${expectedFeed}`);
        },
        () => safeTx,
      );

      if (!complete) {
        console.log(`📝 Queued Safe transaction to set feed for asset ${asset}.`);
      } else {
        feedUpdatedImmediately = true;
      }
    } else {
      console.log(`✅ Redstone wrapper already configured for asset ${asset}.`);
      feedUpdatedImmediately = true;
    }

    if (feedUpdatedImmediately) {
      try {
        const price = await redstoneWrapper.getAssetPrice(asset);
        console.log(`💵 Wrapper price for ${asset}: ${price}`);
      } catch (error) {
        throw new Error(`Failed to read wrapper price for ${asset} even after direct update. ${error}`);
      }
    } else {
      console.log(`ℹ️ Wrapper price for ${asset} will be available once the Safe transaction is executed.`);
    }
  }

  const stSAddress = config.tokenAddresses.stS;
  const compositeFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};
  const stSCompositeConfig = stSAddress ? compositeFeeds[stSAddress] : undefined;

  if (stSAddress && stSCompositeConfig) {
    const existingComposite = await redstoneCompositeWrapper.compositeFeeds(stSAddress);

    const needsUpdate =
      existingComposite.feed1.toLowerCase() !== stSCompositeConfig.feed1.toLowerCase() ||
      existingComposite.feed2.toLowerCase() !== stSCompositeConfig.feed2.toLowerCase() ||
      existingComposite.primaryThreshold.lowerThresholdInBase !== stSCompositeConfig.lowerThresholdInBase1 ||
      existingComposite.primaryThreshold.fixedPriceInBase !== stSCompositeConfig.fixedPriceInBase1 ||
      existingComposite.secondaryThreshold.lowerThresholdInBase !== stSCompositeConfig.lowerThresholdInBase2 ||
      existingComposite.secondaryThreshold.fixedPriceInBase !== stSCompositeConfig.fixedPriceInBase2;

    let compositeUpdatedImmediately = false;

    if (needsUpdate) {
      const args = [
        stSCompositeConfig.feedAsset,
        stSCompositeConfig.feed1,
        stSCompositeConfig.feed2,
        stSCompositeConfig.lowerThresholdInBase1,
        stSCompositeConfig.fixedPriceInBase1,
        stSCompositeConfig.lowerThresholdInBase2,
        stSCompositeConfig.fixedPriceInBase2,
      ] as const;

      const safeTx: SafeTransactionData = {
        to: redstoneCompositeDeployment.address,
        value: "0",
        data: redstoneCompositeWrapper.interface.encodeFunctionData("addCompositeFeed", [...args]),
      };

      const complete = await governance.tryOrQueue(
        async () => {
          const tx = await redstoneCompositeWrapper.addCompositeFeed(...args);
          await tx.wait();
          console.log(`🔄 Updated stS composite feed to use Chainlink S/USD feed.`);
        },
        () => safeTx,
      );

      if (!complete) {
        console.log(`📝 Queued Safe transaction to update stS composite feed.`);
      } else {
        compositeUpdatedImmediately = true;
      }
    } else {
      console.log("✅ stS composite feed already configured for Chainlink S/USD.");
      compositeUpdatedImmediately = true;
    }

    if (compositeUpdatedImmediately) {
      try {
        const price = await redstoneCompositeWrapper.getAssetPrice(stSAddress);
        console.log(`💵 Composite wrapper price for stS: ${price}`);
      } catch (error) {
        throw new Error(`Failed to read stS composite price after direct update. ${error}`);
      }
    } else {
      console.log("ℹ️ Composite wrapper price for stS will be available once the Safe transaction is executed.");
    }
  } else {
    console.log("⚠️ No stS composite configuration found; skipping composite feed updates.");
  }

  const flushed = await governance.flush("Stage 1: configure Chainlink S/USD feeds");

  if (!flushed) {
    throw new Error("Failed to create Safe batch for S/USD Chainlink feed configuration.");
  }

  console.log("📬 Safe transaction batch prepared for Stage 1 (Chainlink S/USD feed configuration).");
  console.log("📝 After governance executes, run Stage 2 to switch oracle aggregators.");
  return true;
};

func.tags = ["oracle", "usd-oracle", "chainlink", "s-feed-stage1"];
func.dependencies = [USD_REDSTONE_ORACLE_WRAPPER_ID, USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID];
func.runAtTheEnd = true;
func.id = "update-s-chainlink-feeds";

export default func;
