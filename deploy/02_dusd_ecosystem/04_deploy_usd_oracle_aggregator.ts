import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  // Deploy the USD-specific OracleAggregator
  await hre.deployments.deploy(USD_ORACLE_AGGREGATOR_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.USD.baseCurrency, // USD as base currency (address 0)
      BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals),
    ],
    contract: "OracleAggregator",
    autoMine: true,
    log: false,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "usd-oracle-aggregator"];
func.dependencies = [];
func.id = "deploy-usd-oracle-aggregator";

export default func;
