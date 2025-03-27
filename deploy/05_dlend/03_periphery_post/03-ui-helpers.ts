import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get AddressesProvider address
  const addressesProvider = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  console.log("Deploying UiPoolDataProvider...");
  const uiPoolDataProvider = await deploy("UiPoolDataProviderV3", {
    from: deployer,
    args: [addressesProvider.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`UiPoolDataProvider deployed at: ${uiPoolDataProvider.address}`);
  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["PoolAddressesProvider"];
func.id = "UiPoolDataProviderV3";

export default func;
