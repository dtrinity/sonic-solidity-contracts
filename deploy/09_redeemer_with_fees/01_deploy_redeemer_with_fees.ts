import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_REDEEMER_WITH_FEES_CONTRACT_ID,
  DS_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_WITH_FEES_CONTRACT_ID,
  DUSD_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;
  const config = await getConfig(hre);

  // Check all required configuration values at the top
  const dUSDConfig = config.dStables.dUSD;
  const dSConfig = config.dStables.dS;

  const missingConfigs: string[] = [];

  // Check dUSD configuration
  if (!dUSDConfig?.initialFeeReceiver) {
    missingConfigs.push("dStables.dUSD.initialFeeReceiver");
  }
  if (dUSDConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dUSD.initialRedemptionFeeBps");
  }

  // Check dS configuration
  if (!dSConfig?.initialFeeReceiver) {
    missingConfigs.push("dStables.dS.initialFeeReceiver");
  }
  if (dSConfig?.initialRedemptionFeeBps === undefined) {
    missingConfigs.push("dStables.dS.initialRedemptionFeeBps");
  }

  // If any required config values are missing, skip deployment
  if (missingConfigs.length > 0) {
    console.log(
      `⚠️  Skipping RedeemerWithFees deployment - missing configuration values: ${missingConfigs.join(", ")}`
    );
    console.log(
      `☯️  ${__filename.split("/").slice(-2).join("/")}: ⏭️  (skipped)`
    );
    return true;
  }

  // Deploy RedeemerWithFees for dUSD
  const dUSDToken = await get(DUSD_TOKEN_ID);
  const dUSDCollateralVaultDeployment = await get(
    DUSD_COLLATERAL_VAULT_CONTRACT_ID
  );
  const usdOracleAggregator = await get(USD_ORACLE_AGGREGATOR_ID);

  const dUSDRedeemerWithFeesDeployment = await deploy(
    DUSD_REDEEMER_WITH_FEES_CONTRACT_ID,
    {
      from: deployer,
      contract: "RedeemerWithFees",
      args: [
        dUSDCollateralVaultDeployment.address,
        dUSDToken.address,
        usdOracleAggregator.address,
        dUSDConfig.initialFeeReceiver,
        dUSDConfig.initialRedemptionFeeBps,
      ],
    }
  );

  const dUSDCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dUSDCollateralVaultDeployment.address,
    await hre.ethers.getSigner(deployer)
  );
  const dUSDWithdrawerRole =
    await dUSDCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dUSDHasRole = await dUSDCollateralVaultContract.hasRole(
    dUSDWithdrawerRole,
    dUSDRedeemerWithFeesDeployment.address
  );

  if (!dUSDHasRole) {
    await dUSDCollateralVaultContract.grantRole(
      dUSDWithdrawerRole,
      dUSDRedeemerWithFeesDeployment.address
    );
    console.log("Role granted for dUSD RedeemerWithFees.");
  }

  // Deploy RedeemerWithFees for dS
  const dSToken = await get(DS_TOKEN_ID);
  const dSCollateralVaultDeployment = await get(
    DS_COLLATERAL_VAULT_CONTRACT_ID
  );
  const sOracleAggregator = await get(S_ORACLE_AGGREGATOR_ID);

  const dSRedeemerWithFeesDeployment = await deploy(
    DS_REDEEMER_WITH_FEES_CONTRACT_ID,
    {
      from: deployer,
      contract: "RedeemerWithFees",
      args: [
        dSCollateralVaultDeployment.address,
        dSToken.address,
        sOracleAggregator.address,
        dSConfig.initialFeeReceiver,
        dSConfig.initialRedemptionFeeBps,
      ],
    }
  );

  const dSCollateralVaultContract = await hre.ethers.getContractAt(
    "CollateralVault",
    dSCollateralVaultDeployment.address,
    await hre.ethers.getSigner(deployer)
  );
  const dSWithdrawerRole =
    await dSCollateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
  const dSHasRole = await dSCollateralVaultContract.hasRole(
    dSWithdrawerRole,
    dSRedeemerWithFeesDeployment.address
  );

  if (!dSHasRole) {
    await dSCollateralVaultContract.grantRole(
      dSWithdrawerRole,
      dSRedeemerWithFeesDeployment.address
    );
    console.log("Role granted for dS RedeemerWithFees.");
  }

  console.log(`☯️  ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "deploy_redeemer_with_fees";
func.tags = ["dstable", "redeemerWithFees"];
func.dependencies = [
  DUSD_TOKEN_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  USD_ORACLE_AGGREGATOR_ID,
  DS_TOKEN_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  S_ORACLE_AGGREGATOR_ID,
];

export default func;
