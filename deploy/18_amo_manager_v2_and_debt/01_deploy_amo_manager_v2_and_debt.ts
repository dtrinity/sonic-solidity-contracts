import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DS_AMO_DEBT_TOKEN_ID,
  DS_AMO_MANAGER_V2_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_HARD_PEG_ORACLE_WRAPPER_ID,
  DS_TOKEN_ID,
  DUSD_AMO_DEBT_TOKEN_ID,
  DUSD_AMO_MANAGER_V2_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  DUSD_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  // Configuration for both dUSD and dS AMO systems
  const amoConfigs = [
    {
      name: "dUSD",
      tokenId: DUSD_TOKEN_ID,
      oracleId: USD_ORACLE_AGGREGATOR_ID,
      collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerV2Id: DUSD_AMO_MANAGER_V2_ID,
      amoDebtTokenId: DUSD_AMO_DEBT_TOKEN_ID,
      hardPegOracleId: DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
    },
    {
      name: "dS",
      tokenId: DS_TOKEN_ID,
      oracleId: S_ORACLE_AGGREGATOR_ID,
      collateralVaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerV2Id: DS_AMO_MANAGER_V2_ID,
      amoDebtTokenId: DS_AMO_DEBT_TOKEN_ID,
      hardPegOracleId: DS_HARD_PEG_ORACLE_WRAPPER_ID,
    },
  ];

  for (const amoConfig of amoConfigs) {
    console.log(`\n🔄 Deploying AMO system for ${amoConfig.name}...`);

    // Get required deployments
    const tokenDeployment = await deployments.get(amoConfig.tokenId);
    const oracleDeployment = await deployments.get(amoConfig.oracleId);
    const collateralVaultDeployment = await deployments.get(amoConfig.collateralVaultId);

    console.log(`  📄 Dependencies:`);
    console.log(`    Token: ${tokenDeployment.address}`);
    console.log(`    Oracle: ${oracleDeployment.address}`);
    console.log(`    Collateral Vault: ${collateralVaultDeployment.address}`);

    // Step 1: Deploy AMO Debt Token
    console.log(`  🪙 Deploying ${amoConfig.name} AMO Debt Token...`);

    // Token name is always "dTRINITY AMO Receipt"
    // Token symbol is "amo-dUSD" for dUSD or "amo-dS" for dS
    const tokenName = "dTRINITY AMO Receipt";
    const tokenSymbol = `amo-${amoConfig.name}`;

    const debtTokenDeployment = await deploy(amoConfig.amoDebtTokenId, {
      from: deployer,
      contract: "AmoDebtToken",
      args: [tokenName, tokenSymbol],
      log: true,
      autoMine: true,
    });

    // Step 1.5: Register the debt token with a hard peg oracle before deploying the manager
    try {
      console.log(`  🔧 Ensuring oracle entry for ${amoConfig.name} debt token...`);
      const hardPegDeployment = await deployments.get(amoConfig.hardPegOracleId);
      const deployerSigner = await hre.ethers.getSigner(deployer);
      const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleDeployment.address, deployerSigner);
      const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
      const hasRole = await oracleAggregator.hasRole(oracleManagerRole, deployer);

      if (!hasRole) {
        console.log(
          `  ⚠️  Deployer is missing ORACLE_MANAGER_ROLE on ${amoConfig.name} oracle aggregator. ` +
            `Please grant role before rerunning or complete oracle registration manually.`,
        );
      } else {
        const currentOracle = await oracleAggregator.assetOracles(debtTokenDeployment.address);

        if (currentOracle !== hardPegDeployment.address) {
          const tx = await oracleAggregator.setOracle(debtTokenDeployment.address, hardPegDeployment.address);
          await tx.wait();
          console.log(`  ✅ Set hard peg oracle for ${amoConfig.name} debt token`);
        } else {
          console.log(`  ✅ Hard peg oracle already configured for ${amoConfig.name} debt token`);
        }
      }
    } catch (error) {
      console.log(`  ⚠️  Unable to configure hard peg oracle before manager deployment: ${(error as Error).message}`);
      console.log(`     Manager deployment may revert if oracle remains unset.`);
    }

    // Step 2: Deploy AMO Manager V2
    console.log(`  🏛️ Deploying ${amoConfig.name} AMO Manager V2...`);

    const amoManagerDeployment = await deploy(amoConfig.amoManagerV2Id, {
      from: deployer,
      contract: "AmoManagerV2",
      args: [oracleDeployment.address, debtTokenDeployment.address, tokenDeployment.address, collateralVaultDeployment.address],
      log: true,
      autoMine: true,
    });

    console.log(`  ✅ ${amoConfig.name} AMO system deployed:`);
    console.log(`    Debt Token: ${debtTokenDeployment.address}`);
    console.log(`    Manager V2: ${amoManagerDeployment.address}`);
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.id = "01_deploy_amo_manager_v2_and_debt";
func.tags = ["amo-debt-system", "amo-manager-v2"];
func.dependencies = [
  // Tokens
  DUSD_TOKEN_ID,
  DS_TOKEN_ID,
  // Oracles
  USD_ORACLE_AGGREGATOR_ID,
  S_ORACLE_AGGREGATOR_ID,
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  DS_HARD_PEG_ORACLE_WRAPPER_ID,
  // Collateral Vaults
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
];
