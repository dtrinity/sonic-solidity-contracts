import { expect } from "chai";
import fs from "fs";
import path from "path";
import hre from "hardhat";

import { SafeManager } from "@dtrinity/shared-hardhat-tools";
import { SafeTransactionData } from "../../.shared/lib/roles/types";
import { Config } from "../../config/types";
import { USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { executeDeployment } from "../../deploy/16_safe_rate_provider_wrappers/01_deploy_chainlink_safe_rate_provider_composite_wrapper";
import { executeOracleFlip } from "../../deploy/16_safe_rate_provider_wrappers/02_queue_chainlink_safe_rate_provider_oracle_updates";

const BASE_CURRENCY = hre.ethers.ZeroAddress;
const BASE_CURRENCY_UNIT = 10n ** 8n;

type RolloutFixture = {
  config: Config;
  governanceSigner: Awaited<ReturnType<typeof hre.ethers.getSigner>>;
  contracts: {
    aggregator: any;
    currentOracle: any;
    wrapper: any;
  };
  feedAsset: string;
  oracleManagerRole: string;
  wrapperAddress: string;
};

describe("Safe-mode oracle rollout scripts", () => {
  let previousUseSafe: string | undefined;
  let recordedBatches: SafeTransactionData[][];

  before(async () => {
    previousUseSafe = process.env.USE_SAFE;
  });

  beforeEach(async () => {
    recordedBatches = [];
    process.env.USE_SAFE = "true";

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
    cleanupSafeArtifacts();

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
  });

  afterEach(() => {
    SafeManager.setProtocolKitFactory(undefined);
    cleanupSafeArtifacts();
  });

  after(() => {
    if (previousUseSafe === undefined) {
      delete process.env.USE_SAFE;
    } else {
      process.env.USE_SAFE = previousUseSafe;
    }
  });

  it("queues prerequisite grants before wrapper setup and oracle routing, writes Safe artifacts, and becomes a no-op once executed", async () => {
    const fixture = await setupRolloutFixture();

    const phaseOneResult = await executeDeployment(hre, { config: fixture.config });
    expect(phaseOneResult).to.equal(false);
    expect(recordedBatches).to.have.length(1);

    const phaseOneBatch = recordedBatches[0];
    expect(phaseOneBatch).to.have.length(2);
    expect(parseFunctionName(fixture.contracts.wrapper, phaseOneBatch[0].data)).to.equal("grantRole");
    expect(parseFunctionName(fixture.contracts.wrapper, phaseOneBatch[1].data)).to.equal("addCompositeFeed");
    expect(phaseOneBatch[0].to).to.equal(fixture.wrapperAddress);
    expect(phaseOneBatch[1].to).to.equal(fixture.wrapperAddress);

    const phaseOneState = readSafeDeploymentState();
    expect(phaseOneState.pendingTransactions).to.have.length(1);
    expect(phaseOneState.pendingTransactions[0].description).to.contain("Deploy ChainlinkSafeRateProviderComposite wrapper");

    const phaseOneBuilderFiles = listSafeBuilderFiles();
    expect(phaseOneBuilderFiles).to.have.length(1);
    const phaseOneBuilder = JSON.parse(fs.readFileSync(phaseOneBuilderFiles[0], "utf8"));
    expect(phaseOneBuilder.transactions.map((transaction: SafeTransactionData) => parseFunctionName(fixture.contracts.wrapper, transaction.data))).to.deep.equal([
      "grantRole",
      "addCompositeFeed",
    ]);

    await executeQueuedBatch(phaseOneBatch, fixture.governanceSigner, {
      [fixture.wrapperAddress.toLowerCase()]: fixture.contracts.wrapper,
    });

    expect(await fixture.contracts.wrapper.hasRole(fixture.oracleManagerRole, await fixture.governanceSigner.getAddress())).to.equal(true);
    const configuredFeed = await fixture.contracts.wrapper.compositeFeeds(fixture.feedAsset);
    expect(configuredFeed.feed1).to.equal(fixture.config.oracleAggregators.USD.safeRateProviderAssets!.chainlinkSafeRateProviderCompositeWrappers![fixture.feedAsset].chainlinkFeed);

    const phaseOneRerunResult = await executeDeployment(hre, { config: fixture.config });
    expect(phaseOneRerunResult).to.equal(true);
    expect(recordedBatches).to.have.length(1);

    const phaseTwoResult = await executeOracleFlip(hre, { config: fixture.config });
    expect(phaseTwoResult).to.equal(false);
    expect(recordedBatches).to.have.length(2);

    const phaseTwoBatch = recordedBatches[1];
    expect(phaseTwoBatch).to.have.length(2);
    expect(parseFunctionName(fixture.contracts.aggregator, phaseTwoBatch[0].data)).to.equal("grantRole");
    expect(parseFunctionName(fixture.contracts.aggregator, phaseTwoBatch[1].data)).to.equal("setOracle");
    expect(phaseTwoBatch[0].to).to.equal(await fixture.contracts.aggregator.getAddress());
    expect(phaseTwoBatch[1].to).to.equal(await fixture.contracts.aggregator.getAddress());

    const phaseTwoState = readSafeDeploymentState();
    expect(phaseTwoState.pendingTransactions).to.have.length(2);

    const phaseTwoBuilderFiles = listSafeBuilderFiles();
    expect(phaseTwoBuilderFiles).to.have.length(2);
    const phaseTwoBuilder = JSON.parse(fs.readFileSync(phaseTwoBuilderFiles[1], "utf8"));
    expect(
      phaseTwoBuilder.transactions.map((transaction: SafeTransactionData) => parseFunctionName(fixture.contracts.aggregator, transaction.data)),
    ).to.deep.equal(["grantRole", "setOracle"]);

    await executeQueuedBatch(phaseTwoBatch, fixture.governanceSigner, {
      [(await fixture.contracts.aggregator.getAddress()).toLowerCase()]: fixture.contracts.aggregator,
    });

    expect(await fixture.contracts.aggregator.assetOracles(fixture.feedAsset)).to.equal(fixture.wrapperAddress);

    const phaseTwoRerunResult = await executeOracleFlip(hre, { config: fixture.config });
    expect(phaseTwoRerunResult).to.equal(true);
    expect(recordedBatches).to.have.length(2);
  });

  it("fails with an actionable error when the wrapper configuration does not match the expected flip config", async () => {
    const fixture = await setupRolloutFixture();

    await executeDeployment(hre, { config: fixture.config });
    await executeQueuedBatch(recordedBatches[0], fixture.governanceSigner, {
      [fixture.wrapperAddress.toLowerCase()]: fixture.contracts.wrapper,
    });

    const invalidConfig = structuredClone(fixture.config) as Config;
    invalidConfig.oracleAggregators.USD.safeRateProviderAssets!.chainlinkSafeRateProviderCompositeWrappers![fixture.feedAsset].chainlinkFeed =
      await fixture.contracts.currentOracle.getAddress();

    await expect(executeOracleFlip(hre, { config: invalidConfig })).to.be.rejectedWith(
      `Configured feed ${fixture.config.oracleAggregators.USD.safeRateProviderAssets!.chainlinkSafeRateProviderCompositeWrappers![fixture.feedAsset].chainlinkFeed} does not match expected Chainlink feed ${await fixture.contracts.currentOracle.getAddress()}`,
    );
  });
});

async function setupRolloutFixture(): Promise<RolloutFixture> {
  const [deployerSigner, governanceSigner] = await hre.ethers.getSigners();
  const governanceAddress = await governanceSigner.getAddress();
  const deployerAddress = await deployerSigner.getAddress();

  const tokenFactory = await hre.ethers.getContractFactory("TestERC20");
  const feedAsset = await tokenFactory.deploy("Wrapped Stake USD", "wstkscUSD", 18);
  await feedAsset.waitForDeployment();

  const chainlinkFactory = await hre.ethers.getContractFactory("MockChainlinkAggregatorV3");
  const chainlinkFeed = await chainlinkFactory.deploy(8, "wstkscUSD/scUSD");
  await chainlinkFeed.waitForDeployment();
  await (await chainlinkFeed.setMock(2n * BASE_CURRENCY_UNIT)).wait();

  const rateProviderFactory = await hre.ethers.getContractFactory("MockRateProvider");
  const rateProvider = await rateProviderFactory.deploy(10n ** 18n, 1n * 10n ** 18n);
  await rateProvider.waitForDeployment();

  const hardPegFactory = await hre.ethers.getContractFactory("HardPegOracleWrapper");
  const currentOracle = await hardPegFactory.deploy(BASE_CURRENCY, BASE_CURRENCY_UNIT, 2n * BASE_CURRENCY_UNIT);
  await currentOracle.waitForDeployment();

  const wrapperFactory = await hre.ethers.getContractFactory("ChainlinkSafeRateProviderCompositeWrapperWithThresholding");
  const wrapper = await wrapperFactory.deploy(BASE_CURRENCY, BASE_CURRENCY_UNIT);
  await wrapper.waitForDeployment();

  const aggregatorFactory = await hre.ethers.getContractFactory("OracleAggregator");
  const aggregator = await aggregatorFactory.deploy(BASE_CURRENCY, BASE_CURRENCY_UNIT);
  await aggregator.waitForDeployment();
  await (await aggregator.setOracle(await feedAsset.getAddress(), await currentOracle.getAddress())).wait();

  const defaultAdminRole = await wrapper.DEFAULT_ADMIN_ROLE();
  const oracleManagerRole = await wrapper.ORACLE_MANAGER_ROLE();
  await (await wrapper.grantRole(defaultAdminRole, governanceAddress)).wait();
  await (await wrapper.revokeRole(oracleManagerRole, deployerAddress)).wait();
  await (await wrapper.revokeRole(defaultAdminRole, deployerAddress)).wait();

  const aggregatorDefaultAdminRole = await aggregator.DEFAULT_ADMIN_ROLE();
  const aggregatorOracleManagerRole = await aggregator.ORACLE_MANAGER_ROLE();
  await (await aggregator.grantRole(aggregatorDefaultAdminRole, governanceAddress)).wait();
  await (await aggregator.revokeRole(aggregatorOracleManagerRole, deployerAddress)).wait();
  await (await aggregator.revokeRole(aggregatorDefaultAdminRole, deployerAddress)).wait();

  await saveDeployment(USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID, "ChainlinkSafeRateProviderCompositeWrapperWithThresholding", wrapper);
  await saveDeployment(USD_ORACLE_AGGREGATOR_ID, "OracleAggregator", aggregator);

  const chainlinkFeedAddress = await chainlinkFeed.getAddress();
  const rateProviderAddress = await rateProvider.getAddress();
  const feedAssetAddress = await feedAsset.getAddress();

  return {
    config: {
      safeConfig: {
        safeAddress: governanceAddress,
        owners: [governanceAddress],
        threshold: 1,
        chainId: 31337,
      },
      walletAddresses: {
        governanceMultisig: governanceAddress,
        incentivesVault: governanceAddress,
      },
      oracleAggregators: {
        USD: {
          baseCurrency: BASE_CURRENCY,
          hardDStablePeg: BASE_CURRENCY_UNIT,
          priceDecimals: 8,
          api3OracleAssets: {
            plainApi3OracleWrappers: {},
            api3OracleWrappersWithThresholding: {},
            compositeApi3OracleWrappersWithThresholding: {},
          },
          redstoneOracleAssets: {
            plainRedstoneOracleWrappers: {},
            redstoneOracleWrappersWithThresholding: {},
            compositeRedstoneOracleWrappersWithThresholding: {},
          },
          safeRateProviderAssets: {
            chainlinkSafeRateProviderCompositeWrappers: {
              [feedAssetAddress]: {
                feedAsset: feedAssetAddress,
                chainlinkFeed: chainlinkFeedAddress,
                rateProvider: rateProviderAddress,
                lowerThresholdInBase1: 0n,
                fixedPriceInBase1: 0n,
                lowerThresholdInBase2: BASE_CURRENCY_UNIT,
                fixedPriceInBase2: BASE_CURRENCY_UNIT,
              },
            },
          },
        },
      },
    } as Config,
    governanceSigner,
    contracts: {
      aggregator,
      currentOracle,
      wrapper,
    },
    feedAsset: feedAssetAddress,
    oracleManagerRole,
    wrapperAddress: await wrapper.getAddress(),
  };
}

async function saveDeployment(name: string, artifactName: string, contract: any): Promise<void> {
  const artifact = await hre.deployments.getArtifact(artifactName);
  await hre.deployments.save(name, {
    abi: artifact.abi,
    address: await contract.getAddress(),
  });
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

function parseFunctionName(contract: any, data: string): string {
  const parsed = contract.interface.parseTransaction({ data });

  if (!parsed) {
    throw new Error(`Could not decode transaction data for ${awaitableAddress(contract)}`);
  }

  return parsed.name;
}

function awaitableAddress(contract: any): string {
  return contract.target?.toString?.() ?? "unknown-contract";
}

function cleanupSafeArtifacts(): void {
  const directory = safeArtifactsDirectory();

  if (!fs.existsSync(directory)) {
    return;
  }

  for (const filename of fs.readdirSync(directory)) {
    if (filename === "safe-deployment-state.json" || filename.startsWith("safe-builder-batch-")) {
      fs.rmSync(path.join(directory, filename), { force: true });
    }
  }
}

function listSafeBuilderFiles(): string[] {
  const directory = safeArtifactsDirectory();

  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((filename) => filename.startsWith("safe-builder-batch-"))
    .sort()
    .map((filename) => path.join(directory, filename));
}

function readSafeDeploymentState(): {
  pendingTransactions: Array<{ description: string }>;
  completedTransactions: unknown[];
  failedTransactions: unknown[];
} {
  const statePath = path.join(safeArtifactsDirectory(), "safe-deployment-state.json");

  if (!fs.existsSync(statePath)) {
    throw new Error(`Expected Safe deployment state at ${statePath}`);
  }

  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function safeArtifactsDirectory(): string {
  return path.join(hre.config.paths.deployments, hre.network.name);
}
