import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { Config } from "../../config/types";
import { USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

const ERC20_METADATA_ABI = ["function decimals() view returns (uint8)"];
const ERC4626_ABI = ["function asset() view returns (address)", "function convertToAssets(uint256 shares) view returns (uint256 assets)"];
const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];
const RATE_PROVIDER_SAFE_ABI = ["function getRateSafe() view returns (uint256)"];

type ThirdFeedConfig = {
  feedAsset: string;
  erc4626Vault: string;
  rateProvider: string;
  thirdFeed: string;
  lowerThresholdInBase1: bigint;
  fixedPriceInBase1: bigint;
  lowerThresholdInBase2: bigint;
  fixedPriceInBase2: bigint;
  lowerThresholdInBase3: bigint;
  fixedPriceInBase3: bigint;
};

type ThreeLegDiagnostics = {
  candidatePrice: bigint;
  priceInBase1: bigint;
  priceInBase2: bigint;
  priceInBase3: bigint;
  assetsPerOneShare: bigint;
  rateProviderRate: bigint;
  thirdFeedAnswer: bigint;
  thirdFeedDecimals: number;
};

function applyThreshold(priceInBase: bigint, lowerThreshold: bigint, fixedPrice: bigint): bigint {
  if (lowerThreshold > 0n && priceInBase > lowerThreshold) {
    return fixedPrice;
  }
  return priceInBase;
}

async function getTokenDecimals(ethers: HardhatRuntimeEnvironment["ethers"], token: string, signer: Signer): Promise<number> {
  const contract = new ethers.Contract(token, ERC20_METADATA_ABI, signer);
  const raw = await contract.decimals();
  return typeof raw === "number" ? raw : Number(raw);
}

async function buildThreeLegDiagnostics(
  ethers: HardhatRuntimeEnvironment["ethers"],
  config: ThirdFeedConfig,
  baseCurrencyUnit: bigint,
  signer: Signer,
): Promise<ThreeLegDiagnostics> {
  const vault = new ethers.Contract(config.erc4626Vault, ERC4626_ABI, signer);
  const rateProvider = new ethers.Contract(config.rateProvider, RATE_PROVIDER_SAFE_ABI, signer);
  const thirdFeed = new ethers.Contract(config.thirdFeed, PRICE_FEED_ABI, signer);

  const shareDecimals = await getTokenDecimals(ethers, config.erc4626Vault, signer);
  const sharesUnit = 10n ** BigInt(shareDecimals);
  const assetsPerOneShare = BigInt(await vault.convertToAssets(sharesUnit));

  const underlying = await vault.asset();
  const underlyingDecimals = await getTokenDecimals(ethers, underlying, signer);
  let priceInBase1 = (assetsPerOneShare * baseCurrencyUnit) / 10n ** BigInt(underlyingDecimals);

  const assetDecimals = await getTokenDecimals(ethers, config.feedAsset, signer);
  const rateProviderUnit = 10n ** BigInt(assetDecimals);
  const rateProviderRate = BigInt(await rateProvider.getRateSafe());
  if (rateProviderRate === 0n) {
    throw new Error(`Rate provider ${config.rateProvider} returned zero rate`);
  }
  let priceInBase2 = (rateProviderRate * baseCurrencyUnit) / rateProviderUnit;

  const thirdFeedDecimalsRaw = await thirdFeed.decimals();
  const thirdFeedDecimals = typeof thirdFeedDecimalsRaw === "number" ? thirdFeedDecimalsRaw : Number(thirdFeedDecimalsRaw);
  if (thirdFeedDecimals === 0) {
    throw new Error(`Third feed ${config.thirdFeed} reports 0 decimals`);
  }

  const roundData = await thirdFeed.latestRoundData();
  const thirdFeedAnswer = BigInt(roundData.answer ?? roundData[1]);
  if (thirdFeedAnswer <= 0n) {
    throw new Error(`Third feed ${config.thirdFeed} returned non-positive answer ${thirdFeedAnswer}`);
  }
  let priceInBase3 = (thirdFeedAnswer * baseCurrencyUnit) / 10n ** BigInt(thirdFeedDecimals);

  priceInBase1 = applyThreshold(priceInBase1, config.lowerThresholdInBase1, config.fixedPriceInBase1);
  priceInBase2 = applyThreshold(priceInBase2, config.lowerThresholdInBase2, config.fixedPriceInBase2);
  priceInBase3 = applyThreshold(priceInBase3, config.lowerThresholdInBase3, config.fixedPriceInBase3);

  const intermediatePrice = (priceInBase1 * priceInBase2) / baseCurrencyUnit;
  const candidatePrice = (intermediatePrice * priceInBase3) / baseCurrencyUnit;

  return {
    candidatePrice,
    priceInBase1,
    priceInBase2,
    priceInBase3,
    assetsPerOneShare,
    rateProviderRate,
    thirdFeedAnswer,
    thirdFeedDecimals,
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

function createSetFeedTransaction(wrapperAddress: string, feedConfig: ThirdFeedConfig, wrapperInterface: any): SafeTransactionData {
  return {
    to: wrapperAddress,
    value: "0",
    data: wrapperInterface.encodeFunctionData("setFeed", [
      feedConfig.feedAsset,
      feedConfig.erc4626Vault,
      feedConfig.rateProvider,
      feedConfig.thirdFeed,
      feedConfig.lowerThresholdInBase1,
      feedConfig.fixedPriceInBase1,
      feedConfig.lowerThresholdInBase2,
      feedConfig.fixedPriceInBase2,
      feedConfig.lowerThresholdInBase3,
      feedConfig.fixedPriceInBase3,
    ]),
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
    console.log(`    ✓ Governance already has ORACLE_MANAGER_ROLE on ${wrapperAddress}`);
    return true;
  }

  const grantRoleTx = createGrantRoleTransaction(wrapperAddress, oracleManagerRole, governanceMultisig, wrapper.interface);
  if (hasQueuedTransaction(executor, grantRoleTx)) {
    console.log(`    📝 ORACLE_MANAGER_ROLE grant already queued for governance on ${wrapperAddress}`);
    return false;
  }

  return executor.tryOrQueue(
    async () => {
      await wrapper.grantRole(oracleManagerRole, governanceMultisig);
      console.log(`    ➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig}`);
    },
    () => grantRoleTx,
  );
}

async function migrateOracleWrapperRoles(
  hre: HardhatRuntimeEnvironment,
  wrapperAddress: string,
  wrapper: any,
  deployerSigner: Signer,
  governanceMultisig: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  const deployerAddress = await deployerSigner.getAddress();
  const oracleManagerRole = await wrapper.ORACLE_MANAGER_ROLE();
  let complete = true;

  if ((await wrapper.hasRole(oracleManagerRole, deployerAddress)) && (await wrapper.hasRole(oracleManagerRole, governanceMultisig))) {
    const revoked = await executor.tryOrQueue(
      async () => {
        await wrapper.revokeRole(oracleManagerRole, deployerAddress);
        console.log(`    ➖ Revoked ORACLE_MANAGER_ROLE from deployer`);
      },
      () => createRevokeRoleTransaction(wrapperAddress, oracleManagerRole, deployerAddress, wrapper.interface),
    );
    if (!revoked) complete = false;
  }

  try {
    const manualActions: string[] = [];
    await ensureDefaultAdminExistsAndRevokeFrom(
      hre,
      "ERC4626RateProviderThirdFeedWrapperWithThresholding",
      wrapperAddress,
      governanceMultisig,
      deployerAddress,
      deployerSigner,
      manualActions,
    );
    if (manualActions.length > 0 && executor.useSafe) {
      complete = false;
    }
  } catch (error) {
    if (executor.useSafe) {
      console.warn(`    🔄 Admin role migration likely requires governance action:`, error);
      complete = false;
    } else {
      console.warn(`    ⚠️ Admin role migration failed in non-Safe mode:`, error);
    }
  }

  return complete;
}

function feedMatchesConfig(existingFeed: any, feedConfig: ThirdFeedConfig): boolean {
  return (
    existingFeed.erc4626Vault.toLowerCase() === feedConfig.erc4626Vault.toLowerCase() &&
    existingFeed.rateProvider.toLowerCase() === feedConfig.rateProvider.toLowerCase() &&
    existingFeed.thirdFeed.toLowerCase() === feedConfig.thirdFeed.toLowerCase() &&
    existingFeed.primaryThreshold.lowerThresholdInBase === feedConfig.lowerThresholdInBase1 &&
    existingFeed.primaryThreshold.fixedPriceInBase === feedConfig.fixedPriceInBase1 &&
    existingFeed.secondaryThreshold.lowerThresholdInBase === feedConfig.lowerThresholdInBase2 &&
    existingFeed.secondaryThreshold.fixedPriceInBase === feedConfig.fixedPriceInBase2 &&
    existingFeed.tertiaryThreshold.lowerThresholdInBase === feedConfig.lowerThresholdInBase3 &&
    existingFeed.tertiaryThreshold.fixedPriceInBase === feedConfig.fixedPriceInBase3
  );
}

export async function executeDeployment(hre: HardhatRuntimeEnvironment, options?: { config?: Config }): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = options?.config ?? (await getConfig(hre));
  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  const usdConfig = config.oracleAggregators.USD;
  const baseCurrency = usdConfig.baseCurrency;
  const baseCurrencyUnit = BigInt(10) ** BigInt(usdConfig.priceDecimals);

  console.log(`🔐 Governance multisig: ${governanceMultisig}`);
  console.log(`🔮 Base currency: ${baseCurrency}`);
  console.log(`🔮 Base currency unit: ${baseCurrencyUnit}`);

  console.log(`\n🚀 Deploying ERC4626RateProviderThirdFeedWrapperWithThresholding...`);
  const wrapperDeployResult = await deployments.deploy(USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID, {
    from: deployer,
    contract: "ERC4626RateProviderThirdFeedWrapperWithThresholding",
    args: [baseCurrency, baseCurrencyUnit],
    log: true,
    autoMine: true,
    skipIfAlreadyDeployed: true,
  });

  const wrapperAddress = wrapperDeployResult.address;
  const wrapper = await ethers.getContractAt("ERC4626RateProviderThirdFeedWrapperWithThresholding", wrapperAddress, deployerSigner);
  console.log(`✅ ERC4626RateProviderThirdFeedWrapperWithThresholding deployed at: ${wrapperAddress}`);

  const feeds = usdConfig.safeRateProviderAssets?.erc4626RateProviderThirdFeedWrappers || {};
  let allOperationsComplete = true;

  if (Object.keys(feeds).length === 0) {
    console.log(`ℹ️  No ERC4626RateProviderThirdFeed feeds configured in config`);
  } else {
    console.log(`\n🔧 Configuring ERC4626RateProviderThirdFeed feeds...`);
    const governanceReady = await ensureGovernanceCanManageWrapper(wrapper, wrapperAddress, governanceMultisig, executor);
    if (!governanceReady) allOperationsComplete = false;

    for (const [_asset, feedConfig] of Object.entries(feeds)) {
      const existingFeed = await wrapper.feeds(feedConfig.feedAsset);
      if (feedMatchesConfig(existingFeed, feedConfig)) {
        console.log(`  ✅ 3-leg feed already configured for asset ${feedConfig.feedAsset}; skipping.`);
        continue;
      }

      console.log(`  📊 Adding 3-leg feed for asset ${feedConfig.feedAsset}...`);
      const diagnostics = await buildThreeLegDiagnostics(ethers, feedConfig, baseCurrencyUnit, deployerSigner);
      console.log(
        `    ℹ️ Candidate price=${diagnostics.candidatePrice}, leg1=${diagnostics.priceInBase1}, leg2=${diagnostics.priceInBase2}, leg3=${diagnostics.priceInBase3}`,
      );
      console.log(
        `    ℹ️ ERC4626 assets/share=${diagnostics.assetsPerOneShare}, rate=${diagnostics.rateProviderRate}, thirdFeedAnswer=${diagnostics.thirdFeedAnswer} (decimals=${diagnostics.thirdFeedDecimals})`,
      );

      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.setFeed(
            feedConfig.feedAsset,
            feedConfig.erc4626Vault,
            feedConfig.rateProvider,
            feedConfig.thirdFeed,
            feedConfig.lowerThresholdInBase1,
            feedConfig.fixedPriceInBase1,
            feedConfig.lowerThresholdInBase2,
            feedConfig.fixedPriceInBase2,
            feedConfig.lowerThresholdInBase3,
            feedConfig.fixedPriceInBase3,
          );
          console.log(`    ✅ Added ERC4626RateProviderThirdFeed feed for ${feedConfig.feedAsset}`);
        },
        () => createSetFeedTransaction(wrapperAddress, feedConfig, wrapper.interface),
      );

      if (!complete) allOperationsComplete = false;
    }
  }

  console.log(`\n🔐 Migrating ERC4626RateProviderThirdFeed wrapper roles to governance...`);
  const rolesComplete = await migrateOracleWrapperRoles(hre, wrapperAddress, wrapper, deployerSigner, governanceMultisig, executor);
  if (!rolesComplete) allOperationsComplete = false;

  if (!allOperationsComplete) {
    const flushed = await executor.flush("Deploy ERC4626RateProviderThirdFeed wrapper: governance operations");

    if (executor.useSafe) {
      if (!flushed) {
        throw new Error("Failed to prepare Safe batch for ERC4626RateProviderThirdFeed wrapper governance operations.");
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`   ➡️ Run the ERC4626RateProviderThirdFeed oracle flip script once governance approves this deployment.`);
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  return executeDeployment(hre);
};

func.id = "deploy-erc4626-rate-provider-third-feed-wrapper";
func.tags = ["usd-oracle", "oracle-wrapper", "erc4626-rate-provider-third-feed"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];

export default func;
