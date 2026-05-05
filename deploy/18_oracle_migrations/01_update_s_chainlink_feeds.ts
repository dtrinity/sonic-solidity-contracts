import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { Config } from "../../config/types";
import { USD_CHAINLINK_FEED_WRAPPER_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { LEGACY_CHAINLINK_FEED_WRAPPER_ARTIFACT } from "../../typescript/oracle-wrapper-artifacts";

type SafeTransactionData = {
  to: string;
  value: string;
  data: string;
};

export type OracleMigrationConfig = Pick<Config, "oracleAggregators" | "safeConfig" | "tokenAddresses" | "walletAddresses">;

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
 * Ensure governance can manage the legacy Chainlink wrapper before queueing feed updates.
 *
 * @param wrapper - Wrapper contract instance.
 * @param wrapperAddress - Wrapper contract address.
 * @param governanceMultisig - Governance multisig that should hold the role.
 * @param executor - Governance executor used for direct calls or Safe queueing.
 */
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
    console.log(`✓ Governance already has ORACLE_MANAGER_ROLE on ${wrapperAddress}`);
    return true;
  }

  const grantRoleTx = createGrantRoleTransaction(wrapperAddress, oracleManagerRole, governanceMultisig, wrapper.interface);

  if (hasQueuedTransaction(executor, grantRoleTx)) {
    console.log(`📝 ORACLE_MANAGER_ROLE grant already queued for governance on ${wrapperAddress}`);
    return false;
  }

  return executor.tryOrQueue(
    async () => {
      const tx = await wrapper.grantRole(oracleManagerRole, governanceMultisig);
      await tx.wait();
      console.log(`➕ Granted ORACLE_MANAGER_ROLE to governance ${governanceMultisig}`);
    },
    () => grantRoleTx,
  );
}

/**
 * Configure stage 1 of the S/USD migration by updating legacy simple wrapper feeds.
 *
 * @param hre - Hardhat runtime environment.
 * @param options - Optional execution overrides.
 * @param options.config - Preloaded config override used by tests or composed scripts.
 */
export async function executeStage1(
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

  const plainFeeds = config.oracleAggregators.USD.redstoneOracleAssets?.plainRedstoneOracleWrappers || {};

  const sAssets = [config.tokenAddresses.wS, config.tokenAddresses.dS].filter((address): address is string =>
    Boolean(address && address !== ""),
  );
  let hasPendingGovernance = false;

  const governanceReady = await ensureGovernanceCanManageWrapper(
    chainlinkWrapper,
    chainlinkWrapperDeployment.address,
    config.walletAddresses.governanceMultisig,
    governance,
  );

  if (!governanceReady) {
    hasPendingGovernance = true;
  }

  for (const asset of sAssets) {
    const expectedFeed = plainFeeds[asset];

    if (!expectedFeed) {
      throw new Error(`No S/USD plain feed configured for asset ${asset}. Update the config before running this script.`);
    }

    const currentFeed = await chainlinkWrapper.assetToFeed(asset);

    let feedUpdatedImmediately = false;

    if (currentFeed.toLowerCase() !== expectedFeed.toLowerCase()) {
      const safeTx: SafeTransactionData = {
        to: chainlinkWrapperDeployment.address,
        value: "0",
        data: chainlinkWrapper.interface.encodeFunctionData("setFeed", [asset, expectedFeed]),
      };

      const complete = await governance.tryOrQueue(
        async () => {
          const tx = await chainlinkWrapper.setFeed(asset, expectedFeed);
          await tx.wait();
          console.log(`🔄 Updated Chainlink feed wrapper for asset ${asset} to ${expectedFeed}`);
        },
        () => safeTx,
      );

      if (!complete) {
        hasPendingGovernance = true;
        console.log(`📝 Queued Safe transaction to set feed for asset ${asset}.`);
      } else {
        feedUpdatedImmediately = true;
      }
    } else {
      console.log(`✅ Chainlink feed wrapper already configured for asset ${asset}.`);
      feedUpdatedImmediately = true;
    }

    if (feedUpdatedImmediately) {
      try {
        const price = await chainlinkWrapper.getAssetPrice(asset);
        console.log(`💵 Wrapper price for ${asset}: ${price}`);
      } catch (error) {
        throw new Error(`Failed to read wrapper price for ${asset} even after direct update. ${error}`);
      }
    } else {
      console.log(`ℹ️ Wrapper price for ${asset} will be available once the Safe transaction is executed.`);
    }
  }

  console.log("ℹ️ stS/USD composite migration is handled by the Chainlink wrapper in deploy/20; skipping legacy composite update.");

  if (hasPendingGovernance) {
    const flushed = await governance.flush("Stage 1: configure Chainlink S/USD feeds");

    if (governance.useSafe) {
      if (!flushed) {
        throw new Error("Failed to create Safe batch for S/USD Chainlink feed configuration.");
      }

      console.log("📬 Safe transaction batch prepared for Stage 1 (Chainlink S/USD feed configuration).");
      console.log("📝 After governance executes, run Stage 2 to switch oracle aggregators.");
      return false;
    }

    console.log("\n❌ Non-Safe mode: direct execution failed and no Safe batch was prepared.");
    return false;
  }

  console.log("✅ Stage 1 Chainlink S/USD feed configuration completed or was already in place.");
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  return executeStage1(hre);
};

func.tags = ["oracle", "usd-oracle", "chainlink", "s-feed-stage1"];
func.dependencies = [USD_CHAINLINK_FEED_WRAPPER_ID];
func.runAtTheEnd = true;
func.id = "update-s-chainlink-feeds";

export default func;
