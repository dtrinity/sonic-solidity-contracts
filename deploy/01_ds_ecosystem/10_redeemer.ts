import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_REDEEMER_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );

  const { address: collateralVaultAddress } = await hre.deployments.get(
    DS_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const collateralVault = await hre.ethers.getContractAt(
    "CollateralHolderVault",
    collateralVaultAddress,
    await hre.ethers.getSigner(deployer),
  );
  const { tokenAddresses } = await getConfig(hre);

  const deployment = await hre.deployments.deploy(DS_REDEEMER_CONTRACT_ID, {
    from: deployer,
    args: [collateralVaultAddress, tokenAddresses.dS, oracleAggregatorAddress],
    contract: "Redeemer",
    autoMine: true,
    log: false,
  });

  console.log("Allowing Redeemer to withdraw collateral");
  await collateralVault.grantRole(
    await collateralVault.COLLATERAL_WITHDRAWER_ROLE(),
    deployment.address,
  );

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DS_REDEEMER_CONTRACT_ID;
func.tags = ["ds"];
func.dependencies = [DS_COLLATERAL_VAULT_CONTRACT_ID, DS_TOKEN_ID, "s-oracle"];

export default func;
