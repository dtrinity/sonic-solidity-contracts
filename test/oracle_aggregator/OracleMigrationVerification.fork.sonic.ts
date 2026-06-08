import { expect } from "chai";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import hre from "hardhat";

import { SafeManager } from "@dtrinity/shared-hardhat-tools";

import { assertOraclePriceAlive, assertPriceContinuity, readOraclePriceSample } from "../../deploy/_shared/oracle-price-sanity";
import { executeStage1, OracleMigrationConfig } from "../../deploy/18_oracle_migrations/01_update_s_chainlink_feeds";
import { executeStage2 } from "../../deploy/18_oracle_migrations/02_switch_s_chainlink_oracles";
import { USD_ORACLE_AGGREGATOR_ID, USD_REDSTONE_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

const ENABLE_ENV = "ORACLE_MIGRATION_FORK_TESTS";
const WORKER_ENV = "ORACLE_MIGRATION_FORK_WORKER";
const PRE_MIGRATION_BLOCK = 50_542_516;
const SANITY_TOLERANCE_BPS = 100n;
const STAGE1_ID = "update-s-chainlink-feeds";
const STAGE2_ID = "switch-s-chainlink-oracles";

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

type AssetSnapshot = {
  asset: string;
  aggregatorOracle: string;
  aggregatorPrice: Awaited<ReturnType<typeof readOraclePriceSample>>;
};

type FeedSnapshot = AssetSnapshot & {
  feed: string;
};

describe("Oracle migration verification on Sonic fork", () => {
  if (process.env[WORKER_ENV] === "true") {
    describe("worker", () => {
      let previousUseSafe: string | undefined;
      let recordedBatches: SafeTransactionData[][];

      before(async function () {
        if (process.env[ENABLE_ENV] !== "true") {
          this.skip();
          return;
        }

        this.timeout(180000);

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
                blockNumber: PRE_MIGRATION_BLOCK,
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

      it("verifies migration correctness and rerun idempotency on copied deployment artifacts", async function () {
        this.timeout(180000);

        const config = await buildOracleMigrationConfig();
        const { deployments, ethers } = hre;
        const [defaultSigner] = await ethers.getSigners();

        const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
        const redstoneWrapperDeployment = await deployments.get(USD_REDSTONE_ORACLE_WRAPPER_ID);

        const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, defaultSigner);
        const redstoneWrapper = await ethers.getContractAt("RedstoneChainlinkWrapper", redstoneWrapperDeployment.address, defaultSigner);

        const wS = requiredAddress(config.tokenAddresses.wS, "wS");
        const dS = requiredAddress(config.tokenAddresses.dS, "dS");
        const expectedSFeed = requiredAddress(
          config.oracleAggregators.USD.redstoneOracleAssets?.plainRedstoneOracleWrappers?.[wS],
          "wS Chainlink S/USD feed",
        );

        const targetAssets = [wS, dS];
        const unrelatedAssets = ["0x80Eede496655FB9047dd39d9f418d5483ED600df", "0x29219dd400f2Bf60E5a23d13Be72B486D4038894"];

        const preStage1Feeds = await snapshotFeedAssets(oracleAggregator, redstoneWrapper, targetAssets);
        const unrelatedBefore = await snapshotOracleMappings(oracleAggregator, unrelatedAssets);
        const migrationsBefore = readMigrations();

        expect(preStage1Feeds.map((snapshot) => snapshot.aggregatorOracle.toLowerCase())).to.not.include(
          redstoneWrapperDeployment.address.toLowerCase(),
        );
        expect(preStage1Feeds.map((snapshot) => snapshot.feed)).to.deep.equal([hre.ethers.ZeroAddress, hre.ethers.ZeroAddress]);

        const stage1Complete = await executeStage1(hre, { config });
        expect(stage1Complete).to.equal(false);
        writeMigrationKey(STAGE1_ID);

        const stage1Migrations = readMigrations();
        expectMigrationKeysUnchangedExcept(migrationsBefore, stage1Migrations, [STAGE1_ID]);
        expect(recordedBatches).to.have.length(1);
        expect(recordedBatches[0]).to.have.length(2);

        const stage1FunctionNames = recordedBatches[0].map((transaction) =>
          parseFunctionName(transaction, {
            [redstoneWrapperDeployment.address.toLowerCase()]: redstoneWrapper,
          }),
        );
        expect(stage1FunctionNames).to.deep.equal(["setFeed", "setFeed"]);

        await executeQueuedBatch(recordedBatches[0], await impersonateAccount(config.safeConfig.safeAddress), {
          [redstoneWrapperDeployment.address.toLowerCase()]: redstoneWrapper,
        });

        const postStage1Feeds = await snapshotFeedAssets(oracleAggregator, redstoneWrapper, targetAssets);

        for (const snapshot of postStage1Feeds) {
          expect(snapshot.feed.toLowerCase()).to.equal(expectedSFeed.toLowerCase());
          assertOraclePriceAlive(snapshot.aggregatorPrice, `Stage 1 aggregator price for ${snapshot.asset}`);
        }

        for (const [index, asset] of targetAssets.entries()) {
          const wrapperPrice = await readOraclePriceSample("USD_RedstoneChainlinkWrapper", redstoneWrapper, asset);
          assertOraclePriceAlive(wrapperPrice, `Stage 1 wrapper price for ${asset}`);
          assertPriceContinuity(
            preStage1Feeds[index].aggregatorPrice,
            wrapperPrice,
            SANITY_TOLERANCE_BPS,
            `Stage 1 continuity for ${asset}`,
          );
        }

        const stage2Complete = await executeStage2(hre, { config });
        expect(stage2Complete).to.equal(false);

        const pendingStage2Migrations = readMigrations();
        expectMigrationKeysUnchangedExcept(stage1Migrations, pendingStage2Migrations, []);
        expect(recordedBatches).to.have.length(2);
        expect(recordedBatches[1]).to.have.length(2);

        const stage2FunctionNames = recordedBatches[1].map((transaction) =>
          parseFunctionName(transaction, {
            [oracleAggregatorDeployment.address.toLowerCase()]: oracleAggregator,
          }),
        );
        expect(stage2FunctionNames).to.deep.equal(["setOracle", "setOracle"]);

        await executeQueuedBatch(recordedBatches[1], await impersonateAccount(config.safeConfig.safeAddress), {
          [oracleAggregatorDeployment.address.toLowerCase()]: oracleAggregator,
        });
        writeMigrationKey(STAGE2_ID);

        const stage2Migrations = readMigrations();
        expectMigrationKeysUnchangedExcept(stage1Migrations, stage2Migrations, [STAGE2_ID]);

        const postStage2Feeds = await snapshotFeedAssets(oracleAggregator, redstoneWrapper, targetAssets);
        const unrelatedAfter = await snapshotOracleMappings(oracleAggregator, unrelatedAssets);

        for (const snapshot of postStage2Feeds) {
          expect(snapshot.aggregatorOracle.toLowerCase()).to.equal(redstoneWrapperDeployment.address.toLowerCase());
          expect(snapshot.feed.toLowerCase()).to.equal(expectedSFeed.toLowerCase());
          assertOraclePriceAlive(snapshot.aggregatorPrice, `Stage 2 aggregator price for ${snapshot.asset}`);
        }

        for (const [index, snapshot] of postStage2Feeds.entries()) {
          assertPriceContinuity(
            preStage1Feeds[index].aggregatorPrice,
            snapshot.aggregatorPrice,
            SANITY_TOLERANCE_BPS,
            `Stage 2 continuity for ${snapshot.asset}`,
          );
        }
        expect(unrelatedAfter).to.deep.equal(unrelatedBefore);

        const builderFilesBeforeReruns = listSafeBuilderFiles();

        deleteMigrationKey(STAGE1_ID);
        const afterStage1Toggle = readMigrations();
        expect(afterStage1Toggle[STAGE2_ID]).to.equal(stage2Migrations[STAGE2_ID]);
        expect(afterStage1Toggle[STAGE1_ID]).to.equal(undefined);

        const stage1RerunComplete = await executeStage1(hre, { config });
        expect(stage1RerunComplete).to.equal(true);
        writeMigrationKey(STAGE1_ID);

        const afterStage1Rerun = readMigrations();
        expectMigrationKeysUnchangedExcept(stage2Migrations, afterStage1Rerun, [STAGE1_ID]);
        expect(recordedBatches).to.have.length(2);
        expect(listSafeBuilderFiles()).to.deep.equal(builderFilesBeforeReruns);
        expect(await snapshotOracleMappings(oracleAggregator, unrelatedAssets)).to.deep.equal(unrelatedBefore);

        deleteMigrationKey(STAGE2_ID);
        const afterStage2Toggle = readMigrations();
        expect(afterStage2Toggle[STAGE1_ID]).to.equal(afterStage1Rerun[STAGE1_ID]);
        expect(afterStage2Toggle[STAGE2_ID]).to.equal(undefined);

        const stage2RerunComplete = await executeStage2(hre, { config });
        expect(stage2RerunComplete).to.equal(true);
        writeMigrationKey(STAGE2_ID);

        const afterStage2Rerun = readMigrations();
        expectMigrationKeysUnchangedExcept(afterStage1Rerun, afterStage2Rerun, [STAGE2_ID]);
        expect(recordedBatches).to.have.length(2);
        expect(listSafeBuilderFiles()).to.deep.equal(builderFilesBeforeReruns);

        const finalFeeds = await snapshotFeedAssets(oracleAggregator, redstoneWrapper, targetAssets);
        expect(finalFeeds).to.deep.equal(postStage2Feeds);
      });
    });
  } else {
    it("runs the worker suite against a temporary deployment copy", function () {
      if (process.env[ENABLE_ENV] !== "true") {
        this.skip();
        return;
      }

      this.timeout(180000);

      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-migration-fork-"));
      const sourceDeployments = path.join(process.cwd(), "deployments", "sonic_mainnet");
      const tempDeployments = path.join(tempRoot, "sonic_mainnet");

      fs.cpSync(sourceDeployments, tempDeployments, { recursive: true });
      resetMigrationKeys(path.join(tempDeployments, ".migrations.json"), [STAGE1_ID, STAGE2_ID]);

      try {
        execFileSync(
          resolveNpxCommand(),
          ["hardhat", "test", "--network", "hardhat", "--no-compile", "test/oracle_aggregator/OracleMigrationVerification.fork.sonic.ts"],
          {
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
          },
        );
      } catch (error) {
        console.error(`Preserving temp deployment copy for inspection: ${tempRoot}`);
        throw error;
      }

      fs.rmSync(tempRoot, { force: true, recursive: true });
    });
  }
});

async function snapshotFeedAssets(oracleAggregator: any, wrapper: any, assets: string[]): Promise<FeedSnapshot[]> {
  return Promise.all(
    assets.map(async (asset) => ({
      aggregatorOracle: await oracleAggregator.assetOracles(asset),
      aggregatorPrice: await readOraclePriceSample("USD_OracleAggregator", oracleAggregator, asset),
      asset,
      feed: await wrapper.assetToFeed(asset),
    })),
  );
}

async function snapshotOracleMappings(oracleAggregator: any, assets: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(assets.map(async (asset) => [asset, await oracleAggregator.assetOracles(asset)] as const));
  return Object.fromEntries(entries);
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

function readMigrations(): Record<string, number> {
  return JSON.parse(fs.readFileSync(migrationsPath(), "utf8"));
}

function deleteMigrationKey(key: string): void {
  const migrations = readMigrations();
  delete migrations[key];
  fs.writeFileSync(migrationsPath(), JSON.stringify(migrations, null, 2));
}

function writeMigrationKey(key: string): void {
  const migrations = readMigrations();
  migrations[key] = Math.floor(Date.now() / 1000);
  fs.writeFileSync(migrationsPath(), JSON.stringify(migrations, null, 2));
}

function resetMigrationKeys(filePath: string, keys: string[]): void {
  const migrations = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, number>;

  for (const key of keys) {
    delete migrations[key];
  }

  fs.writeFileSync(filePath, JSON.stringify(migrations, null, 2));
}

function expectMigrationKeysUnchangedExcept(
  before: Record<string, number>,
  after: Record<string, number>,
  allowedChangedKeys: string[],
): void {
  const allowed = new Set(allowedChangedKeys);
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (allowed.has(key)) {
      expect(after[key], `expected migration key ${key} to be present after rerun`).to.be.a("number");
      continue;
    }

    expect(after[key], `unexpected migration key change for ${key}`).to.equal(before[key]);
  }
}

function migrationsPath(): string {
  return path.join(requiredEnv("HARDHAT_DEPLOYMENTS_PATH"), "sonic_mainnet", ".migrations.json");
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

async function buildOracleMigrationConfig(): Promise<OracleMigrationConfig> {
  const dSDeployment = await hre.deployments.get("dS");

  const governanceMultisig = "0xE83c188a7BE46B90715C757A06cF917175f30262";
  const wS = "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38";
  const stS = "0xE5DA20F15420aD15DE0fa650600aFc998bbE3955";
  const sUsdChainlinkFeed = "0xc76dFb89fF298145b417d221B2c747d84952e01d";
  const stSOverSFeed = "0x65d0F14f7809CdC4f90c3978c753C4671b6B815b";

  return {
    safeConfig: {
      chainId: 146,
      owners: [
        "0xDC672ba6e55B71b39FA5423D42B88E7aDF9d24A4",
        "0x4B58fF1AAE6AdD7465A5584eBCaeb876ec8f21FD",
        "0x9E0c8376940aBE845A89b7304147a95c72644f59",
      ],
      rpcUrl: resolveRpcUrl(),
      safeAddress: governanceMultisig,
      threshold: 2,
    },
    walletAddresses: {
      governanceMultisig,
      incentivesVault: "0x4B4B5cC616be4cd1947B93f2304d36b3e80D3ef6",
    },
    tokenAddresses: {
      dS: dSDeployment.address,
      stS,
      wS,
    },
    oracleAggregators: {
      USD: {
        redstoneOracleAssets: {
          plainRedstoneOracleWrappers: {
            [wS]: sUsdChainlinkFeed,
            [dSDeployment.address]: sUsdChainlinkFeed,
          },
          compositeRedstoneOracleWrappersWithThresholding: {
            [stS]: {
              feedAsset: stS,
              feed1: stSOverSFeed,
              feed2: sUsdChainlinkFeed,
              fixedPriceInBase1: 0n,
              fixedPriceInBase2: 0n,
              lowerThresholdInBase1: 0n,
              lowerThresholdInBase2: 0n,
            },
          },
        },
      },
    },
  } as OracleMigrationConfig;
}
