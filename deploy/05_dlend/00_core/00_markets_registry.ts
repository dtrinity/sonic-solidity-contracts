import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../../../config/config";

const REGISTRY_CONTRACT_NAME = "PoolAddressesProviderRegistry";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { walletAddresses } = await getConfig(hre);

  // Deploy the PoolAddressesProviderRegistry contract
  await hre.deployments.deploy(REGISTRY_CONTRACT_NAME, {
    from: deployer,
    args: [deployer],
    contract: REGISTRY_CONTRACT_NAME,
    autoMine: true,
    log: false,
  });

  // Return true to indicate deployment success
  return true;
};

func.id = "PoolAddressesProviderRegistry";
func.tags = ["dlend", "dlend-core"];

export default func;
