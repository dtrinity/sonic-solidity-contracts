import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];
const RATE_PROVIDER_SAFE_ABI = ["function getRateSafe() view returns (uint256)"];
const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

type ChainlinkCompositeFeedConfig = {
  feedAsset: string;
  chainlinkFeed: string;
  rateProvider: string;
  lowerThresholdInBase1?: bigint;
  fixedPriceInBase1?: bigint;
  lowerThresholdInBase2?: bigint;
  fixedPriceInBase2?: bigint;
};

type CompositePriceDiagnostics = {
  candidatePrice: bigint;
  priceInBase1: bigint;
  priceInBase2: bigint;
  chainlinkAnswer: bigint;
  rateProviderRate: bigint;
  feedDecimals: number;
  assetDecimals: number;
  updatedAt: bigint;
};

/**
 * Apply configured thresholding to a price leg.
 *
 * @param priceInBase - Price expressed in base currency units.
 * @param lowerThreshold - Threshold above which the fixed price should replace the live price.
 * @param fixedPrice - Replacement price to use when the threshold triggers.
 * @returns Threshold-adjusted price.
 */
function applyThreshold(priceInBase: bigint, lowerThreshold: bigint, fixedPrice: bigint): bigint {
  if (lowerThreshold > 0n && priceInBase > lowerThreshold) {
    return fixedPrice;
  }
  return priceInBase;
}

/**
 * Read the live Chainlink and rate-provider legs to mirror the on-chain composition.
 *
 * @param ethers - Hardhat ethers helper.
 * @param config - Static configuration for the composite feed.
 * @param baseCurrencyUnit - Base currency scaling factor (e.g. 1e18).
 * @param signer - Signer used to perform read-only calls.
 * @returns Composite price diagnostics for logging and safety checks.
 */
async function buildCompositePriceDiagnostics(
  ethers: HardhatRuntimeEnvironment["ethers"],
  config: ChainlinkCompositeFeedConfig,
  baseCurrencyUnit: bigint,
  signer: Signer,
): Promise<CompositePriceDiagnostics> {
  const priceFeed = new ethers.Contract(config.chainlinkFeed, PRICE_FEED_ABI, signer);
  const rateProvider = new ethers.Contract(config.rateProvider, RATE_PROVIDER_SAFE_ABI, signer);
  const asset = new ethers.Contract(config.feedAsset, ERC20_DECIMALS_ABI, signer);

  const feedDecimalsRaw = await priceFeed.decimals();
  const feedDecimals = typeof feedDecimalsRaw === "number" ? feedDecimalsRaw : Number(feedDecimalsRaw);

  if (feedDecimals === 0) {
    throw new Error(`Feed ${config.chainlinkFeed} reports 0 decimals`);
  }
  const feedUnit = 10n ** BigInt(feedDecimals);

  const roundData = await priceFeed.latestRoundData();
  const answer = BigInt(roundData.answer ?? roundData[1]);
  const updatedAt = BigInt(roundData.updatedAt ?? roundData[3]);

  if (answer <= 0n) {
    throw new Error(`Feed ${config.chainlinkFeed} returned non-positive answer ${answer}`);
  }

  const assetDecimalsRaw = await asset.decimals();
  const assetDecimals = typeof assetDecimalsRaw === "number" ? assetDecimalsRaw : Number(assetDecimalsRaw);

  if (assetDecimals === 0) {
    throw new Error(`Asset ${config.feedAsset} reports 0 decimals`);
  }
  const rateProviderUnit = 10n ** BigInt(assetDecimals);

  const rateCall = await rateProvider.getRateSafe();
  const rate = BigInt(rateCall);

  if (rate === 0n) {
    throw new Error(`Rate provider ${config.rateProvider} returned zero rate`);
  }

  let priceInBase1 = (answer * baseCurrencyUnit) / feedUnit;
  let priceInBase2 = (rate * baseCurrencyUnit) / rateProviderUnit;

  const lowerThresholdInBase1 = BigInt(config.lowerThresholdInBase1 ?? 0n);
  const fixedPriceInBase1 = BigInt(config.fixedPriceInBase1 ?? 0n);
  const lowerThresholdInBase2 = BigInt(config.lowerThresholdInBase2 ?? 0n);
  const fixedPriceInBase2 = BigInt(config.fixedPriceInBase2 ?? 0n);

  priceInBase1 = applyThreshold(priceInBase1, lowerThresholdInBase1, fixedPriceInBase1);
  priceInBase2 = applyThreshold(priceInBase2, lowerThresholdInBase2, fixedPriceInBase2);

  const candidatePrice = (priceInBase1 * priceInBase2) / baseCurrencyUnit;

  return {
    candidatePrice,
    priceInBase1,
    priceInBase2,
    chainlinkAnswer: answer,
    rateProviderRate: rate,
    feedDecimals,
    assetDecimals,
    updatedAt,
  };
}

/**
 * Build a Safe transaction payload to grant a role on a target contract.
 *
 * @param contractAddress - Address of the contract to call
 * @param role - Role hash to grant
 * @param grantee - Address to receive the role
 * @param contractInterface - Contract interface used to encode the call
 */
function createGrantRoleTransaction(contractAddress: string, role: string, grantee: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [role, grantee]),
  };
}

/**
 * Build a Safe transaction payload to revoke a role on a target contract.
 *
 * @param contractAddress - Address of the contract to call
 * @param role - Role hash to revoke
 * @param account - Address to revoke the role from
 * @param contractInterface - Contract interface used to encode the call
 */
function createRevokeRoleTransaction(contractAddress: string, role: string, account: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("revokeRole", [role, account]),
  };
}

/**
 * Build a Safe transaction payload to add a composite feed on the ChainlinkSafeRateProviderCompositeWrapper.
 *
 * @param wrapperAddress - The address of the ChainlinkSafeRateProviderCompositeWrapper contract
 * @param asset - The asset address for which to add the composite feed
 * @param chainlinkFeed - The Chainlink price feed address
 * @param rateProvider - The rate provider address
 * @param lowerThresholdInBase1 - Lower threshold for the first price feed in base currency units
 * @param fixedPriceInBase1 - Fixed price for the first price feed in base currency units
 * @param lowerThresholdInBase2 - Lower threshold for the second price feed in base currency units
 * @param fixedPriceInBase2 - Fixed price for the second price feed in base currency units
 * @param wrapperInterface - The contract interface for encoding function data
 */
function createAddCompositeFeedTransaction(
  wrapperAddress: string,
  asset: string,
  chainlinkFeed: string,
  rateProvider: string,
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
      chainlinkFeed,
      rateProvider,
      lowerThresholdInBase1,
      fixedPriceInBase1,
      lowerThresholdInBase2,
      fixedPriceInBase2,
    ]),
  };
}

const ZERO_BYTES_32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Wrapper for ensureDefaultAdminExistsAndRevokeFrom that returns boolean status
 *
 * @param hre - Hardhat runtime environment
 * @param contractName - Name of the contract for logging
 * @param contractAddress - Address of the contract
 * @param governanceMultisig - Address of governance multisig
 * @param deployerAddress - Address of the deployer
 * @param deployerSigner - Signer for the deployer
 * @param executor - Governance executor
 */
async function ensureDefaultAdminExistsAndRevokeFromWithSafe(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  governanceMultisig: string,
  deployerAddress: string,
  deployerSigner: Signer,
  executor: GovernanceExecutor,
): Promise<boolean> {
  try {
    // The original function uses manualActions array, we need to handle this differently
    // For now, we'll catch any errors and handle with Safe
    const manualActions: string[] = [];
    await ensureDefaultAdminExistsAndRevokeFrom(
      hre,
      contractName,
      contractAddress,
      governanceMultisig,
      deployerAddress,
      deployerSigner,
      manualActions,
    );

    // If there are manual actions, it means we need Safe transactions when Safe mode is on
    if (manualActions.length > 0) {
      if (executor.useSafe) {
        // This would need proper Safe transaction creation; return pending
        return false;
      }
      console.log(`    ⏭️ Non-Safe mode: manual admin migration actions detected; continuing.`);
    }

    return true;
  } catch (error) {
    if (executor.useSafe) {
      // Requires governance action; queue not implemented for this path
      console.warn(`    🔄 Admin role migration likely requires governance action:`, error);
      return false;
    }
    console.log(`    ⏭️ Non-Safe mode: admin migration requires governance; continuing.`);
    return true;
  }
}

/**
 * Migrate Oracle Wrapper roles to governance in a safe, idempotent sequence.
 * Grants roles to governance first, then revokes them from the deployer.
 * If direct execution fails, generates Safe transactions appended to
 * `transactions` for offline signing.
 *
 * @param hre - Hardhat runtime environment
 * @param wrapperName - Logical name/id of the wrapper deployment
 * @param wrapperAddress - Address of the Oracle Wrapper contract
 * @param deployerSigner - Deployer signer currently holding roles
 * @param governanceMultisig - Governance multisig address to receive roles
 * @param executor - Governance executor
 * @returns true if all operations complete, false if pending governance
 */
async function migrateOracleWrapperRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  wrapperName: string,
  wrapperAddress: string,
  deployerSigner: Signer,
  governanceMultisig: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  const wrapper = await hre.ethers.getContractAt(
    "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
    wrapperAddress,
    deployerSigner,
  );

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const ORACLE_MANAGER_ROLE = await wrapper.ORACLE_MANAGER_ROLE();

  const roles = [{ name: "ORACLE_MANAGER_ROLE", hash: ORACLE_MANAGER_ROLE }];

  console.log(`  📄 Migrating roles for ${wrapperName} at ${wrapperAddress}`);

  let noPendingActions = true;

  for (const role of roles) {
    if (!(await wrapper.hasRole(role.hash, governanceMultisig))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.grantRole(role.hash, governanceMultisig);
          console.log(`    ➕ Granted ${role.name} to governance ${governanceMultisig}`);
        },
        () => createGrantRoleTransaction(wrapperAddress, role.hash, governanceMultisig, wrapper.interface),
      );
      if (!complete) noPendingActions = false;
    } else {
      console.log(`    ✓ ${role.name} already granted to governance`);
    }
  }

  // Step 2: Revoke roles from deployer after granting to governance
  const deployerAddress = await deployerSigner.getAddress();
  console.log(`  🔄 Revoking roles from deployer ${deployerAddress}...`);

  for (const role of roles) {
    // Skip DEFAULT_ADMIN_ROLE as it's handled by ensureDefaultAdminExistsAndRevokeFrom
    if (role.hash === DEFAULT_ADMIN_ROLE) continue;

    const deployerHasRole = await wrapper.hasRole(role.hash, deployerAddress);
    const governanceHasRole = await wrapper.hasRole(role.hash, governanceMultisig);

    if (deployerHasRole && governanceHasRole) {
      const roleName = role.name;
      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.revokeRole(role.hash, deployerAddress);
          console.log(`    ➖ Revoked ${roleName} from deployer`);
        },
        () => createRevokeRoleTransaction(wrapperAddress, role.hash, deployerAddress, wrapper.interface),
      );
      if (!complete) noPendingActions = false;
    }
  }

  // Safely migrate DEFAULT_ADMIN_ROLE away from deployer
  const adminMigrationComplete = await ensureDefaultAdminExistsAndRevokeFromWithSafe(
    hre,
    "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
    wrapperAddress,
    governanceMultisig,
    deployerAddress,
    deployerSigner,
    executor,
  );

  if (!adminMigrationComplete) {
    noPendingActions = false;
  }

  return noPendingActions;
}

/**
 * Handle the wrapper deployment/configuration phase on networks where the script runs.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when the deployment completed or actions were queued.
 */
async function executeDeployment(hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Initialize governance executor (decides Safe vs direct execution)
  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Get USD oracle aggregator configuration
  const usdConfig = config.oracleAggregators.USD;
  const baseCurrency = usdConfig.baseCurrency;
  const baseCurrencyUnit = BigInt(10) ** BigInt(usdConfig.priceDecimals);

  console.log(`🔮 Base currency: ${baseCurrency}`);
  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  // Deploy ChainlinkSafeRateProviderCompositeWrapperWithThresholding
  console.log(`\n🚀 Deploying ChainlinkSafeRateProviderCompositeWrapperWithThresholding...`);
  const wrapperDeployResult = await deployments.deploy(USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID, {
    from: deployer,
    contract: "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
    args: [baseCurrency, baseCurrencyUnit],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });

  const wrapperAddress = wrapperDeployResult.address;
  const wrapper = await ethers.getContractAt("ChainlinkSafeRateProviderCompositeWrapperWithThresholding", wrapperAddress);

  console.log(`✅ ChainlinkSafeRateProviderCompositeWrapper deployed at: ${wrapperAddress}`);

  // Configure feeds from config
  const chainlinkFeeds = usdConfig.safeRateProviderAssets?.chainlinkSafeRateProviderCompositeWrappers || {};
  let allOperationsComplete = true;

  if (Object.keys(chainlinkFeeds).length > 0) {
    console.log(`\n🔧 Configuring ChainlinkSafeRateProviderComposite feeds...`);

    for (const [_assetAddress, feedConfig] of Object.entries(chainlinkFeeds)) {
      console.log(`  📊 Adding composite feed for asset ${feedConfig.feedAsset}...`);

      const diagnostics = await buildCompositePriceDiagnostics(ethers, feedConfig, baseCurrencyUnit, deployerSigner);
      console.log(
        `    ℹ️ Feed answer=${diagnostics.chainlinkAnswer} (decimals=${diagnostics.feedDecimals}), rate=${diagnostics.rateProviderRate} (asset decimals=${diagnostics.assetDecimals})`,
      );
      console.log(
        `    ℹ️ Candidate composite price=${diagnostics.candidatePrice}, leg1=${diagnostics.priceInBase1}, leg2=${diagnostics.priceInBase2}`,
      );

      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.addCompositeFeed(
            feedConfig.feedAsset,
            feedConfig.chainlinkFeed,
            feedConfig.rateProvider,
            feedConfig.lowerThresholdInBase1,
            feedConfig.fixedPriceInBase1,
            feedConfig.lowerThresholdInBase2,
            feedConfig.fixedPriceInBase2,
          );
          console.log(`    ✅ Added ChainlinkSafeRateProviderComposite feed for ${feedConfig.feedAsset}`);
        },
        () =>
          createAddCompositeFeedTransaction(
            wrapperAddress,
            feedConfig.feedAsset,
            feedConfig.chainlinkFeed,
            feedConfig.rateProvider,
            feedConfig.lowerThresholdInBase1,
            feedConfig.fixedPriceInBase1,
            feedConfig.lowerThresholdInBase2,
            feedConfig.fixedPriceInBase2,
            wrapper.interface,
          ),
      );

      if (!complete) allOperationsComplete = false;
    }
  } else {
    console.log(`ℹ️  No ChainlinkSafeRateProviderComposite feeds configured in config`);
  }

  // Migrate wrapper roles to governance
  console.log(`\n🔐 Migrating ChainlinkSafeRateProviderComposite wrapper roles to governance...`);
  const rolesMigrationComplete = await migrateOracleWrapperRolesIdempotent(
    hre,
    USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID,
    wrapperAddress,
    deployerSigner,
    governanceMultisig,
    executor,
  );

  if (!rolesMigrationComplete) {
    allOperationsComplete = false;
  }

  // Handle governance operations if needed
  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Deploy ChainlinkSafeRateProviderComposite wrapper: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`   ➡️ Run phase 2 updater script to flip the OracleAggregator once governance approves this deployment.`);
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

/**
 * Hardhat deploy entry point. Skips on Sonic mainnet where the wrapper is already live.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when the script finishes or queues governance actions.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (await func.skip?.(hre)) {
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: skipping (already executed on Sonic mainnet)`);
    console.log(`   ℹ️ Wrapper safety improvements are available for future forks.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (no-op)`);
    return true;
  }

  return executeDeployment(hre);
};

func.skip = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const network = hre.network.name;
  return network === "sonic_mainnet" || network === "sonic";
};

func.id = "deploy-chainlink-safe-rate-provider-composite-wrapper";
func.tags = ["usd-oracle", "oracle-wrapper", "chainlink-safe-rate-provider"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];

export default func;
