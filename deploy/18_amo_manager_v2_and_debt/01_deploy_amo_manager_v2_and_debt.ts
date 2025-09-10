import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_AMO_DEBT_TOKEN_ID,
  DS_AMO_MANAGER_V2_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  DUSD_AMO_DEBT_TOKEN_ID,
  DUSD_AMO_MANAGER_V2_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

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
    },
    {
      name: "dS",
      tokenId: DS_TOKEN_ID,
      oracleId: S_ORACLE_AGGREGATOR_ID,
      collateralVaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerV2Id: DS_AMO_MANAGER_V2_ID,
      amoDebtTokenId: DS_AMO_DEBT_TOKEN_ID,
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

    // Step 2: Deploy AMO Manager V2
    console.log(`  🏛️ Deploying ${amoConfig.name} AMO Manager V2...`);

    // Initial configuration
    const amoMultisig = config.walletAddresses.governanceMultisig;
    const tolerance = ethers.parseUnits("1", 18); // 1 base unit tolerance

    const amoManagerDeployment = await deploy(amoConfig.amoManagerV2Id, {
      from: deployer,
      contract: "AmoManagerV2",
      args: [oracleDeployment.address, debtTokenDeployment.address, tokenDeployment.address, amoMultisig, tolerance],
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
  // Collateral Vaults
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
];
