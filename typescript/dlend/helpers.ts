import { BigNumber } from "@ethersproject/bignumber";
import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Libraries } from "hardhat-deploy/types";

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

/**
 * Get the pool libraries of Lending deployment
 *
 * @param hre - Hardhat Runtime Environment
 * @returns The pool libraries
 */
export async function getPoolLibraries(
  hre: HardhatRuntimeEnvironment,
): Promise<Libraries> {
  const supplyLibraryDeployedResult = await hre.deployments.get("SupplyLogic");
  const borrowLibraryDeployedResult = await hre.deployments.get("BorrowLogic");
  const liquidationLibraryDeployedResult =
    await hre.deployments.get("LiquidationLogic");
  const eModeLibraryDeployedResult = await hre.deployments.get("EModeLogic");
  const bridgeLibraryDeployedResult = await hre.deployments.get("BridgeLogic");
  const flashLoanLogicDeployedResult =
    await hre.deployments.get("FlashLoanLogic");
  const poolLogicDeployedResult = await hre.deployments.get("PoolLogic");

  return {
    LiquidationLogic: liquidationLibraryDeployedResult.address,
    SupplyLogic: supplyLibraryDeployedResult.address,
    EModeLogic: eModeLibraryDeployedResult.address,
    FlashLoanLogic: flashLoanLogicDeployedResult.address,
    BorrowLogic: borrowLibraryDeployedResult.address,
    BridgeLogic: bridgeLibraryDeployedResult.address,
    PoolLogic: poolLogicDeployedResult.address,
  };
}

/**
 * Convert array to chunks
 *
 * @param arr - The array to convert to chunks
 * @param chunkSize - The size of each chunk
 * @returns The array of chunks
 */
export const chunk = <T>(arr: Array<T>, chunkSize: number): Array<Array<T>> => {
  return arr.reduce(
    (prevVal: any, currVal: any, currIndx: number, array: Array<T>) =>
      !(currIndx % chunkSize)
        ? prevVal.concat([array.slice(currIndx, currIndx + chunkSize)])
        : prevVal,
    [],
  );
};

/**
 * Get the timestamp of a block
 *
 * @param hre - Hardhat Runtime Environment
 * @param blockNumber - The block number
 * @returns The timestamp of the block
 */
export const getBlockTimestamp = async (
  hre: HardhatRuntimeEnvironment,
  blockNumber?: number,
): Promise<number> => {
  if (!blockNumber) {
    const block = await hre.ethers.provider.getBlock("latest");

    if (!block) {
      throw `getBlockTimestamp: missing block number ${blockNumber}`;
    }
    return block.timestamp;
  }
  let block = await hre.ethers.provider.getBlock(blockNumber);

  if (!block) {
    throw `getBlockTimestamp: missing block number ${blockNumber}`;
  }
  return block.timestamp;
};

/**
 * Get the close factor hard fork threshold
 *
 * @param hre - Hardhat Runtime Environment
 * @returns - The close factor hard fork threshold (ie. 0.951234 means 95.1234%)
 */
export async function getCloseFactorHFThreshold(
  hre: HardhatRuntimeEnvironment,
): Promise<number> {
  const liquidationLibraryDeployedResult =
    await hre.deployments.get("LiquidationLogic");
  const liquidationLogicContract = await hre.ethers.getContractAt(
    "LiquidationLogic",
    liquidationLibraryDeployedResult.address,
  );
  const closeFactorHFThresholdRaw =
    await liquidationLogicContract.CLOSE_FACTOR_HF_THRESHOLD();
  // The CLOSE_FACTOR_HF_THRESHOLD is a fixed-point number with 18 decimals
  // The division is to make the closeFactorHFThreshold a number with 4 decimals
  const closeFactorHFThreshold = BigNumber.from(closeFactorHFThresholdRaw)
    .div(1e14)
    .toNumber();
  return closeFactorHFThreshold / 1e4;
}

/**
 * Initializes and configures a list of reserves based on the dLend configuration.
 *
 * @param hre - Hardhat Runtime Environment
 * @param reserveSymbolsToSetup - Optional array of reserve symbols (strings) to set up. If null/undefined, sets up all reserves from config.
 */
export async function setupInitialReserves(
  hre: HardhatRuntimeEnvironment,
  reserveSymbolsToSetup?: string[],
): Promise<void> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const { reservesConfig } = config.dLend;

  const targetReserveSymbols = reserveSymbolsToSetup
    ? reserveSymbolsToSetup
    : Object.keys(reservesConfig);

  if (targetReserveSymbols.length === 0) {
    console.log("No reserves specified or found in config to set up. Skipping...");
    return;
  }

  console.log(
    `--- Setting up Reserves: ${targetReserveSymbols.join(", ")} ---`,
  );

  // --- Get Core Contract Instances ---
  const addressProvider = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressProvider.address,
    signer,
  );
  const poolConfiguratorAddress =
    await addressesProviderContract.getPoolConfigurator();
  const poolConfiguratorContract = await hre.ethers.getContractAt(
    "PoolConfigurator",
    poolConfiguratorAddress,
    signer,
  );
  const poolAddress = await addressesProviderContract.getPool();
  const poolContract = await hre.ethers.getContractAt(
    "Pool",
    poolAddress,
    signer,
  );
  const aclManagerAddress = await addressesProviderContract.getACLManager();
  const aclManager = await hre.ethers.getContractAt(
    "ACLManager",
    aclManagerAddress,
    signer,
  );
  const reservesSetupHelper = await hre.deployments.get(
    RESERVES_SETUP_HELPER_ID,
  );
  const reservesSetupHelperContract = await hre.ethers.getContractAt(
    "ReservesSetupHelper",
    reservesSetupHelper.address,
    signer,
  );
  const poolDataProvider = await hre.deployments.get(POOL_DATA_PROVIDER_ID);
  const poolDataProviderContract = await hre.ethers.getContractAt(
    "AaveProtocolDataProvider",
    poolDataProvider.address,
    signer,
  );

  // --- Get Implementations and Treasury ---
  const { address: treasuryAddress } =
    await hre.deployments.get(TREASURY_PROXY_ID);
  const aTokenImpl = await hre.deployments.get(ATOKEN_IMPL_ID);
  const stableDebtTokenImpl = await hre.deployments.get(
    STABLE_DEBT_TOKEN_IMPL_ID,
  );
  const variableDebtTokenImpl = await hre.deployments.get(
    VARIABLE_DEBT_TOKEN_IMPL_ID,
  );

  // --- Prepare Initialization Parameters ---
  const initInputParams: any[] = []; // Using 'any' for simplicity, define interface if preferred
  const symbolsToInitialize: string[] = [];

  console.log("- Preparing initialization parameters...");

  for (const symbol of targetReserveSymbols) {
    const params = reservesConfig[symbol];

    if (!params) {
      console.warn(`- Skipping ${symbol}: No configuration found.`);
      continue;
    }

    const tokenAddress =
      config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];

    if (!tokenAddress) {
      console.warn(`- Skipping ${symbol}: Token address not found in config.`);
      continue;
    }

    const poolReserve = await poolContract.getReserveData(tokenAddress);

    if (poolReserve.aTokenAddress !== ZeroAddress) {
      console.log(`- Skipping init of ${symbol}: Already initialized.`);
      continue; // Already initialized, skip init param generation
    }

    // Strategy must have been deployed previously (e.g., in the calling script)
    const strategyName = `ReserveStrategy-${params.strategy.name}`;
    const strategyDeployment = await hre.deployments.get(strategyName);

    if (!strategyDeployment) {
      throw new Error(
        `Interest rate strategy deployment '${strategyName}' not found for reserve ${symbol}. Ensure it was deployed.`,
      );
    }
    const strategyAddress = strategyDeployment.address;

    const tokenContract = await hre.ethers.getContractAt(
      "IERC20Detailed",
      tokenAddress,
    );
    const tokenName = await tokenContract.name();
    const tokenDecimals = Number(await tokenContract.decimals());

    symbolsToInitialize.push(symbol); // Keep track of which ones we are actually initializing

    initInputParams.push({
      aTokenImpl: aTokenImpl.address,
      stableDebtTokenImpl: stableDebtTokenImpl.address,
      variableDebtTokenImpl: variableDebtTokenImpl.address,
      underlyingAssetDecimals: tokenDecimals,
      interestRateStrategyAddress: strategyAddress,
      underlyingAsset: tokenAddress,
      treasury: treasuryAddress,
      incentivesController: ZeroAddress, // Adjust if using incentives
      underlyingAssetName: tokenName,
      aTokenName: `dLEND ${tokenName}`,
      aTokenSymbol: `dLEND-${symbol}`, // Use symbol from config for consistency
      variableDebtTokenName: `dLEND Variable Debt ${symbol}`,
      variableDebtTokenSymbol: `dLEND-variableDebt-${symbol}`,
      stableDebtTokenName: `dLEND Stable Debt ${symbol}`,
      stableDebtTokenSymbol: `dLEND-stableDebt-${symbol}`,
      params: "0x10", // Default empty params
    });
    console.log(`  - Prepared init params for ${symbol}`);
  }

  // --- Initialize Reserves (in chunks) ---
  if (initInputParams.length > 0) {
    console.log(`- Initializing ${initInputParams.length} new reserves...`);
    const initChunks = 3; // Or make this configurable
    const chunkedInitInputParams = chunk(initInputParams, initChunks);

    for (
      let chunkIndex = 0;
      chunkIndex < chunkedInitInputParams.length;
      chunkIndex++
    ) {
      console.log(
        `  - Initializing chunk ${chunkIndex + 1}/${chunkedInitInputParams.length}...`,
      );
      const tx = await poolConfiguratorContract.initReserves(
        chunkedInitInputParams[chunkIndex],
      );
      await tx.wait();
      console.log(`  - Chunk ${chunkIndex + 1} initialized (Tx: ${tx.hash})`);
    }
    console.log("- Initialization complete.");
  } else {
    console.log("- No new reserves require initialization.");
  }

  // --- Configure Reserves (using helper) ---
  console.log("- Preparing configuration parameters...");
  const configInputParams: any[] = []; // Using 'any' for simplicity

  for (const symbol of targetReserveSymbols) {
    const params = reservesConfig[symbol];

    if (!params) {
      // Already warned during init check
      continue;
    }
    const tokenAddress =
      config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];

    if (!tokenAddress) {
      // Already warned during init check
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
      flashLoanEnabled: true, // Typically enabled, adjust if needed
    });
    console.log(`  - Prepared config params for ${symbol}`);
  }

  if (configInputParams.length > 0) {
    console.log(
      `- Configuring ${configInputParams.length} reserves via ReservesSetupHelper...`,
    );
    const reserveHelperAddress = await reservesSetupHelperContract.getAddress();
    let riskAdminGranted = false;

    try {
      console.log(
        `  - Granting Risk Admin role to helper (${reserveHelperAddress})...`,
      );
      await aclManager.addRiskAdmin(reserveHelperAddress);
      riskAdminGranted = true;

      console.log("  - Calling configureReserves on helper...");
      // Configure all target reserves in one call if possible, or chunk if needed
      // For simplicity, assuming one call works. Chunking similar to init if necessary.
      const configTx = await reservesSetupHelperContract.configureReserves(
        poolConfiguratorAddress,
        configInputParams,
      );
      await configTx.wait();
      console.log(
        `  - Configuration transaction successful (Tx: ${configTx.hash})`,
      );
    } finally {
      if (riskAdminGranted) {
        console.log(
          `  - Revoking Risk Admin role from helper (${reserveHelperAddress})...`,
        );
        await aclManager.removeRiskAdmin(reserveHelperAddress);
      }
    }
    console.log("- Configuration complete.");
  } else {
    console.log("- No reserves require configuration.");
  }

  // --- Save Token Addresses ---
  console.log("- Saving reserve token addresses...");

  for (const symbol of targetReserveSymbols) {
    const tokenAddress =
      config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];
    if (!tokenAddress) continue; // Should have been caught earlier, but safe check

    // Check if we actually expect tokens (might not exist if init failed or skipped)
    const reserveDataCheck = await poolContract.getReserveData(tokenAddress);

    if (reserveDataCheck.aTokenAddress === ZeroAddress) {
      console.log(
        `  - Skipping save for ${symbol}: Reserve not found in pool (likely init failed or skipped).`,
      );
      continue;
    }

    try {
      const tokenData =
        await poolDataProviderContract.getReserveTokensAddresses(tokenAddress);

      await hre.deployments.save(`${symbol}AToken`, {
        abi: aTokenImpl.abi, // Assuming ABI is same for all
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
      // Decide if this should throw or just warn
    }
  }
  console.log("- Saving addresses complete.");
  console.log(`--- Finished Setting up Reserves ---`);
}
