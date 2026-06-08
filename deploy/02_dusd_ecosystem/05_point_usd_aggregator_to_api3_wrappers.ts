import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { applyApi3RoutingPlan, buildUsdOracleRoutingPlan } from "../../typescript/oracle_aggregator/deploy-helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const config = await getConfig(hre);
  const routingPlan = buildUsdOracleRoutingPlan(config.oracleAggregators.USD);

  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address);

  const api3WrapperDeployment = await hre.deployments.get(USD_API3_ORACLE_WRAPPER_ID);
  const api3WrapperWithThresholdingDeployment = await hre.deployments.get(USD_API3_WRAPPER_WITH_THRESHOLDING_ID);
  const api3CompositeWrapperDeployment = await hre.deployments.get(USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID);

  await applyApi3RoutingPlan(routingPlan.api3, oracleAggregator, {
    plainWrapper: api3WrapperDeployment.address,
    thresholdWrapper: api3WrapperWithThresholdingDeployment.address,
    compositeWrapper: api3CompositeWrapperDeployment.address,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-oracle-wrapper"];
func.dependencies = [
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_ORACLE_AGGREGATOR_ID,
];
func.id = "point-usd-aggregator-to-api3-wrappers";

export default func;
