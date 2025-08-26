import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig } from "../../config/config"; // Adjust path if needed
import {
  ATOKEN_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  TREASURY_PROXY_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../deploy-ids"; // Adjust path if needed
import { chunk } from "./helpers"; // Import chunk from the helpers file

/**
 * Initializes and configures a list of reserves based on the dLend configuration.
 * Only initializes reserves that are not already initialized, but configures all specified target reserves.
 *
 * @param hre - Hardhat Runtime Environment
 * @param reserveSymbolsToSetup - Optional array of reserve symbols (strings) to set up. If null/undefined, sets up all reserves from config.
 */
export async function setupNewReserves(hre: HardhatRuntimeEnvironment, reserveSymbolsToSetup?: string[]): Promise<void> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const { reservesConfig } = config.dLend;

  const targetReserveSymbols = reserveSymbolsToSetup ? reserveSymbolsToSetup : Object.keys(reservesConfig);

  if (targetReserveSymbols.length === 0) {
    console.log("No reserves specified or found in config to set up. Skipping...");
    return;
  }

  console.log(`--- Setting up Reserves: ${targetReserveSymbols.join(", ")} ---`);

  // --- Get Core Contract Instances ---
  // (Fetching contracts: PoolAddressesProvider, PoolConfigurator, Pool, ACLManager, ReservesSetupHelper, AaveProtocolDataProvider)
  const addressProvider = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressesProviderContract = await hre.ethers.getContractAt("PoolAddressesProvider", addressProvider.address, signer);
  const poolConfiguratorAddress = await addressesProviderContract.getPoolConfigurator();
  const poolConfiguratorContract = await hre.ethers.getContractAt("PoolConfigurator", poolConfiguratorAddress, signer);
  const poolAddress = await addressesProviderContract.getPool();
  const poolContract = await hre.ethers.getContractAt("Pool", poolAddress, signer);
  const aclManagerAddress = await addressesProviderContract.getACLManager();
  const aclManager = await hre.ethers.getContractAt("ACLManager", aclManagerAddress, signer);
  const reservesSetupHelper = await hre.deployments.get(RESERVES_SETUP_HELPER_ID);
  const reservesSetupHelperContract = await hre.ethers.getContractAt("ReservesSetupHelper", reservesSetupHelper.address, signer);
  const poolDataProvider = await hre.deployments.get(POOL_DATA_PROVIDER_ID);
  const poolDataProviderContract = await hre.ethers.getContractAt("AaveProtocolDataProvider", poolDataProvider.address, signer);

  // --- Get Implementations and Treasury ---
  const { address: treasuryAddress } = await hre.deployments.get(TREASURY_PROXY_ID);
  const aTokenImpl = await hre.deployments.get(ATOKEN_IMPL_ID);
  const stableDebtTokenImpl = await hre.deployments.get(STABLE_DEBT_TOKEN_IMPL_ID);
  const variableDebtTokenImpl = await hre.deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID);

  // --- Prepare Initialization Parameters ---
  const initInputParams: any[] = [];
  const symbolsToInitialize: string[] = []; // Track symbols initialized *this run*

  console.log("- Preparing initialization parameters...");

  for (const symbol of targetReserveSymbols) {
    const params = reservesConfig[symbol];

    if (!params) {
      console.warn(`- Skipping ${symbol}: No configuration found.`);
      continue;
    }
    const tokenAddress = config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];

    if (!tokenAddress) {
      console.warn(`- Skipping ${symbol}: Token address not found in config.`);
      continue;
    }

    const poolReserve = await poolContract.getReserveData(tokenAddress);

    if (poolReserve.aTokenAddress !== ZeroAddress) {
      console.log(`- Skipping init of ${symbol}: Already initialized.`);
      continue;
    }

    // Strategy must exist
    const strategyName = `ReserveStrategy-${params.strategy.name}`;
    const strategyDeployment = await hre.deployments.get(strategyName);

    if (!strategyDeployment) {
      throw new Error(`Interest rate strategy deployment '${strategyName}' not found for reserve ${symbol}. Ensure it was deployed.`);
    }
    const strategyAddress = strategyDeployment.address;

    const tokenContract = await hre.ethers.getContractAt("IERC20Detailed", tokenAddress);
    const tokenName = await tokenContract.name();
    const tokenDecimals = Number(await tokenContract.decimals());

    symbolsToInitialize.push(symbol);
    initInputParams.push({
      aTokenImpl: aTokenImpl.address,
      stableDebtTokenImpl: stableDebtTokenImpl.address,
      variableDebtTokenImpl: variableDebtTokenImpl.address,
      underlyingAssetDecimals: tokenDecimals,
      interestRateStrategyAddress: strategyAddress,
      underlyingAsset: tokenAddress,
      treasury: treasuryAddress,
      incentivesController: ZeroAddress,
      underlyingAssetName: tokenName,
      aTokenName: `dLEND ${tokenName}`,
      aTokenSymbol: `dLEND-${symbol}`,
      variableDebtTokenName: `dLEND Variable Debt ${symbol}`,
      variableDebtTokenSymbol: `dLEND-variableDebt-${symbol}`,
      stableDebtTokenName: `dLEND Stable Debt ${symbol}`,
      stableDebtTokenSymbol: `dLEND-stableDebt-${symbol}`,
      params: "0x10",
    });
    console.log(`  - Prepared init params for ${symbol}`);
  }

  // --- Initialize Reserves (in chunks) ---
  if (initInputParams.length > 0) {
    console.log(`- Initializing ${initInputParams.length} new reserves...`);
    const initChunks = 3;
    const chunkedInitInputParams = chunk(initInputParams, initChunks);

    for (let chunkIndex = 0; chunkIndex < chunkedInitInputParams.length; chunkIndex++) {
      console.log(`  - Initializing chunk ${chunkIndex + 1}/${chunkedInitInputParams.length}...`);
      const tx = await poolConfiguratorContract.initReserves(chunkedInitInputParams[chunkIndex]);
      await tx.wait();
      console.log(`  - Chunk ${chunkIndex + 1} initialized (Tx: ${tx.hash})`);
    }
    console.log("- Initialization complete.");
  } else {
    console.log("- No new reserves require initialization.");
  }

  // --- Configure Reserves ---
  console.log("- Preparing configuration parameters for target reserves...");
  const configInputParams: any[] = [];

  // Iterate over all target symbols for this run
  for (const symbol of targetReserveSymbols) {
    const params = reservesConfig[symbol];

    if (!params) {
      console.warn(`- Skipping configuration for ${symbol}: No configuration found.`);
      continue;
    }
    const tokenAddress = config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];

    if (!tokenAddress) {
      console.warn(`- Skipping configuration for ${symbol}: Token address not found in config.`);
      continue;
    }

    // Check if the reserve actually exists in the pool (it should if initialized)
    const reserveData = await poolContract.getReserveData(tokenAddress);

    if (reserveData.aTokenAddress === ZeroAddress) {
      console.warn(`- Skipping configuration for ${symbol}: Reserve not actually initialized in the pool.`);
      continue;
    }

    configInputParams.push({
      asset: tokenAddress,
      baseLTV: params.baseLTVAsCollateral,
      liquidationThreshold: params.liquidationThreshold,
      liquidationBonus: params.liquidationBonus,
      reserveFactor: params.reserveFactor,
      borrowCap: params.borrowCap,
      supplyCap: params.supplyCap,
      stableBorrowingEnabled: params.stableBorrowRateEnabled,
      borrowingEnabled: params.borrowingEnabled,
      flashLoanEnabled: true,
    });
    console.log(`  - Prepared config params for reserve ${symbol}`);
  }

  if (configInputParams.length > 0) {
    console.log(`- Configuring ${configInputParams.length} reserves via ReservesSetupHelper...`);
    const reserveHelperAddress = await reservesSetupHelperContract.getAddress();
    let riskAdminGranted = false;

    try {
      console.log(`  - Granting Risk Admin role to helper (${reserveHelperAddress})...`);
      // Ensure the grant transaction is confirmed before continuing
      const grantTx = await aclManager.addRiskAdmin(reserveHelperAddress);
      await grantTx.wait();
      riskAdminGranted = true;
      console.log("  - Calling configureReserves on helper...");
      const configTx = await reservesSetupHelperContract.configureReserves(poolConfiguratorAddress, configInputParams);
      await configTx.wait();
      console.log(`  - Configuration transaction successful (Tx: ${configTx.hash})`);
    } finally {
      if (riskAdminGranted) {
        console.log(`  - Revoking Risk Admin role from helper (${reserveHelperAddress})...`);
        await aclManager.removeRiskAdmin(reserveHelperAddress);
      }
    }
    console.log("- Configuration of targeted reserves complete.");
  } else {
    console.log("- No target reserves require configuration (or were eligible).");
  }

  // --- Save Token Addresses (for all targeted reserves) ---
  console.log("- Saving reserve token addresses...");

  for (const symbol of targetReserveSymbols) {
    // Iterate over all targets to ensure artifacts exist
    const tokenAddress = config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];
    if (!tokenAddress) continue;

    const reserveDataCheck = await poolContract.getReserveData(tokenAddress);

    if (reserveDataCheck.aTokenAddress === ZeroAddress) {
      console.log(`  - Skipping save for ${symbol}: Reserve not found in pool.`);
      continue;
    }

    try {
      const tokenData = await poolDataProviderContract.getReserveTokensAddresses(tokenAddress);
      await hre.deployments.save(`${symbol}AToken`, {
        abi: aTokenImpl.abi,
        address: tokenData.aTokenAddress,
      });
      await hre.deployments.save(`${symbol}StableDebtToken`, {
        abi: stableDebtTokenImpl.abi,
        address: tokenData.stableDebtTokenAddress,
      });
      await hre.deployments.save(`${symbol}VariableDebtToken`, {
        abi: variableDebtTokenImpl.abi,
        address: tokenData.variableDebtTokenAddress,
      });
      console.log(`  - Saved token addresses for ${symbol}`);
    } catch (error) {
      console.error(`  - Error saving token addresses for ${symbol}:`, error);
    }
  }
  console.log("- Saving addresses complete.");
  console.log(`--- Finished Setting up Reserves ---`);
}
