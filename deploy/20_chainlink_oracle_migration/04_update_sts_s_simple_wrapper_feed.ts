import { Signer, ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { S_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID, S_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
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

type PriceDiagnostics = {
  price: bigint;
  answer: bigint;
  feedDecimals: number;
  updatedAt: bigint;
};

/**
 * Read a live Chainlink-backed feed to confirm the S-base `stS / S` leg remains sane.
 *
 * @param ethers - Hardhat ethers helper.
 * @param feed - Chainlink-backed feed address.
 * @param baseCurrencyUnit - Base currency precision for the wrapper.
 * @param signer - Signer used for read-only calls.
 * @returns Price diagnostics for the proposed feed.
 */
async function buildPriceDiagnostics(
  ethers: HardhatRuntimeEnvironment["ethers"],
  feed: string,
  baseCurrencyUnit: bigint,
  signer: Signer,
): Promise<PriceDiagnostics> {
  const priceFeed = new ethers.Contract(feed, PRICE_FEED_ABI, signer);

  const feedDecimalsRaw = await priceFeed.decimals();
  const feedDecimals = typeof feedDecimalsRaw === "number" ? feedDecimalsRaw : Number(feedDecimalsRaw);

  if (feedDecimals === 0) {
    throw new Error(`Feed ${feed} reports 0 decimals`);
  }

  const feedUnit = 10n ** BigInt(feedDecimals);

  const roundData = await priceFeed.latestRoundData();
  const answer = BigInt(roundData.answer ?? roundData[1]);
  const updatedAt = BigInt(roundData.updatedAt ?? roundData[3]);

  if (answer <= 0n) {
    throw new Error(`Feed ${feed} returned non-positive answer ${answer}`);
  }

  return {
    price: (answer * baseCurrencyUnit) / feedUnit,
    answer,
    feedDecimals,
    updatedAt,
  };
}

/**
 * Build a Safe transaction payload to set a simple wrapper feed.
 *
 * @param wrapperAddress - Wrapper contract address.
 * @param asset - Asset address to configure.
 * @param feed - Expected Chainlink-backed feed.
 * @param wrapperInterface - Contract interface used to encode the call.
 * @returns Encoded governance transaction data.
 */
function createSetFeedTransaction(wrapperAddress: string, asset: string, feed: string, wrapperInterface: any): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setFeed", [asset, feed]),
  };
}

/**
 * Build a Safe transaction payload to update an OracleAggregator route.
 *
 * @param aggregatorAddress - OracleAggregator contract address.
 * @param asset - Asset address to configure.
 * @param oracle - New oracle address for the asset.
 * @param aggregatorInterface - Contract interface used to encode the call.
 */
function createSetOracleTransaction(
  aggregatorAddress: string,
  asset: string,
  oracle: string,
  aggregatorInterface: any,
): SafeTransactionData {
  return {
    to: aggregatorAddress,
    value: "0",
    data: aggregatorInterface.encodeFunctionData("setOracle", [asset, oracle]),
  };
}

/**
 * Build a Safe transaction payload for granting a role.
 *
 * @param contractAddress - Contract address that owns the role.
 * @param role - Role identifier to grant.
 * @param grantee - Account that should receive the role.
 * @param contractInterface - Contract interface used to encode the call.
 */
function createGrantRoleTransaction(contractAddress: string, role: string, grantee: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [role, grantee]),
  };
}

/**
 * Build a Safe transaction payload for revoking a role.
 *
 * @param contractAddress - Contract address that owns the role.
 * @param role - Role identifier to revoke.
 * @param account - Account that should lose the role.
 * @param contractInterface - Contract interface used to encode the call.
 */
function createRevokeRoleTransaction(contractAddress: string, role: string, account: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("revokeRole", [role, account]),
  };
}

/**
 * Check whether an equivalent Safe transaction is already queued.
 *
 * @param executor - Governance executor tracking queued transactions.
 * @param transaction - Transaction payload to search for.
 */
function hasQueuedTransaction(executor: GovernanceExecutor, transaction: SafeTransactionData): boolean {
  return executor.queuedTransactions.some(
    (queued) => queued.to === transaction.to && queued.value === transaction.value && queued.data === transaction.data,
  );
}

/**
 * Ensure governance can manage a contract before queueing dependent operations.
 *
 * @param contract - Contract instance that exposes ORACLE_MANAGER_ROLE.
 * @param contractAddress - Contract address.
 * @param governanceMultisig - Governance multisig that should hold the role.
 * @param executor - Governance executor used for direct calls or Safe queueing.
 * @param label - Human-readable label used in logs.
 */
async function ensureGovernanceCanManageContract(
  contract: any,
  contractAddress: string,
  governanceMultisig: string,
  executor: GovernanceExecutor,
  label: string,
): Promise<boolean> {
  if (!executor.useSafe) {
    return true;
  }

  const oracleManagerRole = await contract.ORACLE_MANAGER_ROLE();

  if (await contract.hasRole(oracleManagerRole, governanceMultisig)) {
    console.log(`   ✓ Governance already has ORACLE_MANAGER_ROLE on ${label}`);
    return true;
  }

  const grantRoleTx = createGrantRoleTransaction(contractAddress, oracleManagerRole, governanceMultisig, contract.interface);

  if (hasQueuedTransaction(executor, grantRoleTx)) {
    console.log(`   📝 ORACLE_MANAGER_ROLE grant already queued for governance on ${label}`);
    return false;
  }

  return executor.tryOrQueue(
    async () => {
      const tx = await contract.grantRole(oracleManagerRole, governanceMultisig);
      await tx.wait();
      console.log(`   ➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig} on ${label}`);
    },
    () => grantRoleTx,
  );
}

/**
 * Migrate wrapper roles from the deployer to governance.
 *
 * @param hre - Hardhat runtime environment.
 * @param wrapperAddress - Wrapper contract address.
 * @param deployerSigner - Signer currently holding the roles.
 * @param governanceMultisig - Governance multisig that should receive the roles.
 * @param executor - Governance executor used for direct calls or Safe queueing.
 */
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
 * Update or confirm the S-base `stS / S` simple wrapper feed used alongside the USD migration.
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

  const stSAddress = config.tokenAddresses.stS;

  if (!stSAddress) {
    console.log("\n⚠️ stS address not configured for this network; skipping S-base wrapper migration.");
    return true;
  }

  const sConfig = config.oracleAggregators.S;
  const baseCurrencyUnit = 10n ** BigInt(sConfig.priceDecimals);
  const plainFeeds = sConfig.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};
  const expectedFeed = plainFeeds[stSAddress];

  if (!expectedFeed) {
    throw new Error(`Missing Chainlink-backed stS/S feed configuration for stS (${stSAddress}).`);
  }

  const wrapperDeployment = await deployments.deploy(S_CHAINLINK_WRAPPER_WITH_THRESHOLDING_ID, {
    from: deployer,
    contract: CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT,
    args: [sConfig.baseCurrency, baseCurrencyUnit],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });
  const wrapperAddress = wrapperDeployment.address;
  const wrapper = await ethers.getContractAt(CHAINLINK_WRAPPER_WITH_THRESHOLDING_ARTIFACT, wrapperAddress, deployerSigner);
  const oracleAggregatorDeployment = await deployments.get(S_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  console.log(`🔐 Governance multisig: ${config.walletAddresses.governanceMultisig}`);
  console.log(`✅ Using S-base Chainlink wrapper at: ${wrapperAddress}`);
  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  const currentFeedConfig = await wrapper.assetToFeed(stSAddress);
  const currentFeed = currentFeedConfig.feed;
  const needsUpdate = currentFeed.toLowerCase() !== expectedFeed.toLowerCase();
  const currentOracleAddress = await oracleAggregator.assetOracles(stSAddress);
  const needsOracleFlip = currentOracleAddress.toLowerCase() !== wrapperAddress.toLowerCase();

  let hasPendingGovernance = false;

  const wrapperGovernanceReady = await ensureGovernanceCanManageContract(
    wrapper,
    wrapperAddress,
    config.walletAddresses.governanceMultisig,
    executor,
    "S-base Chainlink wrapper",
  );

  if (!wrapperGovernanceReady) {
    hasPendingGovernance = true;
  }

  if (needsOracleFlip) {
    const aggregatorGovernanceReady = await ensureGovernanceCanManageContract(
      oracleAggregator,
      oracleAggregatorDeployment.address,
      config.walletAddresses.governanceMultisig,
      executor,
      "S_OracleAggregator",
    );

    if (!aggregatorGovernanceReady) {
      hasPendingGovernance = true;
    }
  }

  if (!needsUpdate && !needsOracleFlip && currentFeed !== ZeroAddress) {
    console.log("\n✅ stS already points at the expected Chainlink-backed stS/S feed in the S-base Chainlink wrapper.");
    console.log(`   Asset: ${stSAddress}`);
    console.log(`   Feed: ${currentFeed}`);

    try {
      const price = await wrapper.getAssetPrice(stSAddress);
      console.log(`   💵 Wrapper price: ${price}`);
    } catch (error) {
      console.warn(`   ⚠️ Could not read wrapper price for stS: ${error}`);
    }
  } else if (needsUpdate) {
    console.log("\n🔧 Updating stS to the configured Chainlink-backed stS/S feed in the S-base Chainlink wrapper...");
    console.log(`   Asset: ${stSAddress}`);
    console.log(`   Feed: ${currentFeed !== ZeroAddress ? currentFeed : "NOT SET"} → ${expectedFeed}`);

    const diagnostics = await buildPriceDiagnostics(ethers, expectedFeed, baseCurrencyUnit, deployerSigner);
    console.log(`   ℹ️ Chainlink answer=${diagnostics.answer} (decimals=${diagnostics.feedDecimals}, updatedAt=${diagnostics.updatedAt})`);
    console.log(`   ℹ️ Candidate wrapper price=${diagnostics.price}`);

    const updateComplete = await executor.tryOrQueue(
      async () => {
        const tx = await wrapper.setFeed(stSAddress, expectedFeed);
        await tx.wait();
        console.log("   ✅ Updated stS to the configured Chainlink-backed stS/S feed.");
      },
      () => createSetFeedTransaction(wrapperAddress, stSAddress, expectedFeed, wrapper.interface),
    );

    if (!updateComplete) {
      hasPendingGovernance = true;
    }
  } else {
    console.log("\n✅ stS feed is already configured in the S-base Chainlink wrapper.");
    console.log(`   Asset: ${stSAddress}`);
    console.log(`   Feed: ${currentFeed}`);
  }

  if (needsOracleFlip) {
    console.log(`   🎯 Queueing S_OracleAggregator.setOracle for stS -> ${wrapperAddress}`);
    const flipComplete = await executor.tryOrQueue(
      async () => {
        const tx = await oracleAggregator.setOracle(stSAddress, wrapperAddress);
        await tx.wait();
        console.log("   ✅ S_OracleAggregator now points stS to the Chainlink wrapper.");
      },
      () => createSetOracleTransaction(oracleAggregatorDeployment.address, stSAddress, wrapperAddress, oracleAggregator.interface),
    );

    if (!flipComplete) {
      hasPendingGovernance = true;
    }
  }

  console.log("\n🔐 Migrating S-base Chainlink wrapper roles to governance...");
  const rolesComplete = await migrateWrapperRoles(hre, wrapperAddress, deployerSigner, config.walletAddresses.governanceMultisig, executor);

  if (!rolesComplete) {
    hasPendingGovernance = true;
  }

  if (hasPendingGovernance) {
    const flushed = await executor.flush("Configure Chainlink-backed stS/S simple wrapper feed");

    if (executor.useSafe) {
      if (!flushed) {
        throw new Error("Failed to prepare Safe batch for the Chainlink-backed stS/S simple wrapper feed update.");
      }

      console.log("\n⏳ This operation requires governance signatures to complete.");
      console.log("   Re-run this script after governance executes the queued transaction.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }

    console.log("\n❌ Non-Safe mode: direct execution failed and no Safe batch was prepared.");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: incomplete ❌`);
    return false;
  }

  try {
    const price = await wrapper.getAssetPrice(stSAddress);
    console.log(`   💵 Updated wrapper price for stS: ${price}`);
  } catch (error) {
    throw new Error(`Failed to read wrapper price for stS after updating its Chainlink-backed stS/S feed. ${error}`);
  }

  console.log("\n✅ The S-base stS/S wrapper feed is configured correctly.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeUpdate(hre);
};

func.id = "update-sts-s-simple-wrapper-feed";
func.tags = ["oracle", "s-oracle", "chainlink", "wrapper-migration", "sts-s-simple-feed"];
func.dependencies = [S_ORACLE_AGGREGATOR_ID];

export default func;
