import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  await hre.deployments.deploy(ORACLE_AGGREGATOR_ID, {
    from: deployer,
    args: [BigInt(10) ** BigInt(config.oracleAggregator.priceDecimals)],
    contract: "OracleAggregator",
    autoMine: true,
    log: false,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["oracle-aggregator"];
func.dependencies = ["oracle-wrapper"];
func.id = ORACLE_AGGREGATOR_ID;

export default func;
