import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../../typescript/deploy-ids";
import { setupNewReserves } from "../../../typescript/dlend";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);
  const { rateStrategies, reservesConfig } = config.dLend;

  const addressProviderDeployedResult = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Deploy Rate Strategies
  for (const strategy of rateStrategies) {
    const args = [
      addressProviderDeployedResult.address,
      strategy.optimalUsageRatio,
      strategy.baseVariableBorrowRate,
      strategy.variableRateSlope1,
      strategy.variableRateSlope2,
      strategy.stableRateSlope1,
      strategy.stableRateSlope2,
      strategy.baseStableRateOffset,
      strategy.stableRateExcessOffset,
      strategy.optimalStableToTotalDebtRatio,
    ];

    const deploymentName = `ReserveStrategy-${strategy.name}`;
    await hre.deployments.deploy(deploymentName, {
      contract: "DefaultReserveInterestRateStrategy",
      from: deployer,
      args,
      log: true,
    });
  }

  const allReserveSymbols = Object.keys(reservesConfig);
  await setupNewReserves(hre, allReserveSymbols);

  console.log(`✅ ${__filename.split("/").slice(-2).join("/")}: Initial reserves setup complete.`);

  return true;
};

func.id = "dLend:init_reserves";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "PoolAddressesProvider", "PoolConfigurator", "tokens_implementations"];

export default func;
