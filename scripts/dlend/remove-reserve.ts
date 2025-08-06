import { deployments, ethers, getNamedAccounts, network } from "hardhat";

import {
  IERC20Detailed,
  IPool,
  IPoolConfigurator,
  IPoolDataProvider,
} from "../../typechain-types";
import {
  POOL_CONFIGURATOR_ID,
  POOL_DATA_PROVIDER_ID,
} from "../../typescript/deploy-ids";

// ------------------------------------------------------------------------------------------------
// CONFIGURATION - Set these values before running
// ------------------------------------------------------------------------------------------------
// Either set the RESERVE_SYMBOL or the RESERVE_ADDRESS (if both provided, address takes precedence)
const RESERVE_SYMBOL = "wstkscUSD"; // Case-sensitive token symbol
const RESERVE_ADDRESS = ""; // Empty string to use symbol lookup instead

// Set to true to suppress safety delays in development environments
const SKIP_SAFETY_DELAY = false;
// ------------------------------------------------------------------------------------------------

/**
 *
 */
async function main() {
  console.log(`--- Reserve Removal Script ---`);
  console.log(`Network: ${network.name}`);

  const { deployer } = await getNamedAccounts();
  const allDeployments = await deployments.all();

  // Get contract addresses from deployments
  const poolConfiguratorAddress = allDeployments[POOL_CONFIGURATOR_ID]?.address;
  const poolDataProviderAddress =
    allDeployments[POOL_DATA_PROVIDER_ID]?.address;
  const aclManagerAddress = allDeployments["ACLManager"]?.address;

  if (!poolConfiguratorAddress) {
    console.error(
      `❌ Error: PoolConfigurator deployment (${POOL_CONFIGURATOR_ID}) not found.`,
    );
    process.exit(1);
  }

  if (!poolDataProviderAddress) {
    console.error(
      `❌ Error: PoolDataProvider deployment (${POOL_DATA_PROVIDER_ID}) not found.`,
    );
    process.exit(1);
  }

  if (!aclManagerAddress) {
    console.error(`❌ Error: ACLManager deployment not found.`);
    process.exit(1);
  }

  console.log(`PoolConfigurator: ${poolConfiguratorAddress}`);
  console.log(`PoolDataProvider: ${poolDataProviderAddress}`);
  console.log(`ACLManager: ${aclManagerAddress}`);

  // Get signer
  const deployerSigner = await ethers.getSigner(deployer);
  console.log(`Using account: ${deployerSigner.address}`);
  const balance = await ethers.provider.getBalance(deployerSigner.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.warn(
      "⚠️ Warning: The executing account has no balance. Gas fees will cause failure.",
    );
  }

  // Get contract instances
  const poolDataProvider = (await ethers.getContractAt(
    "IPoolDataProvider",
    poolDataProviderAddress,
  )) as IPoolDataProvider;

  const poolConfigurator = (await ethers.getContractAt(
    "IPoolConfigurator",
    poolConfiguratorAddress,
    deployerSigner,
  )) as IPoolConfigurator;

  const aclManager = await ethers.getContractAt(
    "IACLManager",
    aclManagerAddress,
  );

  // Get pool contract from the addresses provider to access getReservesList
  const poolAddressesProvider = await ethers.getContractAt(
    "IPoolAddressesProvider",
    allDeployments["PoolAddressesProvider"]?.address,
  );
  const poolAddress = await poolAddressesProvider.getPool();
  const pool = (await ethers.getContractAt("IPool", poolAddress)) as IPool;

  // Determine reserve address
  let assetAddress = "";

  if (RESERVE_ADDRESS && ethers.isAddress(RESERVE_ADDRESS)) {
    assetAddress = RESERVE_ADDRESS;
    console.log(`Using provided reserve address: ${assetAddress}`);

    // Verify address is a valid reserve
    try {
      const reserveData = await poolDataProvider.getReserveData(assetAddress);

      if (!reserveData || typeof reserveData !== "object") {
        console.error(
          `❌ Error: Could not fetch reserve data for ${assetAddress}.`,
        );
        process.exit(1);
      }
    } catch (e) {
      console.error(
        `❌ Error: Address ${assetAddress} is not a valid reserve:`,
        e,
      );
      process.exit(1);
    }
  } else if (RESERVE_SYMBOL) {
    console.log(`Looking up address for symbol: ${RESERVE_SYMBOL}`);

    // Get reserves list (implementation depends on your contract)
    try {
      // Try to get all reserves and match by symbol
      const reservesList = await pool.getReservesList();

      let found = false;

      for (const reserve of reservesList) {
        // For each reserve, get the underlying token and check its symbol
        try {
          const token = (await ethers.getContractAt(
            "IERC20Detailed",
            reserve,
          )) as IERC20Detailed;
          const symbol = await token.symbol();

          if (symbol === RESERVE_SYMBOL) {
            assetAddress = reserve;
            found = true;
            console.log(`Found address for ${RESERVE_SYMBOL}: ${assetAddress}`);
            break;
          }
        } catch (e) {
          // Skip this reserve if we can't get its symbol
          continue;
        }
      }

      if (!found) {
        console.error(
          `❌ Error: Could not find reserve with symbol ${RESERVE_SYMBOL}`,
        );
        process.exit(1);
      }
    } catch (e) {
      console.error(
        `❌ Error finding reserve for symbol ${RESERVE_SYMBOL}:`,
        e,
      );
      process.exit(1);
    }
  } else {
    console.error(
      "❌ Error: Please set either RESERVE_SYMBOL or RESERVE_ADDRESS.",
    );
    process.exit(1);
  }

  // Pre-flight checks
  console.log("\nPerforming pre-flight checks:");

  try {
    // Get reserve data - structure may vary depending on your implementation
    const reserveData = await poolDataProvider.getReserveData(assetAddress);

    if (!reserveData) {
      console.error(`❌ Error: Could not fetch reserve data.`);
      process.exit(1);
    }

    // Access properties - adjust according to your actual data structure
    const totalAToken = reserveData.totalAToken || reserveData[2]; // Adapt based on your actual structure
    const totalStableDebt = reserveData.totalStableDebt || reserveData[3];
    const totalVariableDebt = reserveData.totalVariableDebt || reserveData[4];

    // Get configuration data
    const reserveConf =
      await poolDataProvider.getReserveConfigurationData(assetAddress);
    const decimals = await getTokenDecimals(assetAddress);

    console.log(
      ` - Total aTokens: ${ethers.formatUnits(totalAToken, decimals)}`,
    );
    console.log(
      ` - Total Stable Debt: ${ethers.formatUnits(totalStableDebt, decimals)}`,
    );
    console.log(
      ` - Total Variable Debt: ${ethers.formatUnits(totalVariableDebt, decimals)}`,
    );
    console.log(` - Is Active: ${reserveConf.isActive}`);
    console.log(` - Is Frozen: ${reserveConf.isFrozen}`);

    // Check for active balances
    if (
      (totalAToken && totalAToken !== 0n) ||
      (totalStableDebt && totalStableDebt !== 0n) ||
      (totalVariableDebt && totalVariableDebt !== 0n)
    ) {
      console.error(
        "❌ CRITICAL ERROR: Reserve appears to have active supply or borrows. DO NOT PROCEED.",
      );
      console.error(
        "   Dropping a reserve with active balances will likely result in LOST FUNDS.",
      );
      process.exit(1);
    } else {
      console.log("✅ Reserve appears to have zero supply and borrows.");
    }

    // Check for active/frozen status
    if (reserveConf.isActive) {
      console.warn(
        "⚠️ Warning: Reserve is still Active. It should be deactivated first.",
      );
    }

    if (!reserveConf.isFrozen) {
      console.warn(
        "⚠️ Warning: Reserve is not Frozen. It should be frozen first.",
      );
    }
  } catch (e) {
    console.error("❌ Error during pre-flight checks:", e);
    process.exit(1);
  }

  // Warning and confirmation delay
  console.log(
    `\n🚨🚨🚨 EXTREME DANGER ZONE 🚨🚨🚨` +
      `\n   Attempting to permanently DROP reserve ${assetAddress} using dropReserve().` +
      `\n   This action is IRREVERSIBLE and HIGHLY DESTRUCTIVE if prerequisites are not met.` +
      `\n   You MUST have manually verified:` +
      `\n     1. Reserve is deactivated and frozen.` +
      `\n     2. NO user supply exists (all aTokens redeemed).` +
      `\n     3. NO user borrows exist (all debt repaid).` +
      `\n     4. Any accrued treasury fees are claimed.` +
      `\n   Failure to meet these conditions WILL LIKELY LEAD TO FUND LOSS.`,
  );
  console.log("   Double-check the asset address, network, and consequences.");

  // Safety delay unless explicitly skipped
  if (
    !SKIP_SAFETY_DELAY ||
    (network.name !== "hardhat" && network.name !== "localhost")
  ) {
    console.log("   Pausing for 15 seconds to allow cancellation (Ctrl+C)...");
    await new Promise((resolve) => setTimeout(resolve, 15000)); // 15 second delay
  } else {
    console.log("   Safety delay skipped due to configuration.");
  }

  // Final checks and execution
  try {
    // Check POOL_ADMIN role
    const isAdmin = await aclManager.isPoolAdmin(deployerSigner.address);

    if (!isAdmin) {
      console.error(
        `❌ Error: Account ${deployerSigner.address} does not have the POOL_ADMIN role.`,
      );
      process.exit(1);
    }
    console.log(`✅ POOL_ADMIN role confirmed for ${deployerSigner.address}.`);

    // Execute dropReserve
    console.log(`\nSending transaction to dropReserve(${assetAddress})...`);
    const tx = await poolConfigurator.dropReserve(assetAddress);

    console.log(`Transaction sent: ${tx.hash}`);
    console.log("Waiting for transaction confirmation...");

    const receipt = await tx.wait();

    if (receipt) {
      console.log(`✅✅✅ SUCCESS: Reserve ${assetAddress} dropped.`);
      console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    } else {
      console.error("❌ Transaction failed or was not mined.");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Error dropping reserve:", error);
    process.exit(1);
  }

  console.log("\n--- Script finished ---");
}

// Helper to get token decimals
/**
 *
 * @param tokenAddress
 */
async function getTokenDecimals(tokenAddress: string): Promise<number> {
  try {
    const token = (await ethers.getContractAt(
      "IERC20Detailed",
      tokenAddress,
    )) as IERC20Detailed;
    const decimals = await token.decimals();
    return Number(decimals);
  } catch (e) {
    console.warn(
      `⚠️ Warning: Could not determine token decimals. Using default of 18.`,
    );
    return 18;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  });
