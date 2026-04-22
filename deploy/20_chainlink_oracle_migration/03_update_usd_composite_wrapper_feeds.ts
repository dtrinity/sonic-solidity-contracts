import { Signer, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT } from "../../typescript/oracle-wrapper-artifacts";

const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];
const ZERO_BYTES_32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

type CompositePriceDiagnostics = {
  candidatePrice: bigint;
  priceInBase1: bigint;
  priceInBase2: bigint;
  chainlinkAnswer1: bigint;
  chainlinkAnswer2: bigint;
  feed1Decimals: number;
  feed2Decimals: number;
  updatedAt1: bigint;
  updatedAt2: bigint;
};

type CompositeTarget = {
  label: string;
  asset: string;
};

type SimpleTarget = {
  label: string;
  asset: string;
};

/**
 * Read the live Chainlink legs so the migration logs the exact composite price being introduced.
 *
 * @param ethers - Hardhat ethers helper.
 * @param feed1 - First Chainlink feed address.
 * @param feed2 - Second Chainlink feed address.
 * @param baseCurrencyUnit - Wrapper base currency precision.
 * @param signer - Signer used for read-only calls.
 * @returns Composite price diagnostics for the proposed feed pair.
 */
async function buildCompositePriceDiagnostics(
  ethers: HardhatRuntimeEnvironment["ethers"],
  feed1: string,
  feed2: string,
  baseCurrencyUnit: bigint,
  signer: Signer,
): Promise<CompositePriceDiagnostics> {
  const priceFeed1 = new ethers.Contract(feed1, PRICE_FEED_ABI, signer);
  const priceFeed2 = new ethers.Contract(feed2, PRICE_FEED_ABI, signer);

  const feed1DecimalsRaw = await priceFeed1.decimals();
  const feed1Decimals = typeof feed1DecimalsRaw === "number" ? feed1DecimalsRaw : Number(feed1DecimalsRaw);

  const feed2DecimalsRaw = await priceFeed2.decimals();
  const feed2Decimals = typeof feed2DecimalsRaw === "number" ? feed2DecimalsRaw : Number(feed2DecimalsRaw);

  if (feed1Decimals === 0) {
    throw new Error(`Feed1 ${feed1} reports 0 decimals`);
  }

  if (feed2Decimals === 0) {
    throw new Error(`Feed2 ${feed2} reports 0 decimals`);
  }

  const feed1Unit = 10n ** BigInt(feed1Decimals);
  const feed2Unit = 10n ** BigInt(feed2Decimals);

  const roundData1 = await priceFeed1.latestRoundData();
  const answer1 = BigInt(roundData1.answer ?? roundData1[1]);
  const updatedAt1 = BigInt(roundData1.updatedAt ?? roundData1[3]);

  const roundData2 = await priceFeed2.latestRoundData();
  const answer2 = BigInt(roundData2.answer ?? roundData2[1]);
  const updatedAt2 = BigInt(roundData2.updatedAt ?? roundData2[3]);

  if (answer1 <= 0n) {
    throw new Error(`Feed1 ${feed1} returned non-positive answer ${answer1}`);
  }

  if (answer2 <= 0n) {
    throw new Error(`Feed2 ${feed2} returned non-positive answer ${answer2}`);
  }

  const priceInBase1 = (answer1 * baseCurrencyUnit) / feed1Unit;
  const priceInBase2 = (answer2 * baseCurrencyUnit) / feed2Unit;
  const candidatePrice = (priceInBase1 * priceInBase2) / baseCurrencyUnit;

  return {
    candidatePrice,
    priceInBase1,
    priceInBase2,
    chainlinkAnswer1: answer1,
    chainlinkAnswer2: answer2,
    feed1Decimals,
    feed2Decimals,
    updatedAt1,
    updatedAt2,
  };
}

/**
 * Build a Safe transaction payload to remove a composite feed.
 *
 * @param wrapperAddress - Composite wrapper contract address.
 * @param asset - Asset whose feed should be removed.
 * @param wrapperInterface - Wrapper interface used for call encoding.
 * @returns Encoded governance transaction data.
 */
function createRemoveCompositeFeedTransaction(wrapperAddress: string, asset: string, wrapperInterface: any): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("removeCompositeFeed", [asset]),
  };
}

/**
 * Build a Safe transaction payload to add a composite feed.
 *
 * @param wrapperAddress - Composite wrapper contract address.
 * @param asset - Asset whose feed should be configured.
 * @param feed1 - First Chainlink feed.
 * @param feed2 - Second Chainlink feed.
 * @param lowerThresholdInBase1 - Threshold config for leg 1.
 * @param fixedPriceInBase1 - Fixed price config for leg 1.
 * @param lowerThresholdInBase2 - Threshold config for leg 2.
 * @param fixedPriceInBase2 - Fixed price config for leg 2.
 * @param wrapperInterface - Wrapper interface used for call encoding.
 * @returns Encoded governance transaction data.
 */
function createAddCompositeFeedTransaction(
  wrapperAddress: string,
  asset: string,
  feed1: string,
  feed2: string,
  lowerThresholdInBase1: bigint,
  fixedPriceInBase1: bigint,
  lowerThresholdInBase2: bigint,
  fixedPriceInBase2: bigint,
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("addCompositeFeed", [
      asset,
      feed1,
      feed2,
      lowerThresholdInBase1,
      fixedPriceInBase1,
      lowerThresholdInBase2,
      fixedPriceInBase2,
    ]),
  };
}

function createSetFeedTransaction(wrapperAddress: string, asset: string, feed: string, wrapperInterface: any): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setFeed", [asset, feed]),
  };
}

function createSetThresholdConfigTransaction(
  wrapperAddress: string,
  asset: string,
  lowerThresholdInBase: bigint,
  fixedPriceInBase: bigint,
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setThresholdConfig", [asset, lowerThresholdInBase, fixedPriceInBase]),
  };
}

function createGrantRoleTransaction(contractAddress: string, role: string, grantee: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [role, grantee]),
  };
}

function createRevokeRoleTransaction(contractAddress: string, role: string, account: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("revokeRole", [role, account]),
  };
}

function hasQueuedTransaction(executor: GovernanceExecutor, transaction: SafeTransactionData): boolean {
  return executor.queuedTransactions.some(
    (queued) => queued.to === transaction.to && queued.value === transaction.value && queued.data === transaction.data,
  );
}

async function ensureGovernanceCanManageWrapper(
  wrapper: any,
  wrapperAddress: string,
  governanceMultisig: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  if (!executor.useSafe) {
    return true;
  }

  const oracleManagerRole = await wrapper.ORACLE_MANAGER_ROLE();
  if (await wrapper.hasRole(oracleManagerRole, governanceMultisig)) {
    console.log(`   ✓ Governance already has ORACLE_MANAGER_ROLE on ${wrapperAddress}`);
    return true;
  }

  const grantRoleTx = createGrantRoleTransaction(wrapperAddress, oracleManagerRole, governanceMultisig, wrapper.interface);
  if (hasQueuedTransaction(executor, grantRoleTx)) {
    console.log(`   📝 ORACLE_MANAGER_ROLE grant already queued for governance on ${wrapperAddress}`);
    return false;
  }

  return executor.tryOrQueue(
    async () => {
      const tx = await wrapper.grantRole(oracleManagerRole, governanceMultisig);
      await tx.wait();
      console.log(`   ➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig}`);
    },
    () => grantRoleTx,
  );
}

async function migrateWrapperRoles(
  hre: HardhatRuntimeEnvironment,
  wrapperAddress: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  const wrapper = await hre.ethers.getContractAt(CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT, wrapperAddress, deployerSigner);
  const deployerAddress = await deployerSigner.getAddress();
  const oracleManagerRole = await wrapper.ORACLE_MANAGER_ROLE();
  const roles = [
    { name: "DEFAULT_ADMIN_ROLE", hash: ZERO_BYTES_32 },
    { name: "ORACLE_MANAGER_ROLE", hash: oracleManagerRole },
  ];
  let complete = true;

  for (const role of roles) {
    if (await wrapper.hasRole(role.hash, governanceMultisig)) {
      console.log(`   ✓ ${role.name} already granted to governance`);
      continue;
    }

    const grantRoleTx = createGrantRoleTransaction(wrapperAddress, role.hash, governanceMultisig, wrapper.interface);
    if (hasQueuedTransaction(executor, grantRoleTx)) {
      console.log(`   📝 ${role.name} grant already queued for governance`);
      complete = false;
      continue;
    }

    const granted = await executor.tryOrQueue(
      async () => {
        const tx = await wrapper.grantRole(role.hash, governanceMultisig);
        await tx.wait();
        console.log(`   ➕ Granted ${role.name} to governance ${governanceMultisig}`);
      },
      () => grantRoleTx,
    );

    if (!granted) complete = false;
  }

  for (const role of [...roles].reverse()) {
    const deployerHasRole = await wrapper.hasRole(role.hash, deployerAddress);
    const governanceHasRole = await wrapper.hasRole(role.hash, governanceMultisig);
    if (!deployerHasRole || !governanceHasRole) {
      continue;
    }

    const revoked = await executor.tryOrQueue(
      async () => {
        const tx = await wrapper.revokeRole(role.hash, deployerAddress);
        await tx.wait();
        console.log(`   ➖ Revoked ${role.name} from deployer ${deployerAddress}`);
      },
      () => createRevokeRoleTransaction(wrapperAddress, role.hash, deployerAddress, wrapper.interface),
    );

    if (!revoked) complete = false;
  }

  return complete;
}

/**
 * Update or confirm the in-scope USD composite feeds used by the Chainlink migration.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when all work completed immediately, false when governance actions were queued.
 */
async function executeUpdate(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const usdConfig = config.oracleAggregators.USD;
  const baseCurrencyUnit = 10n ** BigInt(usdConfig.priceDecimals);
  const thresholdFeeds = usdConfig.redstoneOracleAssets?.redstoneOracleWrappersWithThresholding || {};
  const compositeFeeds = usdConfig.redstoneOracleAssets?.compositeRedstoneOracleWrappersWithThresholding || {};

  const wrapperDeployment = await deployments.deploy(USD_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID, {
    from: deployer,
    contract: CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT,
    args: [usdConfig.baseCurrency, baseCurrencyUnit],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });
  const wrapperAddress = wrapperDeployment.address;
  const wrapper = await ethers.getContractAt(CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT, wrapperAddress, deployerSigner);

  console.log(`🔐 Governance multisig: ${config.walletAddresses.governanceMultisig}`);
  console.log(`✅ Using Chainlink wrapper at: ${wrapperAddress}`);
  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  const targets: CompositeTarget[] = [
    { label: "sfrxUSD", asset: config.tokenAddresses.sfrxUSD },
    { label: "stS", asset: config.tokenAddresses.stS },
    { label: "PTaUSDC", asset: config.tokenAddresses.PTaUSDC },
    { label: "PTwstkscUSD", asset: config.tokenAddresses.PTwstkscUSD },
  ].filter((target) => Boolean(target.asset));

  const simpleTargets: SimpleTarget[] = [
    { label: "frxUSD", asset: config.tokenAddresses.frxUSD },
    { label: "scUSD", asset: config.tokenAddresses.scUSD },
  ].filter((target) => Boolean(target.asset));

  if (targets.length === 0 && simpleTargets.length === 0) {
    console.log("\n⚠️ No in-scope USD simple or composite assets configured for this network; skipping wrapper migration.");
    return true;
  }

  let hasPendingGovernance = false;

  const governanceReady = await ensureGovernanceCanManageWrapper(
    wrapper,
    wrapperAddress,
    config.walletAddresses.governanceMultisig,
    executor,
  );
  if (!governanceReady) {
    hasPendingGovernance = true;
  }

  for (const target of simpleTargets) {
    const expectedConfig = thresholdFeeds[target.asset];

    if (!expectedConfig) {
      throw new Error(`Missing Chainlink-backed USD simple threshold configuration for ${target.label} (${target.asset}).`);
    }

    const currentFeed = await wrapper.assetToFeed(target.asset);
    const currentFeedAddress = currentFeed.feed;
    const currentThreshold = currentFeed.threshold;
    const feedNeedsUpdate = currentFeedAddress.toLowerCase() !== expectedConfig.feed.toLowerCase();
    const thresholdNeedsUpdate =
      BigInt(currentThreshold.lowerThresholdInBase) !== expectedConfig.lowerThreshold ||
      BigInt(currentThreshold.fixedPriceInBase) !== expectedConfig.fixedPrice;

    if (!feedNeedsUpdate && !thresholdNeedsUpdate && currentFeedAddress !== ZeroAddress) {
      console.log(`\n✅ ${target.label} simple feed already matches the configured Chainlink-backed path.`);
      console.log(`   Asset: ${target.asset}`);
      console.log(`   Feed: ${currentFeedAddress}`);
      console.log(`   Threshold: lower=${currentThreshold.lowerThresholdInBase}, fixed=${currentThreshold.fixedPriceInBase}`);

      try {
        const price = await wrapper.getAssetPrice(target.asset);
        console.log(`   💵 Wrapper price: ${price}`);
      } catch (error) {
        console.warn(`   ⚠️ Could not read wrapper price for ${target.label}: ${error}`);
      }

      continue;
    }

    console.log(`\n🔧 Updating ${target.label} to the configured Chainlink-backed simple path...`);
    console.log(`   Asset: ${target.asset}`);
    console.log(`   Feed: ${currentFeedAddress !== ZeroAddress ? currentFeedAddress : "NOT SET"} → ${expectedConfig.feed}`);
    console.log(`   Threshold: lower=${expectedConfig.lowerThreshold}, fixed=${expectedConfig.fixedPrice}`);

    const diagnostics = await buildCompositePriceDiagnostics(
      ethers,
      expectedConfig.feed,
      expectedConfig.feed,
      baseCurrencyUnit,
      deployerSigner,
    );
    console.log(
      `   ℹ️ Feed answer=${diagnostics.chainlinkAnswer1} (decimals=${diagnostics.feed1Decimals}, updatedAt=${diagnostics.updatedAt1})`,
    );
    console.log(`   ℹ️ Candidate simple price=${diagnostics.priceInBase1}`);

    if (feedNeedsUpdate) {
      const feedComplete = await executor.tryOrQueue(
        async () => {
          const tx = await wrapper.setFeed(target.asset, expectedConfig.feed);
          await tx.wait();
          console.log(`   ✅ Updated ${target.label} feed to the configured Chainlink-backed path.`);
        },
        () => createSetFeedTransaction(wrapperAddress, target.asset, expectedConfig.feed, wrapper.interface),
      );

      if (!feedComplete) {
        hasPendingGovernance = true;
        console.log(`   📝 Queued Safe transaction to configure ${target.label} feed.`);
      }
    }

    if (feedNeedsUpdate || thresholdNeedsUpdate) {
      const thresholdComplete = await executor.tryOrQueue(
        async () => {
          const tx = await wrapper.setThresholdConfig(target.asset, expectedConfig.lowerThreshold, expectedConfig.fixedPrice);
          await tx.wait();
          console.log(`   ✅ Updated ${target.label} threshold config.`);
        },
        () =>
          createSetThresholdConfigTransaction(
            wrapperAddress,
            target.asset,
            expectedConfig.lowerThreshold,
            expectedConfig.fixedPrice,
            wrapper.interface,
          ),
      );

      if (!thresholdComplete) {
        hasPendingGovernance = true;
        console.log(`   📝 Queued Safe transaction to configure ${target.label} threshold.`);
        console.log(`   ℹ️ Wrapper price for ${target.label} will be available once governance executes the batch.`);
        continue;
      }
    }

    try {
      const price = await wrapper.getAssetPrice(target.asset);
      console.log(`   💵 Updated wrapper price for ${target.label}: ${price}`);
    } catch (error) {
      throw new Error(`Failed to read wrapper price for ${target.label} after updating its simple path. ${error}`);
    }
  }

  for (const target of targets) {
    const expectedConfig = compositeFeeds[target.asset];

    if (!expectedConfig) {
      throw new Error(`Missing Chainlink-backed USD composite configuration for ${target.label} (${target.asset}).`);
    }

    const currentComposite = await wrapper.compositeFeeds(target.asset);
    const needsUpdate =
      currentComposite.feed1.toLowerCase() !== expectedConfig.feed1.toLowerCase() ||
      currentComposite.feed2.toLowerCase() !== expectedConfig.feed2.toLowerCase() ||
      BigInt(currentComposite.primaryThreshold.lowerThresholdInBase) !== expectedConfig.lowerThresholdInBase1 ||
      BigInt(currentComposite.primaryThreshold.fixedPriceInBase) !== expectedConfig.fixedPriceInBase1 ||
      BigInt(currentComposite.secondaryThreshold.lowerThresholdInBase) !== expectedConfig.lowerThresholdInBase2 ||
      BigInt(currentComposite.secondaryThreshold.fixedPriceInBase) !== expectedConfig.fixedPriceInBase2;

    if (!needsUpdate && currentComposite.feed1 !== ZeroAddress) {
      console.log(`\n✅ ${target.label} composite feed already matches the configured Chainlink-backed path.`);
      console.log(`   Asset: ${target.asset}`);
      console.log(`   Feed1: ${currentComposite.feed1}`);
      console.log(`   Feed2: ${currentComposite.feed2}`);
      console.log(
        `   Thresholds: leg1(lower=${currentComposite.primaryThreshold.lowerThresholdInBase}, fixed=${currentComposite.primaryThreshold.fixedPriceInBase}), leg2(lower=${currentComposite.secondaryThreshold.lowerThresholdInBase}, fixed=${currentComposite.secondaryThreshold.fixedPriceInBase})`,
      );

      try {
        const price = await wrapper.getAssetPrice(target.asset);
        console.log(`   💵 Wrapper price: ${price}`);
      } catch (error) {
        console.warn(`   ⚠️ Could not read wrapper price for ${target.label}: ${error}`);
      }

      continue;
    }

    console.log(`\n🔧 Updating ${target.label} to the configured Chainlink-backed composite path...`);
    console.log(`   Asset: ${target.asset}`);
    console.log(`   Feed1: ${currentComposite.feed1 !== ZeroAddress ? currentComposite.feed1 : "NOT SET"} → ${expectedConfig.feed1}`);
    console.log(`   Feed2: ${currentComposite.feed2 !== ZeroAddress ? currentComposite.feed2 : "NOT SET"} → ${expectedConfig.feed2}`);
    console.log(
      `   Thresholds: leg1(lower=${expectedConfig.lowerThresholdInBase1}, fixed=${expectedConfig.fixedPriceInBase1}), leg2(lower=${expectedConfig.lowerThresholdInBase2}, fixed=${expectedConfig.fixedPriceInBase2})`,
    );

    const diagnostics = await buildCompositePriceDiagnostics(
      ethers,
      expectedConfig.feed1,
      expectedConfig.feed2,
      baseCurrencyUnit,
      deployerSigner,
    );

    console.log(
      `   ℹ️ Feed1 answer=${diagnostics.chainlinkAnswer1} (decimals=${diagnostics.feed1Decimals}, updatedAt=${diagnostics.updatedAt1})`,
    );
    console.log(
      `   ℹ️ Feed2 answer=${diagnostics.chainlinkAnswer2} (decimals=${diagnostics.feed2Decimals}, updatedAt=${diagnostics.updatedAt2})`,
    );
    console.log(
      `   ℹ️ Candidate composite price=${diagnostics.candidatePrice}, leg1=${diagnostics.priceInBase1}, leg2=${diagnostics.priceInBase2}`,
    );

    const removalRequired = currentComposite.feed1 !== ZeroAddress;

    if (removalRequired) {
      const removeComplete = await executor.tryOrQueue(
        async () => {
          const tx = await wrapper.removeCompositeFeed(target.asset);
          await tx.wait();
          console.log(`   ✅ Removed existing composite feed for ${target.label}`);
        },
        () => createRemoveCompositeFeedTransaction(wrapperAddress, target.asset, wrapper.interface),
      );

      if (!removeComplete) {
        hasPendingGovernance = true;
        console.log(`   📝 Queued Safe transaction to remove the existing composite feed for ${target.label}.`);
      }
    }

    const updateComplete = await executor.tryOrQueue(
      async () => {
        const tx = await wrapper.addCompositeFeed(
          expectedConfig.feedAsset,
          expectedConfig.feed1,
          expectedConfig.feed2,
          expectedConfig.lowerThresholdInBase1,
          expectedConfig.fixedPriceInBase1,
          expectedConfig.lowerThresholdInBase2,
          expectedConfig.fixedPriceInBase2,
        );
        await tx.wait();
        console.log(`   ✅ Updated ${target.label} composite feed to the configured Chainlink-backed path.`);
      },
      () =>
        createAddCompositeFeedTransaction(
          wrapperAddress,
          expectedConfig.feedAsset,
          expectedConfig.feed1,
          expectedConfig.feed2,
          expectedConfig.lowerThresholdInBase1,
          expectedConfig.fixedPriceInBase1,
          expectedConfig.lowerThresholdInBase2,
          expectedConfig.fixedPriceInBase2,
          wrapper.interface,
        ),
    );

    if (!updateComplete) {
      hasPendingGovernance = true;
      console.log(`   📝 Queued Safe transaction to configure ${target.label}.`);
      console.log(`   ℹ️ Wrapper price for ${target.label} will be available once governance executes the batch.`);
      continue;
    }

    try {
      const price = await wrapper.getAssetPrice(target.asset);
      console.log(`   💵 Updated wrapper price for ${target.label}: ${price}`);
    } catch (error) {
      throw new Error(`Failed to read wrapper price for ${target.label} after updating its composite path. ${error}`);
    }
  }

  console.log("\n🔐 Migrating Chainlink wrapper roles to governance...");
  const rolesComplete = await migrateWrapperRoles(hre, wrapperAddress, deployerSigner, config.walletAddresses.governanceMultisig, executor);
  if (!rolesComplete) {
    hasPendingGovernance = true;
  }

  if (hasPendingGovernance) {
    const flushed = await executor.flush("Configure Chainlink-backed USD composite wrapper feeds");

    if (executor.useSafe) {
      if (!flushed) {
        throw new Error("Failed to prepare Safe batch for Chainlink-backed USD composite wrapper feed updates.");
      }

      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   Re-run this script after governance executes the queued transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }

    console.log("\n❌ Non-Safe mode: direct execution failed and no Safe batch was prepared.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: incomplete ❌`);
    return false;
  }

  console.log("\n✅ All USD composite wrapper feed operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeUpdate(hre);
};

func.id = "update-usd-composite-wrapper-feeds";
func.tags = ["oracle", "usd-oracle", "chainlink", "wrapper-migration", "usd-composite-feeds"];
func.dependencies = [];

export default func;
