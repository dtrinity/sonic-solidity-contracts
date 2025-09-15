import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DS_AMO_DEBT_TOKEN_ID,
  DS_HARD_PEG_ORACLE_WRAPPER_ID,
  DUSD_AMO_DEBT_TOKEN_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  // Configuration for both systems - reuse existing HardPegOracleWrappers
  const amoConfigs = [
    {
      name: "dUSD",
      debtTokenId: DUSD_AMO_DEBT_TOKEN_ID,
      oracleId: USD_ORACLE_AGGREGATOR_ID,
      hardPegOracleId: DUSD_HARD_PEG_ORACLE_WRAPPER_ID, // Reuse existing wrapper
    },
    {
      name: "dS",
      debtTokenId: DS_AMO_DEBT_TOKEN_ID,
      oracleId: S_ORACLE_AGGREGATOR_ID,
      hardPegOracleId: DS_HARD_PEG_ORACLE_WRAPPER_ID, // Reuse existing wrapper
    },
  ];

  for (const amoConfig of amoConfigs) {
    console.log(`\n🔮 Setting up oracle for ${amoConfig.name} AMO Debt Token...`);

    // Get the existing HardPegOracleWrapper deployment
    let hardPegDeployment;

    try {
      hardPegDeployment = await deployments.get(amoConfig.hardPegOracleId);
      console.log(`  ✅ Using existing HardPegOracleWrapper at ${hardPegDeployment.address}`);
    } catch {
      console.log(`  ⚠️  HardPegOracleWrapper ${amoConfig.hardPegOracleId} not found`);
      console.log(`     Please ensure the dStable deployment has been run first`);
      continue;
    }

    // Get OracleAggregator contract
    const oracleDeployment = await deployments.get(amoConfig.oracleId);
    const oracleAggregator = await ethers.getContractAt(
      "OracleAggregator",
      oracleDeployment.address,
      await ethers.getSigner(deployer),
    );

    // Get the debt token deployment
    const debtTokenDeployment = await deployments.get(amoConfig.debtTokenId);

    // Check if ORACLE_MANAGER_ROLE is granted to deployer
    const ORACLE_MANAGER_ROLE = await oracleAggregator.ORACLE_MANAGER_ROLE();
    const hasRole = await oracleAggregator.hasRole(ORACLE_MANAGER_ROLE, deployer);

    if (!hasRole) {
      console.log(`  ⚠️  Deployer doesn't have ORACLE_MANAGER_ROLE on ${amoConfig.name} oracle aggregator`);
      console.log(`     This role is needed to set the oracle for the debt token`);
      console.log(`     The governance multisig will need to execute this step`);
      continue;
    }

    // Set the HardPegOracleWrapper as the oracle for the debt token
    try {
      const currentOracle = await oracleAggregator.assetOracles(debtTokenDeployment.address);

      if (currentOracle === hardPegDeployment.address) {
        console.log(`  ✅ HardPegOracleWrapper already set for ${amoConfig.name} debt token`);
      } else {
        console.log(`  📊 Setting HardPegOracleWrapper for ${amoConfig.name} debt token...`);
        const tx = await oracleAggregator.setOracle(debtTokenDeployment.address, hardPegDeployment.address);
        await tx.wait();
        console.log(`  ✅ Set HardPegOracleWrapper as oracle for ${amoConfig.name} debt token`);
      }

      // Verify the price is correct
      const price = await oracleAggregator.getAssetPrice(debtTokenDeployment.address);
      const baseCurrencyUnit = await oracleAggregator.BASE_CURRENCY_UNIT();

      if (price === baseCurrencyUnit) {
        console.log(`  ✅ Verified: ${amoConfig.name} debt token price is correctly set to 1.0`);
      } else {
        console.log(`  ⚠️  Warning: ${amoConfig.name} debt token price is ${price}, expected ${baseCurrencyUnit}`);
      }
    } catch (error: any) {
      if (error.message?.includes("OracleNotSet")) {
        console.log(`  ℹ️  Oracle not yet set for ${amoConfig.name} debt token (expected on first run)`);
      } else {
        console.log(`  ⚠️  Error setting oracle: ${error.message}`);
      }
    }
  }

  console.log(`\n🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["amo-v2"];
func.dependencies = ["amo-v2-deploy"];
func.id = "AmoDebtTokenOracleSetup";

export default func;
