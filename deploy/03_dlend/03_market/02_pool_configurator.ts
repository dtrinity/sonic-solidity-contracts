import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  CONFIGURATOR_LOGIC_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_CONFIGURATOR_ID,
  RESERVES_SETUP_HELPER_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Get configurator logic library
  const configuratorLogicDeployment = await hre.deployments.get(CONFIGURATOR_LOGIC_ID);

  // Deploy pool configurator implementation
  const poolConfiguratorDeployment = await hre.deployments.deploy(POOL_CONFIGURATOR_ID, {
    from: deployer,
    args: [],
    contract: "PoolConfigurator",
    libraries: {
      ConfiguratorLogic: configuratorLogicDeployment.address,
    },
    autoMine: true,
    log: false,
  });

  // Initialize implementation
  const poolConfig = await hre.ethers.getContractAt("PoolConfigurator", poolConfiguratorDeployment.address);
  await poolConfig.initialize(addressesProviderAddress);

  // Deploy reserves setup helper
  await hre.deployments.deploy(RESERVES_SETUP_HELPER_ID, {
    from: deployer,
    args: [],
    contract: "ReservesSetupHelper",
    autoMine: true,
    log: false,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  // Return true to indicate deployment success
  return true;
};

func.id = "dLend:PoolConfigurator";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];

export default func;
