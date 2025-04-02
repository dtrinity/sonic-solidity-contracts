import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { tokenAddresses } = await getConfig(hre);

  const { address: collateralVaultAddress } = await hre.deployments.get(
    DS_COLLATERAL_VAULT_CONTRACT_ID,
  );

  const { address: oracleAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );

  await hre.deployments.deploy(DS_AMO_MANAGER_ID, {
    from: deployer,
    args: [tokenAddresses.dS, collateralVaultAddress, oracleAddress],
    contract: "AmoManager",
    autoMine: true,
    log: false,
  });

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DS_AMO_MANAGER_ID;
func.tags = ["ds"];
func.dependencies = [
  DS_TOKEN_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  S_ORACLE_AGGREGATOR_ID,
];

export default func;
