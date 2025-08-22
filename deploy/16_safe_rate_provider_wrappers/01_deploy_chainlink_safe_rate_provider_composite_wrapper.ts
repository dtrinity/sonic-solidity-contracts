import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { ensureDefaultAdminExistsAndRevokeFrom } from "../../typescript/hardhat/access_control";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

/**
 * Build a Safe transaction payload to grant a role on a target contract.
 *
 * @param contractAddress - Address of the contract to call
 * @param role - Role hash to grant
 * @param grantee - Address to receive the role
 * @param contractInterface - Contract interface used to encode the call
 */
function createGrantRoleTransaction(
  contractAddress: string,
  role: string,
  grantee: string,
  contractInterface: any,
): SafeTransactionData {
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
function createRevokeRoleTransaction(
  contractAddress: string,
  role: string,
  account: string,
  contractInterface: any,
): SafeTransactionData {
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

/**
 * Build a Safe transaction payload to set an oracle on the OracleAggregator.
 *
 * @param aggregatorAddress - The address of the OracleAggregator contract
 * @param asset - The asset address for which to set the oracle
 * @param oracle - The oracle address to set for the asset
 * @param aggregatorInterface - The contract interface for encoding function data
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

const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

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
      console.log(
        `    ⏭️ Non-Safe mode: manual admin migration actions detected; continuing.`,
      );
    }

    return true;
  } catch (error) {
    if (executor.useSafe) {
      // Requires governance action; queue not implemented for this path
      console.warn(
        `    🔄 Admin role migration likely requires governance action:`,
        error,
      );
      return false;
    }
    console.log(
      `    ⏭️ Non-Safe mode: admin migration requires governance; continuing.`,
    );
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

  const roles = [
 
    { name: "ORACLE_MANAGER_ROLE", hash: ORACLE_MANAGER_ROLE },
  ];

  console.log(`  📄 Migrating roles for ${wrapperName} at ${wrapperAddress}`);

  let noPendingActions = true;

  for (const role of roles) {
    if (!(await wrapper.hasRole(role.hash, governanceMultisig))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.grantRole(role.hash, governanceMultisig);
          console.log(
            `    ➕ Granted ${role.name} to governance ${governanceMultisig}`,
          );
        },
        () =>
          createGrantRoleTransaction(
            wrapperAddress,
            role.hash,
            governanceMultisig,
            wrapper.interface,
          ),
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
    const governanceHasRole = await wrapper.hasRole(
      role.hash,
      governanceMultisig,
    );

    if (deployerHasRole && governanceHasRole) {
      const roleName = role.name;
      const complete = await executor.tryOrQueue(
        async () => {
          await wrapper.revokeRole(role.hash, deployerAddress);
          console.log(`    ➖ Revoked ${roleName} from deployer`);
        },
        () =>
          createRevokeRoleTransaction(
            wrapperAddress,
            role.hash,
            deployerAddress,
            wrapper.interface,
          ),
      );
      if (!complete) noPendingActions = false;
    }
  }

  // Safely migrate DEFAULT_ADMIN_ROLE away from deployer
  const adminMigrationComplete =
    await ensureDefaultAdminExistsAndRevokeFromWithSafe(
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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Initialize governance executor (decides Safe vs direct execution)
  const executor = new GovernanceExecutor(
    hre,
    deployerSigner,
    config.safeConfig,
  );
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
  console.log(
    `\n🚀 Deploying ChainlinkSafeRateProviderCompositeWrapperWithThresholding...`,
  );
  const wrapperDeployResult = await deployments.deploy(
    USD_CHAINLINK_SAFE_RATE_PROVIDER_COMPOSITE_WRAPPER_ID,
    {
      from: deployer,
      contract: "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
      args: [baseCurrency, baseCurrencyUnit],
      log: true,
      autoMine: true,
    },
  );

  const wrapperAddress = wrapperDeployResult.address;
  const wrapper = await ethers.getContractAt(
    "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
    wrapperAddress,
  );

  console.log(
    `✅ ChainlinkSafeRateProviderCompositeWrapper deployed at: ${wrapperAddress}`,
  );

  // Configure feeds from config
  const chainlinkFeeds =
    usdConfig.safeRateProviderAssets
      ?.chainlinkSafeRateProviderCompositeWrappers || {};
  let allOperationsComplete = true;

  if (Object.keys(chainlinkFeeds).length > 0) {
    console.log(`\n🔧 Configuring ChainlinkSafeRateProviderComposite feeds...`);

    for (const [_assetAddress, feedConfig] of Object.entries(chainlinkFeeds)) {
      console.log(
        `  📊 Adding composite feed for asset ${feedConfig.feedAsset}...`,
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
          console.log(
            `    ✅ Added ChainlinkSafeRateProviderComposite feed for ${feedConfig.feedAsset}`,
          );
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

    // Point oracle aggregator to this wrapper for configured assets
    console.log(
      `\n🔗 Pointing USD Oracle Aggregator to ChainlinkSafeRateProviderComposite wrapper...`,
    );
    const oracleAggregatorDeployment = await deployments.get(
      USD_ORACLE_AGGREGATOR_ID,
    );
    const oracleAggregator = await ethers.getContractAt(
      "OracleAggregator",
      oracleAggregatorDeployment.address,
    );

    for (const [_assetAddress, feedConfig] of Object.entries(chainlinkFeeds)) {
      console.log(`  🎯 Setting oracle for asset ${feedConfig.feedAsset}...`);

      const complete = await executor.tryOrQueue(
        async () => {
          await oracleAggregator.setOracle(
            feedConfig.feedAsset,
            wrapperAddress,
          );
          console.log(
            `    ✅ Set oracle for ${feedConfig.feedAsset} to ChainlinkSafeRateProviderComposite wrapper`,
          );
        },
        () =>
          createSetOracleTransaction(
            oracleAggregatorDeployment.address,
            feedConfig.feedAsset,
            wrapperAddress,
            oracleAggregator.interface,
          ),
      );

      if (!complete) allOperationsComplete = false;
    }
  } else {
    console.log(
      `ℹ️  No ChainlinkSafeRateProviderComposite feeds configured in config`,
    );
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
    const flushed = await executor.flush(
      `Deploy ChainlinkSafeRateProviderComposite wrapper: governance operations`,
    );

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log(
        "\n⏳ Some operations require governance signatures to complete.",
      );
      console.log(
        "   The deployment script will exit and can be re-run after governance executes the transactions.",
      );
      console.log(
        `\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`,
      );
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log(
        "\n⏭️ Non-Safe mode: pending governance operations detected; continuing.",
      );
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "deploy-chainlink-safe-rate-provider-composite-wrapper";
func.tags = ["usd-oracle", "oracle-wrapper", "chainlink-safe-rate-provider"];
func.dependencies = [USD_ORACLE_AGGREGATOR_ID];

export default func;
