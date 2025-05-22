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

  // Deploy RedeemerWithFees for dUSD
  const dUSDConfig = config.dStables.dUSD;

  if (
    dUSDConfig?.initialFeeReceiver &&
    dUSDConfig.initialRedemptionFeeBps !== undefined
  ) {
    const dUSDToken = await get(DUSD_TOKEN_ID);
    const dUSDCollateralVaultDeployment = await get(
      DUSD_COLLATERAL_VAULT_CONTRACT_ID,
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
      },
    );

    const collateralVaultContract = await hre.ethers.getContractAt(
      "CollateralVault",
      dUSDCollateralVaultDeployment.address,
      await hre.ethers.getSigner(deployer),
    );
    const withdrawerRole =
      await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
    const hasRole = await collateralVaultContract.hasRole(
      withdrawerRole,
      dUSDRedeemerWithFeesDeployment.address,
    );

    if (!hasRole) {
      await collateralVaultContract.grantRole(
        withdrawerRole,
        dUSDRedeemerWithFeesDeployment.address,
      );
      console.log("Role granted for dUSD RedeemerWithFees.");
    }
  } else {
    throw new Error("Fee receiver or fee BPS not configured in dStables.dUSD");
  }

  // Deploy RedeemerWithFees for dS
  const dSConfig = config.dStables.dS;

  if (
    dSConfig?.initialFeeReceiver &&
    dSConfig.initialRedemptionFeeBps !== undefined
  ) {
    const dSToken = await get(DS_TOKEN_ID);
    const dSCollateralVaultDeployment = await get(
      DS_COLLATERAL_VAULT_CONTRACT_ID,
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
      },
    );

    const collateralVaultContract = await hre.ethers.getContractAt(
      "CollateralVault",
      dSCollateralVaultDeployment.address,
      await hre.ethers.getSigner(deployer),
    );
    const withdrawerRole =
      await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
    const hasRole = await collateralVaultContract.hasRole(
      withdrawerRole,
      dSRedeemerWithFeesDeployment.address,
    );

    if (!hasRole) {
      await collateralVaultContract.grantRole(
        withdrawerRole,
        dSRedeemerWithFeesDeployment.address,
      );
      console.log("Role granted for dS RedeemerWithFees.");
    }
  } else {
    throw new Error("Fee receiver or fee BPS not configured in dStables.dS");
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
