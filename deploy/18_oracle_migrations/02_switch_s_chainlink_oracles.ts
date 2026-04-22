import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_CHAINLINK_FEED_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT } from "../../typescript/oracle-wrapper-artifacts";
import { OracleMigrationConfig } from "./01_update_s_chainlink_feeds";

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

const SANITY_TOLERANCE_BPS = 100n; // 1%

function createGrantRoleTransaction(contractAddress: string, role: string, grantee: string, contractInterface: any): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [role, grantee]),
  };
}

function hasQueuedTransaction(executor: GovernanceExecutor, transaction: SafeTransactionData): boolean {
  return executor.queuedTransactions.some(
    (queued) => queued.to === transaction.to && queued.value === transaction.value && queued.data === transaction.data,
  );
}

async function ensureGovernanceCanManageAggregator(
  oracleAggregator: any,
  aggregatorAddress: string,
  governanceMultisig: string,
  executor: GovernanceExecutor,
): Promise<boolean> {
  if (!executor.useSafe) {
    return true;
  }

  const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
  if (await oracleAggregator.hasRole(oracleManagerRole, governanceMultisig)) {
    console.log(`✓ Governance already has ORACLE_MANAGER_ROLE on OracleAggregator`);
    return true;
  }

  const grantRoleTx = createGrantRoleTransaction(aggregatorAddress, oracleManagerRole, governanceMultisig, oracleAggregator.interface);
  if (hasQueuedTransaction(executor, grantRoleTx)) {
    console.log(`📝 ORACLE_MANAGER_ROLE grant already queued for OracleAggregator`);
    return false;
  }

  return executor.tryOrQueue(
    async () => {
      const tx = await oracleAggregator.grantRole(oracleManagerRole, governanceMultisig);
      await tx.wait();
      console.log(`➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig} on OracleAggregator`);
    },
    () => grantRoleTx,
  );
}

export async function executeStage2(
  hre: HardhatRuntimeEnvironment,
  options?: {
    config?: OracleMigrationConfig;
  },
): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  const config = options?.config ?? (await getConfig(hre));
  const governance = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await governance.initialize();

  const chainlinkWrapperDeployment = await deployments.get(USD_CHAINLINK_FEED_WRAPPER_ID);
  const chainlinkWrapper = await ethers.getContractAt(
    LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT,
    chainlinkWrapperDeployment.address,
    deployerSigner,
  );

  const oracleAggregatorDeployment = await deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, deployerSigner);

  const plainFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  const sAssets = [config.tokenAddresses.wS, config.tokenAddresses.dS].filter((address): address is string =>
    Boolean(address && address !== ""),
  );
  let hasPendingGovernance = false;

  const governanceReady = await ensureGovernanceCanManageAggregator(
    oracleAggregator,
    oracleAggregatorDeployment.address,
    config.walletAddresses.governanceMultisig,
    governance,
  );
  if (!governanceReady) {
    hasPendingGovernance = true;
  }

  for (const asset of sAssets) {
    const expectedFeed = plainFeeds[asset];

    if (!expectedFeed) {
      throw new Error(`No S/USD plain feed configured for asset ${asset}. Stage 1 must be updated.`);
    }

    const storedFeed = await chainlinkWrapper.assetToFeed(asset);

    if (storedFeed.toLowerCase() !== expectedFeed.toLowerCase()) {
      throw new Error(
        `Wrapper feed mismatch for ${asset}. Expected ${expectedFeed}, found ${storedFeed}. Run Stage 1 (update_s_chainlink_feeds) first.`,
      );
    }

    const wrapperPrice = await chainlinkWrapper.getAssetPrice(asset);
    let aggregatorPrice: bigint | undefined = undefined;

    try {
      aggregatorPrice = await oracleAggregator.getAssetPrice(asset);
    } catch (error) {
      console.warn(`⚠️ Current oracle price unavailable for ${asset}: ${error}`);
    }

    if (aggregatorPrice !== undefined) {
      const withinTolerance = isWithinTolerance(wrapperPrice, aggregatorPrice, SANITY_TOLERANCE_BPS);

      if (!withinTolerance) {
        throw new Error(`Wrapper/oracle price drift for ${asset}: wrapper ${wrapperPrice} vs oracle ${aggregatorPrice}. Aborting Stage 2.`);
      }
    }

    const currentOracle = await oracleAggregator.assetOracles(asset);

    if (currentOracle.toLowerCase() !== chainlinkWrapperDeployment.address.toLowerCase()) {
      const safeTx: SafeTransactionData = {
        to: oracleAggregatorDeployment.address,
        value: "0",
        data: oracleAggregator.interface.encodeFunctionData("setOracle", [asset, chainlinkWrapperDeployment.address]),
      };

      const complete = await governance.tryOrQueue(
        async () => {
          const tx = await oracleAggregator.setOracle(asset, chainlinkWrapperDeployment.address);
          await tx.wait();
          console.log(`🔄 Pointed oracle aggregator to the Chainlink feed wrapper for asset ${asset}`);
        },
        () => safeTx,
      );

      if (!complete) {
        hasPendingGovernance = true;
        console.log(`📝 Queued Safe transaction to point oracle aggregator to the Chainlink feed wrapper for asset ${asset}.`);
      }
    } else {
      console.log(`✅ Oracle aggregator already points to the Chainlink feed wrapper for asset ${asset}.`);
    }
  }

  console.log("ℹ️ stS/USD routing is handled by deploy/20 Chainlink wrapper migration; skipping legacy deploy/18 stS routing.");

  const flushed = await governance.flush("Stage 2: switch Chainlink S/USD oracles");

  if (!flushed) {
    throw new Error("Failed to create Safe batch for Stage 2 (Chainlink S/USD oracle switch).");
  }

  if (hasPendingGovernance && governance.useSafe) {
    console.log("📬 Safe transaction batch prepared for Stage 2 (Chainlink S/USD oracle switch).");
    return false;
  }

  console.log("✅ Stage 2 Chainlink S/USD oracle switch completed or was already in place.");
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return executeStage2(hre);
};

/**
 * Check whether two prices fall within the provided tolerance (in BPS).
 *
 * @param newPrice - Newly observed price
 * @param referencePrice - Reference price to compare against
 * @param toleranceBps - Maximum tolerated deviation in basis points
 */
function isWithinTolerance(newPrice: bigint, referencePrice: bigint, toleranceBps: bigint): boolean {
  if (referencePrice === 0n) {
    return newPrice === 0n;
  }

  const diff = newPrice > referencePrice ? newPrice - referencePrice : referencePrice - newPrice;
  return diff * 10_000n <= referencePrice * toleranceBps;
}

func.tags = ["oracle", "usd-oracle", "chainlink", "s-feed-stage2"];
func.dependencies = [USD_CHAINLINK_FEED_WRAPPER_ID, "update-s-chainlink-feeds"];
func.runAtTheEnd = true;
func.id = "switch-s-chainlink-oracles";

export default func;
