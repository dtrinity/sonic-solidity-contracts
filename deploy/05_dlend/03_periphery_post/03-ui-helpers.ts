import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get AddressesProvider address
  const addressesProvider = await deployments.get("AddressesProvider");

  console.log("Deploying UiPoolDataProvider...");
  const uiPoolDataProvider = await deploy("UiPoolDataProvider", {
    from: deployer,
    args: [addressesProvider.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`UiPoolDataProvider deployed at: ${uiPoolDataProvider.address}`);
  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["AddressesProvider"];
func.id = "UiPoolDataProvider";

export default func;
