import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_CONFIGURATOR_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { lendingDeployer } = await hre.getNamedAccounts();

  // Get addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  // Get configurator logic library
  const configuratorLogicDeployment =
    await hre.deployments.get("ConfiguratorLogic");

  // Deploy pool configurator implementation
  const poolConfiguratorDeployment = await hre.deployments.deploy(
    POOL_CONFIGURATOR_ID,
    {
      from: lendingDeployer,
      args: [],
      contract: "PoolConfigurator",
      libraries: {
        ConfiguratorLogic: configuratorLogicDeployment.address,
      },
      autoMine: true,
      log: false,
    }
  );

  console.log(`------------------------`);
  console.log(`Initialize pool configurator implementation`);
  console.log(
    `  - Pool configurator implementation: ${poolConfiguratorDeployment.address}`
  );
  console.log(
    `  - Address Provider                : ${addressesProviderAddress}`
  );

  // Initialize implementation
  const poolConfig = await hre.ethers.getContractAt(
    "PoolConfigurator",
    poolConfiguratorDeployment.address
  );
  const initPoolConfigResponse = await poolConfig.initialize(
    addressesProviderAddress
  );
  const initPoolConfigReceipt = await initPoolConfigResponse.wait();
  console.log(`  - TxHash  : ${initPoolConfigReceipt?.hash}`);
  console.log(`  - From    : ${initPoolConfigReceipt?.from}`);
  console.log(`  - GasUsed : ${initPoolConfigReceipt?.gasUsed.toString()}`);
  console.log(`------------------------`);

  // Deploy reserves setup helper
  await hre.deployments.deploy("ReservesSetupHelper", {
    from: lendingDeployer,
    args: [],
    contract: "ReservesSetupHelper",
    autoMine: true,
    log: false,
  });

  // Return true to indicate deployment success
  return true;
};

func.id = "PoolConfigurator";
func.tags = ["lbp", "lbp-market"];

export default func;
