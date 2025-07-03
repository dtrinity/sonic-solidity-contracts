import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { PTTokenConfig } from "../../config/types";
import { PENDLE_CHAINLINK_ORACLE_FACTORY_ID } from "../../typescript/deploy-ids";

/**
 * This script deploys a PendleChainlinkOracleFactory and PendleChainlinkOracle contracts.
 *
 * Saved deployments:
 * 1. PendleChainlinkOracleFactory (reusable factory)
 * 2. Individual oracles with naming: {assetName}_{oracleType}_PendleChainlinkOracle
 *
 * Examples:
 * - PT-aUSDC-14AUG2025_PT_TO_ASSET_PendleChainlinkOracle
 * - PT-wstkscUSD-18DEC2025_PT_TO_SY_PendleChainlinkOracle
 *
 * To reuse factory:
 * const factory = await hre.deployments.get("PendleChainlinkOracleFactory");
 * const factoryContract = await hre.ethers.getContractAt("PendleChainlinkOracleFactory", factory.address);
 *
 * To reuse oracle:
 * const oracle = await hre.deployments.get("PT-aUSDC-14AUG2025_PT_TO_ASSET_PendleChainlinkOracle");
 * const oracleContract = await hre.ethers.getContractAt("PendleChainlinkOracle", oracle.address);
 */

// Pendle Oracle Type constants (from @pendle/core-v2)
const PENDLE_ORACLE_TYPE = {
  PT_TO_SY: 0,
  PT_TO_ASSET: 1,
} as const;

/**
 * Calculate required cardinality based on TWAP duration and network block time
 *
 * @param duration - TWAP duration in seconds
 */
function calculateCardinalityRequired(duration: number): number {
  // Always use block time = 1 for supported networks
  return Math.ceil(duration / 1);
}

/**
 * Deploy PendleChainlinkOracleFactory if not already deployed
 *
 * @param hre - Hardhat runtime environment
 * @param ptYtLpOracleAddress - Address of the PT/YT/LP Oracle
 */
async function deployPendleOracleFactory(
  hre: HardhatRuntimeEnvironment,
  ptYtLpOracleAddress: string,
): Promise<string> {
  const { deployer } = await hre.getNamedAccounts();

  // Check if factory is already deployed
  try {
    const existingFactory = await hre.deployments.get(
      PENDLE_CHAINLINK_ORACLE_FACTORY_ID,
    );
    console.log(
      `🏭 Using existing PendleChainlinkOracleFactory: ${existingFactory.address}`,
    );
    return existingFactory.address;
  } catch {
    // Factory not deployed yet, deploy it
    console.log(
      `🚀 Deploying PendleChainlinkOracleFactory with ptYtLpOracle: ${ptYtLpOracleAddress}`,
    );

    await hre.deployments.deploy(PENDLE_CHAINLINK_ORACLE_FACTORY_ID, {
      from: deployer,
      args: [ptYtLpOracleAddress],
      contract:
        "@pendle/core-v2/contracts/oracles/PtYtLpOracle/chainlink/PendleChainlinkOracleFactory.sol:PendleChainlinkOracleFactory",
      autoMine: true,
      log: false,
    });

    const factoryDeployment = await hre.deployments.get(
      PENDLE_CHAINLINK_ORACLE_FACTORY_ID,
    );
    console.log(
      `✅ Deployed PendleChainlinkOracleFactory: ${factoryDeployment.address}`,
    );
    console.log(
      `💾 Saved factory as deployment: ${PENDLE_CHAINLINK_ORACLE_FACTORY_ID}`,
    );

    return factoryDeployment.address;
  }
}

/**
 * Check oracle readiness status
 *
 * @param ptYtLpOracle - The main Pendle oracle for state checking
 * @param market - Market address for the oracle
 * @param duration - TWAP duration in seconds
 */
async function checkPendleOracleReady(
  ptYtLpOracle: any,
  market: string,
  duration: number,
): Promise<{ ready: boolean; needsInit: boolean; needsWait: boolean }> {
  try {
    const [increaseCardinalityRequired, , oldestObservationSatisfied] =
      await ptYtLpOracle.getOracleState(market, duration);

    return {
      ready: !increaseCardinalityRequired && oldestObservationSatisfied,
      needsInit: increaseCardinalityRequired,
      needsWait: !oldestObservationSatisfied,
    };
  } catch {
    console.warn(`⚠️  Could not check oracle readiness for ${market}`);
    return { ready: false, needsInit: true, needsWait: false };
  }
}

/**
 * Deploy PendleChainlinkOracle contracts for PT tokens using our deployed factory
 * Returns array of deployed oracle information with verification
 *
 * @param hre - Hardhat runtime environment
 * @param ptTokenConfigs - Configuration for PT tokens
 * @param factoryAddress - Address of the deployed factory
 * @param ptYtLpOracleAddress - Address of the PT/YT/LP Oracle
 */
async function deployPendleChainlinkOracles(
  hre: HardhatRuntimeEnvironment,
  ptTokenConfigs: PTTokenConfig[],
  factoryAddress: string,
  ptYtLpOracleAddress: string,
): Promise<
  { ptToken: string; oracle: string; market: string; needsWait: boolean }[]
> {
  const { ethers } = hre;
  const results = [];

  // Step 1: Use our deployed PendleChainlinkOracleFactory
  console.log(`🏭 Using PendleChainlinkOracleFactory at: ${factoryAddress}`);

  const pendleOracleFactory = await ethers.getContractAt(
    "@pendle/core-v2/contracts/oracles/PtYtLpOracle/chainlink/PendleChainlinkOracleFactory.sol:PendleChainlinkOracleFactory",
    factoryAddress,
  );

  // Step 2: Get the main Pendle oracle for state checking
  const ptYtLpOracle = await ethers.getContractAt(
    "@pendle/core-v2/contracts/interfaces/IPPYLpOracle.sol:IPPYLpOracle",
    ptYtLpOracleAddress,
  );

  // Step 3: Create oracles for each PT token (or reuse existing)
  for (const config of ptTokenConfigs) {
    console.log(`🔍 Processing PendleChainlinkOracle for ${config.name}...`);

    // Check if oracle deployment already exists
    const assetName = config.name;
    const deploymentName = `${assetName}_${config.oracleType}_PendleChainlinkOracle`;
    let ptOracleAddress: string;

    try {
      // Try to get existing deployment
      const existingDeployment = await hre.deployments.get(deploymentName);
      ptOracleAddress = existingDeployment.address;
      console.log(
        `♻️  Using existing PendleChainlinkOracle for ${config.name}: ${ptOracleAddress}`,
      );
    } catch {
      // Oracle doesn't exist, need to create it
      console.log(
        `🚀 Creating new PendleChainlinkOracle for ${config.name}...`,
      );

      // Check if market oracle needs initialization
      const oracleStatus = await checkPendleOracleReady(
        ptYtLpOracle,
        config.market,
        config.twapDuration,
      );

      if (oracleStatus.needsInit) {
        console.log(`🔧 Initializing market oracle for ${config.market}...`);
        const cardinality = calculateCardinalityRequired(config.twapDuration);

        try {
          const market = await ethers.getContractAt(
            "@pendle/core-v2/contracts/interfaces/IPMarket.sol:IPMarket",
            config.market,
          );
          await market.increaseObservationsCardinalityNext(cardinality);

          console.log(
            `⏳ Oracle initialized. TWAP data will be available in ${config.twapDuration}s`,
          );
        } catch (error) {
          console.error(
            `❌ Failed to initialize oracle for ${config.market}: ${error}`,
          );
          throw error;
        }
      }

      // Create PendleChainlinkOracle using factory
      try {
        const oracleTypeValue =
          config.oracleType === "PT_TO_ASSET"
            ? PENDLE_ORACLE_TYPE.PT_TO_ASSET
            : PENDLE_ORACLE_TYPE.PT_TO_SY;

        // First get the oracle address that would be created (without executing)
        ptOracleAddress = await pendleOracleFactory.createOracle.staticCall(
          config.market,
          config.twapDuration,
          oracleTypeValue,
        );

        // Now actually execute the transaction to create the oracle
        const createOracleTx = await pendleOracleFactory.createOracle(
          config.market,
          config.twapDuration,
          oracleTypeValue,
        );

        // Wait for transaction to be mined
        await createOracleTx.wait();

        console.log(
          `✅ Created PendleChainlinkOracle for ${config.name}: ${ptOracleAddress}`,
        );

        // Save the deployed oracle with proper naming convention for reuse
        // Get the contract artifact for saving
        const PendleChainlinkOracleArtifact = await hre.artifacts.readArtifact(
          "@pendle/core-v2/contracts/oracles/PtYtLpOracle/chainlink/PendleChainlinkOracle.sol:PendleChainlinkOracle",
        );

        // Save the deployment for later reuse
        await hre.deployments.save(deploymentName, {
          address: ptOracleAddress,
          abi: PendleChainlinkOracleArtifact.abi,
          bytecode: PendleChainlinkOracleArtifact.bytecode,
          deployedBytecode: PendleChainlinkOracleArtifact.deployedBytecode,
          metadata: JSON.stringify({
            ptToken: config.ptToken,
            market: config.market,
            twapDuration: config.twapDuration,
            oracleType: config.oracleType,
            createdViaFactory: factoryAddress,
            ptYtLpOracleAddress: ptYtLpOracleAddress,
          }),
        });

        console.log(`💾 Saved oracle as deployment: ${deploymentName}`);
      } catch (error) {
        console.error(
          `❌ Failed to create oracle for ${config.name}: ${error}`,
        );
        throw error;
      }
    }

    // Check current oracle readiness status (for both existing and new oracles)
    const oracleStatus = await checkPendleOracleReady(
      ptYtLpOracle,
      config.market,
      config.twapDuration,
    );

    // Create contract instance to verify price
    const pendleChainlinkOracle = await ethers.getContractAt(
      "@pendle/core-v2/contracts/oracles/PtYtLpOracle/chainlink/PendleChainlinkOracle.sol:PendleChainlinkOracle",
      ptOracleAddress,
    );

    // Verify oracle configuration and attempt to get price
    try {
      // Check oracle configuration using individual functions from ABI
      const market = await pendleChainlinkOracle.market();
      const twapDuration = await pendleChainlinkOracle.twapDuration();
      const baseOracleType = await pendleChainlinkOracle.baseOracleType();
      const factory = await pendleChainlinkOracle.factory();

      console.log(
        `📊 Oracle config - Market: ${market}, Duration: ${twapDuration}s, Type: ${baseOracleType}, Factory: ${factory}`,
      );

      // Attempt to get latest price (only if oracle is ready)
      if (!oracleStatus.needsWait && !oracleStatus.needsInit) {
        try {
          const decimals = await pendleChainlinkOracle.decimals();

          // Also get round data for more details
          const latestRoundData = await pendleChainlinkOracle.latestRoundData();
          const priceFormatted =
            Number(latestRoundData.answer) / 10 ** Number(decimals);
          console.log(
            `💰 Current price from oracle: ${priceFormatted} (${latestRoundData.answer} with ${decimals} decimals)`,
          );
          console.log(
            `📈 Round ${latestRoundData.roundId}: Answer=${latestRoundData.answer}, UpdatedAt=${new Date(Number(latestRoundData.updatedAt) * 1000).toISOString()}`,
          );
        } catch (priceError) {
          console.warn(
            `⚠️  Could not get price from oracle (expected if TWAP not ready): ${priceError}`,
          );
        }
      } else {
        console.log(
          `⏳ Oracle not ready for price queries yet (needs ${oracleStatus.needsInit ? "initialization" : "TWAP data"})`,
        );
      }
    } catch (configError) {
      console.warn(`⚠️  Could not verify oracle configuration: ${configError}`);
    }

    results.push({
      ptToken: config.ptToken,
      oracle: ptOracleAddress,
      market: config.market,
      needsWait: oracleStatus.needsInit || oracleStatus.needsWait,
    });
  }

  return results;
}

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const config = await getConfig(hre);

  console.log(`🔮 Deploying Pendle PT oracles...`);

  // Check if Pendle configuration exists
  if (!config.pendle) {
    console.log(
      `⚠️  No Pendle configuration found for network ${hre.network.name}`,
    );
    console.log(`   Skipping Pendle PT oracle deployment`);
    return true;
  }

  const { pendle } = config;

  // Validate PT token configurations
  for (const ptConfig of pendle.ptTokens) {
    if (ptConfig.ptToken === "0x" || ptConfig.market === "0x") {
      console.error(
        `❌ Missing PT token or market address for ${ptConfig.name}`,
      );
      console.error(
        `   Please update Pendle configuration in config/networks/${hre.network.name}.ts`,
      );
      throw new Error(`Missing configuration for ${ptConfig.name}`);
    }
  }

  // Check if oracle address is configured
  if (!pendle.ptYtLpOracleAddress || pendle.ptYtLpOracleAddress === "0x") {
    console.error(
      `❌ ptYtLpOracleAddress not configured for network ${hre.network.name}`,
    );
    console.error(
      `   Please update Pendle configuration in config/networks/${hre.network.name}.ts`,
    );
    throw new Error("PT/YT/LP Oracle address not configured");
  }

  // Deploy PendleChainlinkOracleFactory first
  const factoryAddress = await deployPendleOracleFactory(
    hre,
    pendle.ptYtLpOracleAddress,
  );

  // Deploy PendleChainlinkOracle contracts using our factory
  const deployedOracles = await deployPendleChainlinkOracles(
    hre,
    pendle.ptTokens,
    factoryAddress,
    pendle.ptYtLpOracleAddress,
  );

  if (deployedOracles.some((o) => o.needsWait)) {
    console.log(`🕐 Note: Some PT oracles need time to accumulate TWAP data`);
    console.log(`   Prices will become available within 15-30 minutes`);
  }

  // Display summary of saved deployments
  console.log(`\n📋 Deployed Oracle Summary:`);

  // Show factory first
  try {
    const factoryDeployment = await hre.deployments.get(
      PENDLE_CHAINLINK_ORACLE_FACTORY_ID,
    );
    console.log(
      `   • ${PENDLE_CHAINLINK_ORACLE_FACTORY_ID}: ${factoryDeployment.address}`,
    );
  } catch {
    console.warn(`   • ${PENDLE_CHAINLINK_ORACLE_FACTORY_ID}: Not found`);
  }

  // Show individual oracles
  for (const ptConfig of pendle.ptTokens) {
    const assetName = ptConfig.name;
    const deploymentName = `${assetName}_${ptConfig.oracleType}_PendleChainlinkOracle`;

    try {
      const deployment = await hre.deployments.get(deploymentName);
      console.log(`   • ${deploymentName}: ${deployment.address}`);
    } catch {
      console.warn(
        `   • ${deploymentName}: Not found (deployment may have failed)`,
      );
    }
  }

  console.log(`🔮 Pendle PT oracle deployment completed: ✅`);
  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["pendle", "pendle-pt-oracles"];
func.dependencies = [];
func.id = "PendleChainlinkOracles:PT-aUSDC:PT-wstkscUSD";

export default func;
