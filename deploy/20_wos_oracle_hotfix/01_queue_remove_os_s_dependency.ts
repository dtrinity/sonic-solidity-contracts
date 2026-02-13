import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, WOS_TO_OS_DECIMAL_CONVERTER_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

/**
 * Build Safe payload for addCompositeFeed(asset, feed1, feed2, thresholds...).
 */
function createAddCompositeFeedTx(
  wrapperAddress: string,
  asset: string,
  feed1: string,
  feed2: string,
  primaryThreshold: { lowerThresholdInBase: bigint; fixedPriceInBase: bigint },
  secondaryThreshold: { lowerThresholdInBase: bigint; fixedPriceInBase: bigint },
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("addCompositeFeed", [
      asset,
      feed1,
      feed2,
      primaryThreshold.lowerThresholdInBase,
      primaryThreshold.fixedPriceInBase,
      secondaryThreshold.lowerThresholdInBase,
      secondaryThreshold.fixedPriceInBase,
    ]),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  if (!isMainnet(hre.network.name)) {
    console.log("ℹ️ wOS oracle hotfix is mainnet-only. Skipping on this network.");
    return true;
  }

  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const wrapperDeployment = await deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);
  const wrapper = await ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholding",
    wrapperDeployment.address,
    deployerSigner,
  );

  const wOSAddress = config.tokenAddresses.wOS;
  const wSAddress = config.tokenAddresses.wS;
  const usdConfig = config.oracleAggregators.USD;
  const sUsdFeed = usdConfig.redstoneOracleAssets?.plainRedstoneOracleWrappers?.[wSAddress];

  if (!wOSAddress) {
    throw new Error("wOS address missing from config");
  }

  if (!sUsdFeed) {
    throw new Error("S/USD feed missing from USD plainRedstoneOracleWrappers config");
  }

  const wOSToOSConverterDeployment = await deployments.get(WOS_TO_OS_DECIMAL_CONVERTER_ID);
  const wOSToOSConverter = wOSToOSConverterDeployment.address;

  const currentFeed = await wrapper.compositeFeeds(wOSAddress);
  const currentFeed1 = currentFeed.feed1 as string;
  const currentFeed2 = currentFeed.feed2 as string;

  if (currentFeed1 === ethers.ZeroAddress || currentFeed2 === ethers.ZeroAddress) {
    throw new Error("wOS composite feed is not configured on USD composite wrapper");
  }

  if (currentFeed1.toLowerCase() !== wOSToOSConverter.toLowerCase()) {
    throw new Error(`Unexpected wOS primary feed. expected=${wOSToOSConverter}, actual=${currentFeed1}`);
  }

  if (currentFeed2.toLowerCase() === sUsdFeed.toLowerCase()) {
    console.log("✅ wOS composite feed already uses S/USD directly. Nothing to queue.");
    return true;
  }

  const primaryThreshold = {
    lowerThresholdInBase: BigInt(currentFeed.primaryThreshold.lowerThresholdInBase),
    fixedPriceInBase: BigInt(currentFeed.primaryThreshold.fixedPriceInBase),
  };
  const secondaryThreshold = {
    lowerThresholdInBase: BigInt(currentFeed.secondaryThreshold.lowerThresholdInBase),
    fixedPriceInBase: BigInt(currentFeed.secondaryThreshold.fixedPriceInBase),
  };

  console.log("🔧 Rewiring wOS/USD composite feed to remove OS/S dependency...");
  console.log(`   asset: ${wOSAddress}`);
  console.log(`   feed1 (wOS/OS): ${wOSToOSConverter}`);
  console.log(`   old feed2: ${currentFeed2}`);
  console.log(`   new feed2 (S/USD): ${sUsdFeed}`);

  const complete = await executor.tryOrQueue(
    async () => {
      await wrapper.addCompositeFeed(
        wOSAddress,
        wOSToOSConverter,
        sUsdFeed,
        primaryThreshold.lowerThresholdInBase,
        primaryThreshold.fixedPriceInBase,
        secondaryThreshold.lowerThresholdInBase,
        secondaryThreshold.fixedPriceInBase,
      );
      console.log(`   ✅ Added rewired wOS composite feed`);
    },
    () =>
      createAddCompositeFeedTx(
        wrapperDeployment.address,
        wOSAddress,
        wOSToOSConverter,
        sUsdFeed,
        primaryThreshold,
        secondaryThreshold,
        wrapper.interface,
      ),
  );

  if (!complete) {
    const flushed = await executor.flush("Overwrite wOS/USD composite feed to remove OS/S dependency");

    if (executor.useSafe) {
      if (!flushed) {
        throw new Error("Failed to prepare Safe batch for wOS oracle hotfix");
      }

      console.log("⏳ Governance signatures required to execute queued Safe transactions.");
      return false;
    }
  }

  const finalFeed = await wrapper.compositeFeeds(wOSAddress);

  if (String(finalFeed.feed2).toLowerCase() !== sUsdFeed.toLowerCase()) {
    throw new Error(`Post-update verification failed. expected feed2=${sUsdFeed}, actual=${finalFeed.feed2}`);
  }

  const [priceInfo, isAlive] = await wrapper.getPriceInfo(wOSAddress);
  const rewiredPrice = BigInt(priceInfo[0]);

  if (!isAlive || rewiredPrice <= 0n) {
    throw new Error("Rewired wOS composite feed is not alive or returned non-positive price");
  }

  console.log(`✅ wOS oracle hotfix complete. price=${rewiredPrice.toString()}, isAlive=${isAlive}`);
  return true;
};

func.id = "queue-remove-os-s-dependency-from-wos-oracle";
func.tags = ["usd-oracle", "oracle-wrapper", "wos-oracle-hotfix"];
func.dependencies = [USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, WOS_TO_OS_DECIMAL_CONVERTER_ID];

export default func;
