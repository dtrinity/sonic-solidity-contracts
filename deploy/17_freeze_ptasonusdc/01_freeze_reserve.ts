import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID, POOL_CONFIGURATOR_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";
import { SafeTransactionData } from "../../typescript/safe/types";

/**
 * Build a Safe transaction payload to freeze a reserve on the PoolConfigurator.
 *
 * @param configuratorAddress - Address of the PoolConfigurator contract
 * @param asset - Address of the asset to freeze
 * @param freeze - True to freeze the reserve, false to unfreeze
 * @param configuratorInterface - Contract interface used to encode the call
 */
function createSetReserveFreezeTransaction(
  configuratorAddress: string,
  asset: string,
  freeze: boolean,
  configuratorInterface: any,
): SafeTransactionData {
  return {
    to: configuratorAddress,
    value: "0",
    data: configuratorInterface.encodeFunctionData("setReserveFreeze", [asset, freeze]),
  };
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
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

  // PT-aSonUSDC address from config
  const ptaSonUSDCAddress = config.tokenAddresses.PTaUSDC;

  if (!ptaSonUSDCAddress) {
    console.error("PT-aSonUSDC address not found in config");
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (token not found)`);
    return true;
  }

  console.log(`🪙 PT-aSonUSDC address: ${ptaSonUSDCAddress}`);

  // Get PoolConfigurator deployment
  console.log(`\n🔧 Getting PoolConfigurator deployment...`);
  const poolAddressesProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const poolAddressesProvider = await ethers.getContractAt("PoolAddressesProvider", poolAddressesProviderDeployment.address);

  // Get the REGISTERED PoolConfigurator, not the deployed one
  const registeredPoolConfiguratorAddress = await poolAddressesProvider.getPoolConfigurator();
  const poolConfigurator = await ethers.getContractAt("PoolConfigurator", registeredPoolConfiguratorAddress);

  console.log(`✅ PoolConfigurator found at: ${registeredPoolConfiguratorAddress}`);

  // Get Pool contract through PoolAddressesProvider
  console.log(`\n🔍 Getting Pool contract...`);
  const poolAddress = await poolAddressesProvider.getPool();
  const pool = await ethers.getContractAt("Pool", poolAddress);

  console.log(`✅ Pool found at: ${poolAddress}`);

  // Check current freeze state
  console.log(`\n🔍 Checking current reserve state...`);
  const reserveConfig = await pool.getConfiguration(ptaSonUSDCAddress);

  // Use ReserveConfiguration library to decode frozen state
  // We'll check the frozen bit directly from the configuration data
  const FROZEN_START_BIT_POSITION = 57n; // From ReserveConfiguration.sol
  const currentlyFrozen = ((reserveConfig.data >> FROZEN_START_BIT_POSITION) & 1n) === 1n;

  console.log(`📊 Current freeze state: ${currentlyFrozen ? "FROZEN" : "ACTIVE"}`);

  if (currentlyFrozen) {
    console.log(`ℹ️  Reserve is already frozen. Nothing to do.`);
    console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅ (already frozen)`);
    return true;
  }

  // Freeze the reserve
  console.log(`\n❄️  Freezing PT-aSonUSDC reserve...`);

  let operationComplete = false;

  try {
    operationComplete = await executor.tryOrQueue(
      async () => {
        await poolConfigurator.setReserveFreeze(ptaSonUSDCAddress, true);
        console.log(`    ✅ PT-aSonUSDC reserve frozen successfully`);
      },
      () => createSetReserveFreezeTransaction(registeredPoolConfiguratorAddress, ptaSonUSDCAddress, true, poolConfigurator.interface),
    );
  } catch (error) {
    console.error(`    ❌ Failed to freeze reserve:`, error);
    throw error;
  }

  // Handle governance operations if needed
  if (!operationComplete) {
    const flushed = await executor.flush(`Freeze PT-aSonUSDC reserve: governance operations`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Freeze operation requires governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false; // Fail idempotently - script can be re-run
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  // Verify the freeze was successful (if executed directly)
  if (operationComplete) {
    console.log(`\n✅ Verifying freeze operation...`);
    const updatedReserveConfig = await pool.getConfiguration(ptaSonUSDCAddress);
    const nowFrozen = ((updatedReserveConfig.data >> FROZEN_START_BIT_POSITION) & 1n) === 1n;

    if (nowFrozen) {
      console.log(`    ✅ PT-aSonUSDC reserve is now FROZEN`);
      console.log(`    ℹ️  Users can no longer supply to this reserve`);
      console.log(`    ℹ️  Users can still withdraw from this reserve`);
    } else {
      console.log(`    ❌ Reserve freeze verification failed`);
      throw new Error("Reserve freeze verification failed");
    }
  }

  console.log("\n✅ All operations completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "freeze-ptasonusdc-reserve";
func.tags = ["dlend", "reserve-management", "freeze", "pt-asonusdc"];
func.dependencies = [POOL_CONFIGURATOR_ID, POOL_ADDRESSES_PROVIDER_ID];

export default func;
