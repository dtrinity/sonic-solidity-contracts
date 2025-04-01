import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  PRICE_ORACLE_ID,
  UI_INCENTIVE_DATA_PROVIDER_ID,
  UI_POOL_DATA_PROVIDER_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get the Aave price oracle address
  const priceOracle = await deployments.get(PRICE_ORACLE_ID);

  // Deploy UiIncentiveDataProvider first
  const _uiIncentiveDataProvider = await deploy(UI_INCENTIVE_DATA_PROVIDER_ID, {
    from: deployer,
    args: [], // No constructor arguments needed
    log: true,
    waitConfirmations: 1,
  });

  // Then deploy UiPoolDataProvider
  await deploy(UI_POOL_DATA_PROVIDER_ID, {
    from: deployer,
    args: [priceOracle.address, priceOracle.address], // Use the same oracle for both parameters
    log: true,
    waitConfirmations: 1,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["PoolAddressesProvider", "deploy_oracles"];
func.id = "UiPoolDataProviderV3";

export default func;
