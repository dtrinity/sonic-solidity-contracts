import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { PTTokenConfig } from "../../config/types";
import {
  PENDLE_PT_AUSDC_DECIMAL_CONVERTER_ID,
  PENDLE_PT_WSTKSCUSD_DECIMAL_CONVERTER_ID,
} from "../../typescript/deploy-ids";

/**
 * This script deploys ChainlinkDecimalConverter contracts for Pendle PT oracles.
 * Converts PT oracle prices from 18 decimals to 8 decimals for compatibility.
 *
 * Saved deployments:
 * - ChainlinkDecimalConverter_PT_aUSDC_14AUG2025 (converts 18→8 decimals)
 * - ChainlinkDecimalConverter_PT_wstkscUSD_18DEC2025 (converts 18→8 decimals)
 *
 * To reuse converter:
 * const converter = await hre.deployments.get("ChainlinkDecimalConverter_PT_aUSDC_14AUG2025");
 * const converterContract = await hre.ethers.getContractAt("ChainlinkDecimalConverter", converter.address);
 */

// Constants for decimal conversion
const EXPECTED_SOURCE_DECIMALS = 18;
const TARGET_DECIMALS = 8;

/**
 * Deploy ChainlinkDecimalConverter for PT oracles to convert from 18 to 8 decimals
 *
 * @param hre - Hardhat runtime environment
 * @param ptTokenConfigs - Configuration for PT tokens
 */
async function deployPendleDecimalConverters(
  hre: HardhatRuntimeEnvironment,
  ptTokenConfigs: PTTokenConfig[],
): Promise<{ ptToken: string; oracle: string; converter: string }[]> {
  const { deployer } = await hre.getNamedAccounts();
  const results = [];

  // Map PT token names to their converter IDs and oracle deployment names
  const converterConfigMap: Record<
    string,
    { converterId: string; oracleDeploymentName: string }
  > = {
    "PT-aUSDC-14AUG2025": {
      converterId: PENDLE_PT_AUSDC_DECIMAL_CONVERTER_ID,
      oracleDeploymentName:
        "PT-aUSDC-14AUG2025_PT_TO_ASSET_PendleChainlinkOracle",
    },
    "PT-wstkscUSD-18DEC2025": {
      converterId: PENDLE_PT_WSTKSCUSD_DECIMAL_CONVERTER_ID,
      oracleDeploymentName:
        "PT-wstkscUSD-18DEC2025_PT_TO_ASSET_PendleChainlinkOracle",
    },
  };

  for (const config of ptTokenConfigs) {
    console.log(`🔧 Processing decimal converter for ${config.name}...`);

    const converterConfig = converterConfigMap[config.name];

    if (!converterConfig) {
      console.warn(
        `⚠️  No converter config mapped for ${config.name}, skipping`,
      );
      continue;
    }

    // Get the deployed oracle address
    let oracleAddress: string;

    try {
      const oracleDeployment = await hre.deployments.get(
        converterConfig.oracleDeploymentName,
      );
      oracleAddress = oracleDeployment.address;
      console.log(`📊 Found oracle for ${config.name}: ${oracleAddress}`);
    } catch {
      console.warn(
        `⚠️  No oracle deployment found for ${config.name}, skipping converter`,
      );
      continue;
    }

    try {
      // Check if converter already exists
      const existingConverter = await hre.deployments.get(
        converterConfig.converterId,
      );
      console.log(
        `♻️  Using existing decimal converter for ${config.name}: ${existingConverter.address}`,
      );
      results.push({
        ptToken: config.ptToken,
        oracle: oracleAddress,
        converter: existingConverter.address,
      });
    } catch {
      // Converter doesn't exist, deploy it
      console.log(`🚀 Deploying decimal converter for ${config.name}...`);

      // Verify the source oracle has 18 decimals
      const pendleOracle = await hre.ethers.getContractAt(
        "@pendle/core-v2/contracts/oracles/PtYtLpOracle/chainlink/PendleChainlinkOracle.sol:PendleChainlinkOracle",
        oracleAddress,
      );

      const sourceDecimals = await pendleOracle.decimals();

      if (Number(sourceDecimals) !== EXPECTED_SOURCE_DECIMALS) {
        throw new Error(
          `Source oracle for ${config.name} has ${sourceDecimals} decimals, expected ${EXPECTED_SOURCE_DECIMALS}`,
        );
      }

      console.log(`✅ Verified source oracle has ${sourceDecimals} decimals`);

      // Deploy the ChainlinkDecimalConverter
      await hre.deployments.deploy(converterConfig.converterId, {
        from: deployer,
        args: [oracleAddress, TARGET_DECIMALS],
        contract: "ChainlinkDecimalConverter",
        autoMine: true,
        log: false,
      });

      const converterDeployment = await hre.deployments.get(
        converterConfig.converterId,
      );
      console.log(
        `✅ Deployed decimal converter for ${config.name}: ${converterDeployment.address}`,
      );
      console.log(
        `💾 Saved converter as deployment: ${converterConfig.converterId}`,
      );

      // Verify the converter has the correct target decimals
      const converter = await hre.ethers.getContractAt(
        "ChainlinkDecimalConverter",
        converterDeployment.address,
      );
      const targetDecimals = await converter.decimals();
      console.log(`✅ Verified converter has ${targetDecimals} decimals`);

      results.push({
        ptToken: config.ptToken,
        oracle: oracleAddress,
        converter: converterDeployment.address,
      });
    }
  }

  return results;
}

const func: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment,
): Promise<boolean> {
  const config = await getConfig(hre);

  console.log(`🔧 Deploying Pendle PT oracle decimal converters...`);

  // Check if Pendle configuration exists
  if (!config.pendle) {
    console.log(
      `⚠️  No Pendle configuration found for network ${hre.network.name}`,
    );
    console.log(`   Skipping Pendle PT decimal converter deployment`);
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

  // Deploy decimal converters for PT oracles (18 to 8 decimals)
  const deployedConverters = await deployPendleDecimalConverters(
    hre,
    pendle.ptTokens,
  );

  // Display summary of deployed converters
  console.log(`\n🔧 Deployed Decimal Converter Summary:`);

  for (const converter of deployedConverters) {
    const ptConfig = pendle.ptTokens.find(
      (c) => c.ptToken === converter.ptToken,
    );

    if (ptConfig) {
      const converterId =
        ptConfig.name === "PT-aUSDC-14AUG2025"
          ? PENDLE_PT_AUSDC_DECIMAL_CONVERTER_ID
          : PENDLE_PT_WSTKSCUSD_DECIMAL_CONVERTER_ID;
      console.log(`   • ${converterId}: ${converter.converter}`);
      console.log(
        `     └─ Converts from ${ptConfig.name} oracle (18 decimals) to 8 decimals`,
      );
      console.log(`     └─ Source oracle: ${converter.oracle}`);
    }
  }

  console.log(`🔧 Pendle PT decimal converter deployment completed: ✅`);
  console.log(`🔧 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["pendle", "pendle-decimal-converters"];
func.dependencies = ["PendleChainlinkOracles:PT-aUSDC:PT-wstkscUSD"];
func.id = "PendleDecimalConverters:PT-aUSDC:PT-wstkscUSD";

export default func;
