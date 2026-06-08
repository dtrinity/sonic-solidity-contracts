import { expect } from "chai";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import hre from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { SafeManager } from "@dtrinity/shared-hardhat-tools";

import { getConfig } from "../../config/config";
import updateSUsdSimpleWrapperFeeds from "../../deploy/20_chainlink_oracle_migration/01_update_s_usd_simple_wrapper_feeds";
import updateUsdcUsdSimpleWrapperFeeds from "../../deploy/20_chainlink_oracle_migration/02_update_usdc_usd_simple_wrapper_feeds";
import updateUsdCompositeWrapperFeeds from "../../deploy/20_chainlink_oracle_migration/03_update_usd_composite_wrapper_feeds";
import updateStsSSimpleWrapperFeed from "../../deploy/20_chainlink_oracle_migration/04_update_sts_s_simple_wrapper_feed";
import queueUsdCompositeOracleFlips from "../../deploy/20_chainlink_oracle_migration/05_queue_usd_composite_oracle_flips";
import deployErc4626RateProviderThirdFeedWrapper from "../../deploy/20_chainlink_oracle_migration/06_deploy_erc4626_rate_provider_third_feed_wrapper";
import queueErc4626RateProviderThirdFeedOracleFlips from "../../deploy/20_chainlink_oracle_migration/07_queue_erc4626_rate_provider_third_feed_oracle_flips";
import {
  S_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_CHAINLINK_FEED_WRAPPER_ID,
  USD_CHAINLINK_FEED_WRAPPER_WITH_THRESHOLDING_ID,
  USD_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import {
  CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT,
  ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ARTIFACT,
  LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT,
  LEGACY_CHAINLINK_FEED_WRAPPER_WITH_THRESHOLDING_ARTIFACT,
} from "../../typescript/oracle-wrapper-artifacts";

const ENABLE_ENV = "DEPLOY20_ORACLE_MIGRATION_FORK_TESTS";
const WORKER_ENV = "DEPLOY20_ORACLE_MIGRATION_FORK_WORKER";
const TEST_FILE = "test/oracle_aggregator/Deploy20ChainlinkOracleMigration.fork.sonic.ts";

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

type Deploy20Script = (hre: HardhatRuntimeEnvironment) => Promise<boolean | void>;

type AggregatorPriceTarget = {
  base: "USD" | "S";
  label: string;
  asset: string;
  aggregatorId: string;
};

type AggregatorPriceSnapshot = AggregatorPriceTarget & {
  oracle: string;
  price: bigint;
  isAlive: boolean;
};

describe("deploy/20 Chainlink oracle migration on Sonic fork", () => {
  if (process.env[WORKER_ENV] === "true") {
    describe("worker", () => {
      let previousUseSafe: string | undefined;
      let recordedBatches: SafeTransactionData[][];

      before(async function () {
        if (process.env[ENABLE_ENV] !== "true") {
          this.skip();
          return;
        }

        this.timeout(240000);

        previousUseSafe = process.env.USE_SAFE;
        process.env.USE_SAFE = "true";
        recordedBatches = [];

        SafeManager.setProtocolKitFactory(async ({ safeConfig }) => ({
          async getOwners(): Promise<string[]> {
            return safeConfig.owners;
          },
          async getThreshold(): Promise<number> {
            return safeConfig.threshold;
          },
          async createTransaction(input: { transactions: SafeTransactionData[] }): Promise<{ batchIndex: number }> {
            recordedBatches.push(input.transactions.map((transaction) => ({ ...transaction })));
            return { batchIndex: recordedBatches.length - 1 };
          },
          async getTransactionHash(transaction: { batchIndex: number }): Promise<string> {
            return `0x${(transaction.batchIndex + 1).toString(16).padStart(64, "0")}`;
          },
        }));

        await hre.network.provider.request({
          method: "hardhat_reset",
          params: [
            {
              forking: {
                jsonRpcUrl: resolveRpcUrl(),
              },
            },
          ],
        });
      });

      after(() => {
        SafeManager.setProtocolKitFactory(undefined);

        if (previousUseSafe === undefined) {
          delete process.env.USE_SAFE;
        } else {
          process.env.USE_SAFE = previousUseSafe;
        }
      });

      it("executes deploy/20 migration scripts and verifies the migrated oracle routes", async function () {
        this.timeout(240000);

        const config = await getConfig(hre);
        const governanceSigner = await impersonateAccount(config.walletAddresses.governanceMultisig);
        const preMigrationPrices = await snapshotDeploy20AggregatorPrices(config);

        await runDeploy20Script("01_update_s_usd_simple_wrapper_feeds", updateSUsdSimpleWrapperFeeds, governanceSigner, recordedBatches);
        await runDeploy20Script(
          "02_update_usdc_usd_simple_wrapper_feeds",
          updateUsdcUsdSimpleWrapperFeeds,
          governanceSigner,
          recordedBatches,
        );
        await runDeploy20Script("03_update_usd_composite_wrapper_feeds", updateUsdCompositeWrapperFeeds, governanceSigner, recordedBatches);
        await runDeploy20Script("04_update_sts_s_simple_wrapper_feed", updateStsSSimpleWrapperFeed, governanceSigner, recordedBatches);
        await runDeploy20Script("05_queue_usd_composite_oracle_flips", queueUsdCompositeOracleFlips, governanceSigner, recordedBatches);
        await runDeploy20Script(
          "06_deploy_erc4626_rate_provider_third_feed_wrapper",
          deployErc4626RateProviderThirdFeedWrapper,
          governanceSigner,
          recordedBatches,
        );
        await runDeploy20Script(
          "07_queue_erc4626_rate_provider_third_feed_oracle_flips",
          queueErc4626RateProviderThirdFeedOracleFlips,
          governanceSigner,
          recordedBatches,
        );

        expect(recordedBatches.length, "expected deploy/20 to queue governance transactions").to.be.greaterThan(0);

        await expectDeploy20State(config);
        const postMigrationPrices = await snapshotDeploy20AggregatorPrices(config);
        logAggregatorPriceComparison(preMigrationPrices, postMigrationPrices);

        const batchCountBeforeRerun = recordedBatches.length;
        const safeBuilderFilesBeforeRerun = listSafeBuilderFiles();

        await updateSUsdSimpleWrapperFeeds(hre);
        await updateUsdcUsdSimpleWrapperFeeds(hre);
        await updateUsdCompositeWrapperFeeds(hre);
        await updateStsSSimpleWrapperFeed(hre);
        await queueUsdCompositeOracleFlips(hre);
        await deployErc4626RateProviderThirdFeedWrapper(hre);
        await queueErc4626RateProviderThirdFeedOracleFlips(hre);

        expect(recordedBatches.length, "deploy/20 rerun should not queue new Safe batches").to.equal(batchCountBeforeRerun);
        expect(listSafeBuilderFiles(), "deploy/20 rerun should not write new Safe builder files").to.deep.equal(
          safeBuilderFilesBeforeRerun,
        );

        await expectDeploy20State(config);
      });
    });
  } else {
    it("runs the worker suite against a temporary deployment copy", function () {
      if (process.env[ENABLE_ENV] !== "true") {
        this.skip();
        return;
      }

      this.timeout(300000);

      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deploy20-oracle-migration-fork-"));
      const sourceDeployments = path.join(process.cwd(), "deployments", "sonic_mainnet");
      const tempDeployments = path.join(tempRoot, "sonic_mainnet");

      fs.cpSync(sourceDeployments, tempDeployments, { recursive: true });

      try {
        execFileSync(resolveNpxCommand(), ["hardhat", "test", "--network", "hardhat", "--no-compile", TEST_FILE], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            [ENABLE_ENV]: "true",
            [WORKER_ENV]: "true",
            HARDHAT_DEPLOYMENTS_PATH: tempRoot,
            HARDHAT_DEPLOY_FORK: "sonic_mainnet",
            HARDHAT_SAVE_DEPLOYMENTS: "true",
            SONIC_MAINNET_RPC_URL: resolveRpcUrl(),
          },
          stdio: "inherit",
        });
      } catch (error) {
        console.error(`Preserving temp deployment copy for inspection: ${tempRoot}`);
        throw error;
      }

      fs.rmSync(tempRoot, { force: true, recursive: true });
    });
  }
});

async function runDeploy20Script(
  label: string,
  script: Deploy20Script,
  governanceSigner: Awaited<ReturnType<typeof hre.ethers.getSigner>>,
  recordedBatches: SafeTransactionData[][],
): Promise<void> {
  const batchStart = recordedBatches.length;
  await script(hre);

  for (const batch of recordedBatches.slice(batchStart)) {
    const contractsByAddress = await buildContractRegistry();
    const functionNames = batch.map((transaction) => parseFunctionName(transaction, contractsByAddress));

    console.log(`Executing queued Safe batch from ${label}: ${functionNames.join(", ")}`);
    await executeQueuedBatch(batch, governanceSigner, contractsByAddress);
  }
}

async function expectDeploy20State(config: any): Promise<void> {
  const { deployments, ethers } = hre;
  const [defaultSigner] = await ethers.getSigners();

  const usdAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const sAggregatorDeployment = await deployments.get(S_ORACLE_AGGREGATOR_ID);
  const legacyPlainDeployment = await deployments.get(USD_CHAINLINK_FEED_WRAPPER_ID);
  const legacyThresholdDeployment = await deployments.get(USD_CHAINLINK_FEED_WRAPPER_WITH_THRESHOLDING_ID);
  const usdWrapperDeployment = await deployments.get(USD_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID);
  const sWrapperDeployment = await deployments.get(S_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID);
  const thirdFeedWrapperDeployment = await deployments.get(USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID);

  const usdAggregator = await ethers.getContractAt("OracleAggregator", usdAggregatorDeployment.address, defaultSigner);
  const sAggregator = await ethers.getContractAt("OracleAggregator", sAggregatorDeployment.address, defaultSigner);
  const legacyPlainWrapper = await ethers.getContractAt(
    LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT,
    legacyPlainDeployment.address,
    defaultSigner,
  );
  const legacyThresholdWrapper = await ethers.getContractAt(
    LEGACY_CHAINLINK_FEED_WRAPPER_WITH_THRESHOLDING_ARTIFACT,
    legacyThresholdDeployment.address,
    defaultSigner,
  );
  const usdWrapper = await ethers.getContractAt(CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT, usdWrapperDeployment.address, defaultSigner);
  const sWrapper = await ethers.getContractAt(CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT, sWrapperDeployment.address, defaultSigner);
  const thirdFeedWrapper = await ethers.getContractAt(
    ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ARTIFACT,
    thirdFeedWrapperDeployment.address,
    defaultSigner,
  );

  const usdFeeds = config.oracleAggregators.USD.redstoneOracleAssets;
  const sFeeds = config.oracleAggregators.S.redstoneOracleAssets;

  const wS = requiredAddress(config.tokenAddresses.wS, "wS");
  const dS = requiredAddress(config.tokenAddresses.dS, "dS");
  for (const asset of [wS, dS]) {
    expect((await legacyPlainWrapper.assetToFeed(asset)).toLowerCase(), `legacy plain wrapper feed for ${asset}`).to.equal(
      requiredAddress(usdFeeds.plainRedstoneOracleWrappers[asset], `plain feed for ${asset}`).toLowerCase(),
    );
    await expectAlivePrice(legacyPlainWrapper, asset, `legacy plain wrapper price for ${asset}`);
  }

  const USDCe = requiredAddress(config.tokenAddresses.USDCe, "USDCe");
  await expectLegacyThresholdFeed(
    legacyThresholdWrapper,
    USDCe,
    requiredConfig(usdFeeds.redstoneOracleWrappersWithThresholding[USDCe], "USDCe threshold feed"),
  );

  const simpleUsdAssets = [requiredAddress(config.tokenAddresses.frxUSD, "frxUSD"), requiredAddress(config.tokenAddresses.scUSD, "scUSD")];
  for (const asset of simpleUsdAssets) {
    await expectNewSimpleFeed(usdWrapper, asset, requiredConfig(usdFeeds.redstoneOracleWrappersWithThresholding[asset], asset));
    await expectAggregatorRoute(usdAggregator, asset, usdWrapperDeployment.address);
    await expectAlivePrice(usdAggregator, asset, `USD aggregator price for ${asset}`);
  }

  const compositeUsdAssets = [
    requiredAddress(config.tokenAddresses.sfrxUSD, "sfrxUSD"),
    requiredAddress(config.tokenAddresses.stS, "stS"),
    requiredAddress(config.tokenAddresses.PTaUSDC, "PTaUSDC"),
    requiredAddress(config.tokenAddresses.PTwstkscUSD, "PTwstkscUSD"),
  ];
  for (const asset of compositeUsdAssets) {
    await expectCompositeFeed(usdWrapper, asset, requiredConfig(usdFeeds.compositeRedstoneOracleWrappersWithThresholding[asset], asset));
    await expectAggregatorRoute(usdAggregator, asset, usdWrapperDeployment.address);
    await expectAlivePrice(usdAggregator, asset, `USD aggregator price for ${asset}`);
  }

  const stS = requiredAddress(config.tokenAddresses.stS, "stS");
  const stSFeed = requiredAddress(sFeeds.plainRedstoneOracleWrappers[stS], "stS/S feed");
  const stSSimpleConfig = await sWrapper.assetToFeed(stS);
  expect(stSSimpleConfig.feed.toLowerCase(), "S-base stS feed").to.equal(stSFeed.toLowerCase());
  await expectAggregatorRoute(sAggregator, stS, sWrapperDeployment.address);
  await expectAlivePrice(sAggregator, stS, "S aggregator price for stS");

  const wstkscUSD = requiredAddress(config.tokenAddresses.wstkscUSD, "wstkscUSD");
  const thirdFeedConfig = requiredConfig(
    config.oracleAggregators.USD.safeRateProviderAssets.erc4626RateProviderThirdFeedWrappers[wstkscUSD],
    "wstkscUSD 3-leg feed",
  );
  await expectThirdFeed(thirdFeedWrapper, wstkscUSD, thirdFeedConfig);
  await expectAggregatorRoute(usdAggregator, wstkscUSD, thirdFeedWrapperDeployment.address);
  await expectAlivePrice(usdAggregator, wstkscUSD, "USD aggregator price for wstkscUSD");
}

async function snapshotDeploy20AggregatorPrices(config: any): Promise<AggregatorPriceSnapshot[]> {
  const { deployments, ethers } = hre;
  const [defaultSigner] = await ethers.getSigners();
  const aggregators: Record<string, any> = {};

  return Promise.all(
    deploy20AggregatorPriceTargets(config).map(async (target) => {
      const deployment = await deployments.get(target.aggregatorId);
      const aggregator =
        aggregators[target.aggregatorId] ?? (await ethers.getContractAt("OracleAggregator", deployment.address, defaultSigner));
      aggregators[target.aggregatorId] = aggregator;

      const oracle = await aggregator.assetOracles(target.asset);
      const priceInfo = await aggregator.getPriceInfo(target.asset);

      return {
        ...target,
        isAlive: Boolean(priceInfo[1]),
        oracle,
        price: BigInt(priceInfo[0]),
      };
    }),
  );
}

function deploy20AggregatorPriceTargets(config: any): AggregatorPriceTarget[] {
  return [
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.wS, "wS"),
      base: "USD",
      label: "wS",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.dS, "dS"),
      base: "USD",
      label: "dS",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.USDCe, "USDCe"),
      base: "USD",
      label: "USDCe",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.frxUSD, "frxUSD"),
      base: "USD",
      label: "frxUSD",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.scUSD, "scUSD"),
      base: "USD",
      label: "scUSD",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.sfrxUSD, "sfrxUSD"),
      base: "USD",
      label: "sfrxUSD",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.stS, "stS"),
      base: "USD",
      label: "stS",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.PTaUSDC, "PTaUSDC"),
      base: "USD",
      label: "PTaUSDC",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.PTwstkscUSD, "PTwstkscUSD"),
      base: "USD",
      label: "PTwstkscUSD",
    },
    {
      aggregatorId: USD_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.wstkscUSD, "wstkscUSD"),
      base: "USD",
      label: "wstkscUSD",
    },
    {
      aggregatorId: S_ORACLE_AGGREGATOR_ID,
      asset: requiredAddress(config.tokenAddresses.stS, "stS"),
      base: "S",
      label: "stS",
    },
  ];
}

function logAggregatorPriceComparison(before: AggregatorPriceSnapshot[], after: AggregatorPriceSnapshot[]): void {
  const afterByKey = new Map(after.map((snapshot) => [snapshotKey(snapshot), snapshot]));

  console.log("\n📊 OracleAggregator price comparison: old vs new");

  for (const oldSnapshot of before) {
    const newSnapshot = afterByKey.get(snapshotKey(oldSnapshot));

    if (!newSnapshot) {
      throw new Error(`Missing post-migration price snapshot for ${oldSnapshot.base}/${oldSnapshot.label}`);
    }

    console.log(`\n  ${oldSnapshot.base}/${oldSnapshot.label} (${oldSnapshot.asset})`);
    console.log(
      `    old OracleAggregator: oracle=${oldSnapshot.oracle}, alive=${oldSnapshot.isAlive}, price=${oldSnapshot.price.toString()}`,
    );
    console.log(
      `    new OracleAggregator: oracle=${newSnapshot.oracle}, alive=${newSnapshot.isAlive}, price=${newSnapshot.price.toString()}, delta=${formatPriceDeltaBps(
        oldSnapshot.price,
        newSnapshot.price,
      )}`,
    );
  }
}

function snapshotKey(snapshot: Pick<AggregatorPriceSnapshot, "aggregatorId" | "asset">): string {
  return `${snapshot.aggregatorId}:${snapshot.asset.toLowerCase()}`;
}

function formatPriceDeltaBps(oldPrice: bigint, newPrice: bigint): string {
  if (oldPrice === 0n) {
    return "n/a";
  }

  const delta = newPrice - oldPrice;
  const absDelta = delta < 0n ? -delta : delta;
  const absBps = (absDelta * 10_000n) / oldPrice;
  const sign = delta >= 0n ? "+" : "-";

  return `${sign}${absBps.toString()} bps`;
}

async function expectLegacyThresholdFeed(wrapper: any, asset: string, expectedConfig: any): Promise<void> {
  const feed = await wrapper.assetToFeed(asset);
  const threshold = await wrapper.assetThresholds(asset);

  expect(feed.toLowerCase(), `legacy threshold wrapper feed for ${asset}`).to.equal(expectedConfig.feed.toLowerCase());
  expect(BigInt(threshold.lowerThresholdInBase), `legacy lower threshold for ${asset}`).to.equal(expectedConfig.lowerThreshold);
  expect(BigInt(threshold.fixedPriceInBase), `legacy fixed price for ${asset}`).to.equal(expectedConfig.fixedPrice);
  await expectAlivePrice(wrapper, asset, `legacy threshold wrapper price for ${asset}`);
}

async function expectNewSimpleFeed(wrapper: any, asset: string, expectedConfig: any): Promise<void> {
  const feedConfig = await wrapper.assetToFeed(asset);

  expect(feedConfig.feed.toLowerCase(), `new simple feed for ${asset}`).to.equal(expectedConfig.feed.toLowerCase());
  expect(BigInt(feedConfig.threshold.lowerThresholdInBase), `new simple lower threshold for ${asset}`).to.equal(
    expectedConfig.lowerThreshold,
  );
  expect(BigInt(feedConfig.threshold.fixedPriceInBase), `new simple fixed price for ${asset}`).to.equal(expectedConfig.fixedPrice);
  await expectAlivePrice(wrapper, asset, `new simple wrapper price for ${asset}`);
}

async function expectCompositeFeed(wrapper: any, asset: string, expectedConfig: any): Promise<void> {
  const feedConfig = await wrapper.compositeFeeds(asset);

  expect(feedConfig.feed1.toLowerCase(), `composite feed1 for ${asset}`).to.equal(expectedConfig.feed1.toLowerCase());
  expect(feedConfig.feed2.toLowerCase(), `composite feed2 for ${asset}`).to.equal(expectedConfig.feed2.toLowerCase());
  expect(BigInt(feedConfig.primaryThreshold.lowerThresholdInBase), `composite primary lower threshold for ${asset}`).to.equal(
    expectedConfig.lowerThresholdInBase1,
  );
  expect(BigInt(feedConfig.primaryThreshold.fixedPriceInBase), `composite primary fixed price for ${asset}`).to.equal(
    expectedConfig.fixedPriceInBase1,
  );
  expect(BigInt(feedConfig.secondaryThreshold.lowerThresholdInBase), `composite secondary lower threshold for ${asset}`).to.equal(
    expectedConfig.lowerThresholdInBase2,
  );
  expect(BigInt(feedConfig.secondaryThreshold.fixedPriceInBase), `composite secondary fixed price for ${asset}`).to.equal(
    expectedConfig.fixedPriceInBase2,
  );
  await expectAlivePrice(wrapper, asset, `new composite wrapper price for ${asset}`);
}

async function expectThirdFeed(wrapper: any, asset: string, expectedConfig: any): Promise<void> {
  const feedConfig = await wrapper.feeds(asset);

  expect(feedConfig.erc4626Vault.toLowerCase(), `3-leg vault for ${asset}`).to.equal(expectedConfig.erc4626Vault.toLowerCase());
  expect(feedConfig.rateProvider.toLowerCase(), `3-leg rate provider for ${asset}`).to.equal(expectedConfig.rateProvider.toLowerCase());
  expect(feedConfig.thirdFeed.toLowerCase(), `3-leg third feed for ${asset}`).to.equal(expectedConfig.thirdFeed.toLowerCase());
  expect(BigInt(feedConfig.primaryThreshold.lowerThresholdInBase), `3-leg primary lower threshold for ${asset}`).to.equal(
    expectedConfig.lowerThresholdInBase1,
  );
  expect(BigInt(feedConfig.primaryThreshold.fixedPriceInBase), `3-leg primary fixed price for ${asset}`).to.equal(
    expectedConfig.fixedPriceInBase1,
  );
  expect(BigInt(feedConfig.secondaryThreshold.lowerThresholdInBase), `3-leg secondary lower threshold for ${asset}`).to.equal(
    expectedConfig.lowerThresholdInBase2,
  );
  expect(BigInt(feedConfig.secondaryThreshold.fixedPriceInBase), `3-leg secondary fixed price for ${asset}`).to.equal(
    expectedConfig.fixedPriceInBase2,
  );
  expect(BigInt(feedConfig.tertiaryThreshold.lowerThresholdInBase), `3-leg tertiary lower threshold for ${asset}`).to.equal(
    expectedConfig.lowerThresholdInBase3,
  );
  expect(BigInt(feedConfig.tertiaryThreshold.fixedPriceInBase), `3-leg tertiary fixed price for ${asset}`).to.equal(
    expectedConfig.fixedPriceInBase3,
  );
  await expectAlivePrice(wrapper, asset, `3-leg wrapper price for ${asset}`);
}

async function expectAggregatorRoute(aggregator: any, asset: string, expectedOracle: string): Promise<void> {
  expect((await aggregator.assetOracles(asset)).toLowerCase(), `OracleAggregator route for ${asset}`).to.equal(
    expectedOracle.toLowerCase(),
  );
}

async function expectAlivePrice(oracle: any, asset: string, label: string): Promise<void> {
  const priceInfo = await oracle.getPriceInfo(asset);
  const price = BigInt(priceInfo[0]);
  const isAlive = Boolean(priceInfo[1]);

  expect(isAlive, `${label} should be alive`).to.equal(true);
  expect(price, `${label} should be positive`).to.be.greaterThan(0n);
}

async function buildContractRegistry(): Promise<Record<string, any>> {
  const registry: Record<string, any> = {};

  await registerDeployment(registry, USD_CHAINLINK_FEED_WRAPPER_ID, LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT);
  await registerDeployment(
    registry,
    USD_CHAINLINK_FEED_WRAPPER_WITH_THRESHOLDING_ID,
    LEGACY_CHAINLINK_FEED_WRAPPER_WITH_THRESHOLDING_ARTIFACT,
  );
  await registerDeployment(registry, USD_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID, CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT);
  await registerDeployment(registry, S_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID, CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT);
  await registerDeployment(registry, USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID, ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ARTIFACT);
  await registerDeployment(registry, USD_ORACLE_AGGREGATOR_ID, "OracleAggregator");
  await registerDeployment(registry, S_ORACLE_AGGREGATOR_ID, "OracleAggregator");

  return registry;
}

async function registerDeployment(registry: Record<string, any>, deploymentId: string, artifactName: string): Promise<void> {
  const deployment = await hre.deployments.getOrNull(deploymentId);

  if (!deployment) {
    return;
  }

  registry[deployment.address.toLowerCase()] = await hre.ethers.getContractAt(artifactName, deployment.address);
}

async function executeQueuedBatch(
  batch: SafeTransactionData[],
  governanceSigner: Awaited<ReturnType<typeof hre.ethers.getSigner>>,
  contractsByAddress: Record<string, any>,
): Promise<void> {
  for (const transaction of batch) {
    const contract = contractsByAddress[transaction.to.toLowerCase()];

    if (!contract) {
      throw new Error(`No contract registered for queued Safe transaction target ${transaction.to}`);
    }

    const parsed = contract.interface.parseTransaction({ data: transaction.data });

    if (!parsed) {
      throw new Error(`Could not decode queued Safe transaction for ${transaction.to}`);
    }

    const response = await contract.connect(governanceSigner)[parsed.name](...parsed.args);
    await response.wait();
  }
}

function parseFunctionName(transaction: SafeTransactionData, contractsByAddress: Record<string, any>): string {
  const contract = contractsByAddress[transaction.to.toLowerCase()];

  if (!contract) {
    throw new Error(`Missing contract interface for ${transaction.to}`);
  }

  const parsed = contract.interface.parseTransaction({ data: transaction.data });

  if (!parsed) {
    throw new Error(`Could not decode Safe transaction for ${transaction.to}`);
  }

  return parsed.name;
}

async function impersonateAccount(address: string): Promise<Awaited<ReturnType<typeof hre.ethers.getSigner>>> {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
  await hre.network.provider.request({
    method: "hardhat_setBalance",
    params: [address, "0x3635C9ADC5DEA00000"],
  });
  return hre.ethers.getSigner(address);
}

function listSafeBuilderFiles(): string[] {
  const safeArtifactsDir = path.join(requiredEnv("HARDHAT_DEPLOYMENTS_PATH"), "hardhat");

  if (!fs.existsSync(safeArtifactsDir)) {
    return [];
  }

  return fs
    .readdirSync(safeArtifactsDir)
    .filter((filename) => filename.startsWith("safe-builder-batch-"))
    .sort();
}

function requiredConfig<T>(value: T | undefined, label: string): T {
  if (!value) {
    throw new Error(`Missing required config for ${label}`);
  }

  return value;
}

function requiredAddress(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing required address for ${label}`);
  }

  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }

  return value;
}

function resolveRpcUrl(): string {
  return process.env.SONIC_MAINNET_RPC_URL || process.env.SONIC_RPC_URL || "https://rpc.soniclabs.com";
}

function resolveNpxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}
