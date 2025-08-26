import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { tokenAddresses } = await getConfig(hre);

  const { address: collateralVaultAddress } = await hre.deployments.get(DUSD_COLLATERAL_VAULT_CONTRACT_ID);

  const { address: oracleAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);

  await hre.deployments.deploy(DUSD_AMO_MANAGER_ID, {
    from: deployer,
    args: [tokenAddresses.dUSD, collateralVaultAddress, oracleAddress],
    contract: "AmoManager",
    autoMine: true,
    log: false,
  });

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DUSD_AMO_MANAGER_ID;
func.tags = ["dusd"];
func.dependencies = [DUSD_TOKEN_ID, DUSD_COLLATERAL_VAULT_CONTRACT_ID];

export default func;
