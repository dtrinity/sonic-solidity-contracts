import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { SafeTransactionData } from "../../.shared/lib/roles/types";
import { getConfig } from "../../config/config";
import { USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_WITH_USD_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];
const RATE_PROVIDER_SAFE_ABI = ["function getRateSafe() view returns (uint256)"];
const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

type ChainlinkCompositeFeedWithUSDConfig = {
  feedAsset: string;
  chainlinkFeed1: string;
  rateProvider: string;
  chainlinkFeed3: string;
  lowerThresholdInBase1?: bigint;
  fixedPriceInBase1?: bigint;
  lowerThresholdInBase2?: bigint;
  fixedPriceInBase2?: bigint;
  lowerThresholdInBase3?: bigint;
  fixedPriceInBase3?: bigint;
};

type CompositePriceDiagnostics = {
  candidatePrice: bigint;
  priceInBase1: bigint;
  priceInBase2: bigint;
  priceInBase3: bigint;
  chainlinkAnswer1: bigint;
  chainlinkAnswer3: bigint;
  rateProviderRate: bigint;
  feed1Decimals: number;
  feed3Decimals: number;
  assetDecimals: number;
  updatedAt1: bigint;
  updatedAt3: bigint;
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
  config: ChainlinkCompositeFeedWithUSDConfig,
  baseCurrencyUnit: bigint,
  signer: Signer,
): Promise<CompositePriceDiagnostics> {
  const priceFeed1 = new ethers.Contract(config.chainlinkFeed1, PRICE_FEED_ABI, signer);
  const priceFeed3 = new ethers.Contract(config.chainlinkFeed3, PRICE_FEED_ABI, signer);
  const rateProvider = new ethers.Contract(config.rateProvider, RATE_PROVIDER_SAFE_ABI, signer);
  const asset = new ethers.Contract(config.feedAsset, ERC20_DECIMALS_ABI, signer);

  const feed1DecimalsRaw = await priceFeed1.decimals();
  const feed1Decimals = typeof feed1DecimalsRaw === "number" ? feed1DecimalsRaw : Number(feed1DecimalsRaw);

  const feed3DecimalsRaw = await priceFeed3.decimals();
  const feed3Decimals = typeof feed3DecimalsRaw === "number" ? feed3DecimalsRaw : Number(feed3DecimalsRaw);

  if (feed1Decimals === 0) {
    throw new Error(`Feed1 ${config.chainlinkFeed1} reports 0 decimals`);
  }

  if (feed3Decimals === 0) {
    throw new Error(`Feed3 ${config.chainlinkFeed3} reports 0 decimals`);
  }

  const feed1Unit = 10n ** BigInt(feed1Decimals);
  const feed3Unit = 10n ** BigInt(feed3Decimals);

  const roundData1 = await priceFeed1.latestRoundData();
  const answer1 = BigInt(roundData1.answer ?? roundData1[1]);
  const updatedAt1 = BigInt(roundData1.updatedAt ?? roundData1[3]);

  const roundData3 = await priceFeed3.latestRoundData();
  const answer3 = BigInt(roundData3.answer ?? roundData3[1]);
  const updatedAt3 = BigInt(roundData3.updatedAt ?? roundData3[3]);

  if (answer1 <= 0n) {
    throw new Error(`Feed1 ${config.chainlinkFeed1} returned non-positive answer ${answer1}`);
  }

  if (answer3 <= 0n) {
    throw new Error(`Feed3 ${config.chainlinkFeed3} returned non-positive answer ${answer3}`);
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

  let priceInBase1 = (answer1 * baseCurrencyUnit) / feed1Unit;
  let priceInBase2 = (rate * baseCurrencyUnit) / rateProviderUnit;
  let priceInBase3 = (answer3 * baseCurrencyUnit) / feed3Unit;

  const lowerThresholdInBase1 = BigInt(config.lowerThresholdInBase1 ?? 0n);
  const fixedPriceInBase1 = BigInt(config.fixedPriceInBase1 ?? 0n);
  const lowerThresholdInBase2 = BigInt(config.lowerThresholdInBase2 ?? 0n);
  const fixedPriceInBase2 = BigInt(config.fixedPriceInBase2 ?? 0n);
  const lowerThresholdInBase3 = BigInt(config.lowerThresholdInBase3 ?? 0n);
  const fixedPriceInBase3 = BigInt(config.fixedPriceInBase3 ?? 0n);

  priceInBase1 = applyThreshold(priceInBase1, lowerThresholdInBase1, fixedPriceInBase1);
  priceInBase2 = applyThreshold(priceInBase2, lowerThresholdInBase2, fixedPriceInBase2);
  priceInBase3 = applyThreshold(priceInBase3, lowerThresholdInBase3, fixedPriceInBase3);

  // Compose all three prices: (price1 * price2 * price3) / BASE_CURRENCY_UNIT^2
  const intermediatePrice = (priceInBase1 * priceInBase2) / baseCurrencyUnit;
  const candidatePrice = (intermediatePrice * priceInBase3) / baseCurrencyUnit;

  return {
    candidatePrice,
    priceInBase1,
    priceInBase2,
    priceInBase3,
    chainlinkAnswer1: answer1,
    chainlinkAnswer3: answer3,
    rateProviderRate: rate,
    feed1Decimals,
    feed3Decimals,
    assetDecimals,
    updatedAt1,
    updatedAt3,
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
 * Build a Safe transaction payload to add a composite feed on the ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding.
 *
 * @param wrapperAddress - The address of the wrapper contract
 * @param asset - The asset address for which to add the composite feed
 * @param chainlinkFeed1 - The first Chainlink price feed address
 * @param rateProvider - The rate provider address
 * @param chainlinkFeed3 - The third Chainlink price feed address (USD feed)
 * @param lowerThresholdInBase1 - Lower threshold for the first price feed in base currency units
 * @param fixedPriceInBase1 - Fixed price for the first price feed in base currency units
 * @param lowerThresholdInBase2 - Lower threshold for the rate provider in base currency units
 * @param fixedPriceInBase2 - Fixed price for the rate provider in base currency units
 * @param lowerThresholdInBase3 - Lower threshold for the third price feed in base currency units
 * @param fixedPriceInBase3 - Fixed price for the third price feed in base currency units
 * @param wrapperInterface - The contract interface for encoding function data
 */
function createAddCompositeFeedTransaction(
  wrapperAddress: string,
  asset: string,
  chainlinkFeed1: string,
  rateProvider: string,
  chainlinkFeed3: string,
  lowerThresholdInBase1: bigint,
  fixedPriceInBase1: bigint,
  lowerThresholdInBase2: bigint,
  fixedPriceInBase2: bigint,
  lowerThresholdInBase3: bigint,
  fixedPriceInBase3: bigint,
  wrapperInterface: any,
): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("addCompositeFeed", [
      asset,
      chainlinkFeed1,
      rateProvider,
      chainlinkFeed3,
      lowerThresholdInBase1,
      fixedPriceInBase1,
      lowerThresholdInBase2,
      fixedPriceInBase2,
      lowerThresholdInBase3,
      fixedPriceInBase3,
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

    if (manualActions.length > 0) {
      if (executor.useSafe) {
        return false;
      }
      console.log(`    ⏭️ Non-Safe mode: manual admin migration actions detected; continuing.`);
    }

    return true;
  } catch (error) {
    if (executor.useSafe) {
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
    "ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding",
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

  const deployerAddress = await deployerSigner.getAddress();
  console.log(`  🔄 Revoking roles from deployer ${deployerAddress}...`);

  for (const role of roles) {
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

  const adminMigrationComplete = await ensureDefaultAdminExistsAndRevokeFromWithSafe(
    hre,
    "ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding",
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

  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  const usdConfig = config.oracleAggregators.USD;
  const baseCurrency = usdConfig.baseCurrency;
  const baseCurrencyUnit = BigInt(10) ** BigInt(usdConfig.priceDecimals);

  console.log(`🔮 Base currency: ${baseCurrency}`);
  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  // Deploy ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding
  console.log(`\n🚀 Deploying ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding...`);
  const wrapperDeployResult = await deployments.deploy(USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_WITH_USD_ID, {
    from: deployer,
    contract: "ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding",
    args: [baseCurrency, baseCurrencyUnit],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });

  const wrapperAddress = wrapperDeployResult.address;
  const wrapper = await ethers.getContractAt("ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding", wrapperAddress);

  console.log(`✅ ChainlinkSafeRateProviderCompositeWrapperWithUSDThresholding deployed at: ${wrapperAddress}`);

  // Configure wstkscETH feed
  const wstkscETHAddress = config.tokenAddresses.wstkscETH;

  if (!wstkscETHAddress) {
    console.log("\n⚠️ wstkscETH address not configured for this network; skipping wstkscETH oracle update.");
    return true;
  }

  // Feed addresses from existing deployments
  const feed1 = "0xaA0eA5aa28dCB4280d0469167Bb8Bf99F51427D3"; // ChainlinkDecimalConverter wstkscETH/stkscETH
  const rateProvider = "0x61bE1eC20dfE0197c27B80bA0f7fcdb1a6B236E2"; // stkscETH/scETH rate provider
  const feed3 = "0x824364077993847f71293B24ccA8567c00c2de11"; // USD Chainlink feed (replacing discontinued scETH/USD)

  // Threshold configuration (no thresholding by default)
  const lowerThresholdInBase1 = 0n;
  const fixedPriceInBase1 = 0n;
  const lowerThresholdInBase2 = 0n;
  const fixedPriceInBase2 = 0n;
  const lowerThresholdInBase3 = 0n;
  const fixedPriceInBase3 = 0n;

  const feedConfig: ChainlinkCompositeFeedWithUSDConfig = {
    feedAsset: wstkscETHAddress,
    chainlinkFeed1: feed1,
    rateProvider: rateProvider,
    chainlinkFeed3: feed3,
    lowerThresholdInBase1,
    fixedPriceInBase1,
    lowerThresholdInBase2,
    fixedPriceInBase2,
    lowerThresholdInBase3,
    fixedPriceInBase3,
  };

  console.log(`\n🔧 Configuring wstkscETH composite feed...`);
  console.log(`  📊 Adding composite feed for asset ${feedConfig.feedAsset}...`);
  console.log(`    Feed1 (wstkscETH/stkscETH): ${feed1}`);
  console.log(`    Rate Provider (stkscETH/scETH): ${rateProvider}`);
  console.log(`    Feed3 (USD): ${feed3}`);

  const diagnostics = await buildCompositePriceDiagnostics(ethers, feedConfig, baseCurrencyUnit, deployerSigner);
  console.log(
    `    ℹ️ Feed1 answer=${diagnostics.chainlinkAnswer1} (decimals=${diagnostics.feed1Decimals}), rate=${diagnostics.rateProviderRate} (asset decimals=${diagnostics.assetDecimals}), feed3 answer=${diagnostics.chainlinkAnswer3} (decimals=${diagnostics.feed3Decimals})`,
  );
  console.log(
    `    ℹ️ Candidate composite price=${diagnostics.candidatePrice}, leg1=${diagnostics.priceInBase1}, leg2=${diagnostics.priceInBase2}, leg3=${diagnostics.priceInBase3}`,
  );

  const complete = await executor.tryOrQueue(
    async () => {
      await wrapper.addCompositeFeed(
        feedConfig.feedAsset,
        feedConfig.chainlinkFeed1,
        feedConfig.rateProvider,
        feedConfig.chainlinkFeed3,
        feedConfig.lowerThresholdInBase1,
        feedConfig.fixedPriceInBase1,
        feedConfig.lowerThresholdInBase2,
        feedConfig.fixedPriceInBase2,
        feedConfig.lowerThresholdInBase3,
        feedConfig.fixedPriceInBase3,
      );
      console.log(`    ✅ Added ChainlinkSafeRateProviderComposite feed for ${feedConfig.feedAsset}`);
    },
    () =>
      createAddCompositeFeedTransaction(
        wrapperAddress,
        feedConfig.feedAsset,
        feedConfig.chainlinkFeed1,
        feedConfig.rateProvider,
        feedConfig.chainlinkFeed3,
        feedConfig.lowerThresholdInBase1 ?? 0n,
        feedConfig.fixedPriceInBase1 ?? 0n,
        feedConfig.lowerThresholdInBase2 ?? 0n,
        feedConfig.fixedPriceInBase2 ?? 0n,
        feedConfig.lowerThresholdInBase3 ?? 0n,
        feedConfig.fixedPriceInBase3 ?? 0n,
        wrapper.interface,
      ),
  );

  let allOperationsComplete = complete;

  // Migrate wrapper roles to governance
  console.log(`\n🔐 Migrating ChainlinkSafeRateProviderComposite wrapper roles to governance...`);
  const rolesMigrationComplete = await migrateOracleWrapperRolesIdempotent(
    hre,
    USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_WITH_USD_ID,
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
    const flushed = await executor.flush(`Deploy ChainlinkSafeRateProviderComposite wrapper with USD: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
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
 * Hardhat deploy entry point.
 *
 * @param hre - Hardhat runtime environment.
 * @returns True when the script finishes or queues governance actions.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeDeployment(hre);
};

func.id = "deploy-wstksceth-usd-oracle";
func.tags = ["usd-oracle", "oracle-wrapper", "chainlink-safe-rate-provider", "wstksceth"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];

export default func;
