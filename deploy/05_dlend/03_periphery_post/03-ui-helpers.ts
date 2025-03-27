import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  PRICE_ORACLE_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get the Aave price oracle address
  const priceOracle = await deployments.get(PRICE_ORACLE_ID);

  // Deploy UiIncentiveDataProvider first
  console.log("Deploying UiIncentiveDataProvider...");
  const uiIncentiveDataProvider = await deploy("UiIncentiveDataProviderV3", {
    from: deployer,
    args: [], // No constructor arguments needed
    log: true,
    waitConfirmations: 1,
  });

  console.log(
    `UiIncentiveDataProvider deployed at: ${uiIncentiveDataProvider.address}`
  );

  // Then deploy UiPoolDataProvider
  console.log("Deploying UiPoolDataProvider...");
  const uiPoolDataProvider = await deploy("UiPoolDataProviderV3", {
    from: deployer,
    args: [priceOracle.address, priceOracle.address], // Use the same oracle for both parameters
    log: true,
    waitConfirmations: 1,
  });

  console.log(`UiPoolDataProvider deployed at: ${uiPoolDataProvider.address}`);
  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["PoolAddressesProvider", "deploy_oracles"];
func.id = "UiPoolDataProviderV3";

export default func;
