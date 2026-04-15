import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_TOKEN_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_API3_ORACLE_WRAPPER_ID,
  USD_API3_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import { applyApi3SetupPlan, buildUsdOracleSetupPlan } from "../../typescript/oracle_aggregator/deploy-helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const setupPlan = buildUsdOracleSetupPlan(config.oracleAggregators.USD);
  const baseCurrencyUnit = BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);
  const baseCurrency = config.oracleAggregators.USD.baseCurrency;

  const api3WrapperDeployment = await hre.deployments.deploy(USD_API3_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "API3Wrapper",
    autoMine: true,
    log: false,
  });

  const api3Wrapper = await hre.ethers.getContractAt("API3Wrapper", api3WrapperDeployment.address);

  const api3WrapperWithThresholdingDeployment = await hre.deployments.deploy(USD_API3_WRAPPER_WITH_THRESHOLDING_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "API3WrapperWithThresholding",
    autoMine: true,
    log: false,
  });

  const api3WrapperWithThresholding = await hre.ethers.getContractAt(
    "API3WrapperWithThresholding",
    api3WrapperWithThresholdingDeployment.address,
  );

  const api3CompositeWrapperDeployment = await hre.deployments.deploy(USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "API3CompositeWrapperWithThresholding",
    autoMine: true,
    log: false,
  });

  const api3CompositeWrapper = await hre.ethers.getContractAt(
    "API3CompositeWrapperWithThresholding",
    api3CompositeWrapperDeployment.address,
  );

  await applyApi3SetupPlan(
    setupPlan.api3,
    {
      plainWrapper: api3Wrapper,
      thresholdWrapper: api3WrapperWithThresholding,
      compositeWrapper: api3CompositeWrapper,
    },
    baseCurrencyUnit,
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-api3-oracle-wrapper"];
func.dependencies = [DS_TOKEN_ID];
func.id = "setup-usd-api3-oracle-wrappers";

export default func;
