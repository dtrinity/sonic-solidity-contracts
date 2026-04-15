import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_ORACLE_AGGREGATOR_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import { applyRedstoneRoutingPlan, buildUsdOracleRoutingPlan } from "../../typescript/oracle_aggregator/deploy-helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);
  const routingPlan = buildUsdOracleRoutingPlan(config.oracleAggregators.USD);

  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address);

  const redstoneWrapperDeployment = await hre.deployments.get(USD_REDSTONE_ORACLE_WRAPPER_ID);
  const redstoneWrapperWithThresholdingDeployment = await hre.deployments.get(USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID);
  const redstoneCompositeWrapperDeployment = await hre.deployments.get(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);

  await applyRedstoneRoutingPlan(routingPlan.redstone, oracleAggregator, {
    plainWrapper: redstoneWrapperDeployment.address,
    thresholdWrapper: redstoneWrapperWithThresholdingDeployment.address,
    compositeWrapper: redstoneCompositeWrapperDeployment.address,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-redstone-wrapper"];
func.dependencies = [
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
];
func.id = "point-usd-aggregator-to-redstone-wrappers";

export default func;
