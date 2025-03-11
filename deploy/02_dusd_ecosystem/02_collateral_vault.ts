import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const { address: oracleAggregatorAddress } =
    await hre.deployments.get(ORACLE_AGGREGATOR_ID);

  await hre.deployments.deploy(DUSD_COLLATERAL_VAULT_CONTRACT_ID, {
    from: deployer,
    args: [oracleAggregatorAddress],
    contract: "CollateralHolderVault",
    autoMine: true,
    log: false,
  });

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = `dUSD:${DUSD_COLLATERAL_VAULT_CONTRACT_ID}`;
func.tags = ["dusd"];
func.dependencies = [ORACLE_AGGREGATOR_ID];

export default func;
