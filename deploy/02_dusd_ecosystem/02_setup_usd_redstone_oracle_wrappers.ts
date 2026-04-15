import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  USD_REDSTONE_ORACLE_WRAPPER_ID,
  USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../typescript/deploy-ids";
import { applyRedstoneSetupPlan, buildUsdOracleSetupPlan } from "../../typescript/oracle_aggregator/deploy-helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const setupPlan = buildUsdOracleSetupPlan(config.oracleAggregators.USD);
  const baseCurrencyUnit = BigInt(10) ** BigInt(config.oracleAggregators.USD.priceDecimals);
  const baseCurrency = config.oracleAggregators.USD.baseCurrency;

  const redstoneWrapperDeployment = await hre.deployments.deploy(USD_REDSTONE_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "RedstoneChainlinkWrapper",
    autoMine: true,
    log: false,
  });

  const redstoneWrapper = await hre.ethers.getContractAt("RedstoneChainlinkWrapper", redstoneWrapperDeployment.address);

  const redstoneWrapperWithThresholdingDeployment = await hre.deployments.deploy(USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "RedstoneChainlinkWrapperWithThresholding",
    autoMine: true,
    log: false,
  });

  const redstoneWrapperWithThresholding = await hre.ethers.getContractAt(
    "RedstoneChainlinkWrapperWithThresholding",
    redstoneWrapperWithThresholdingDeployment.address,
  );

  const redstoneCompositeWrapperDeployment = await hre.deployments.deploy(USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID, {
    from: deployer,
    args: [baseCurrency, baseCurrencyUnit],
    contract: "RedstoneChainlinkCompositeWrapperWithThresholding",
    autoMine: true,
    log: false,
  });

  const redstoneCompositeWrapper = await hre.ethers.getContractAt(
    "RedstoneChainlinkCompositeWrapperWithThresholding",
    redstoneCompositeWrapperDeployment.address,
  );

  await applyRedstoneSetupPlan(
    setupPlan.redstone,
    {
      plainWrapper: redstoneWrapper,
      thresholdWrapper: redstoneWrapperWithThresholding,
      compositeWrapper: redstoneCompositeWrapper,
    },
    baseCurrencyUnit,
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["usd-oracle", "oracle-aggregator", "oracle-wrapper", "usd-redstone-oracle-wrapper"];
func.dependencies = [];
func.id = "setup-usd-redstone-oracle-wrappers";

export default func;
