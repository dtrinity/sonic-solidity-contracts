import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { S_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  await hre.deployments.deploy(S_ORACLE_AGGREGATOR_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.S.baseCurrency, // wS token as base currency for S
      BigInt(10) ** BigInt(config.oracleAggregators.S.priceDecimals),
    ],
    contract: "OracleAggregator",
    autoMine: true,
    log: false,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["s-oracle", "oracle-aggregator", "s-oracle-aggregator"];
func.dependencies = [];
func.id = S_ORACLE_AGGREGATOR_ID;

export default func;
