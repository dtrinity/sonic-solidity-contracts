import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get wrapped native token address for the network
  const config = await getConfig(hre);
  const wrappedNativeTokenAddress = config.tokenAddresses.wS;

  // Get pool address
  const pool = await deployments.get("Pool");

  console.log("Deploying WrappedTokenGateway...");
  const wrappedTokenGateway = await deploy("WrappedTokenGateway", {
    from: deployer,
    args: [pool.address, wrappedNativeTokenAddress],
    log: true,
    waitConfirmations: 1,
  });

  console.log(
    `WrappedTokenGateway deployed at: ${wrappedTokenGateway.address}`
  );
  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];
func.id = "WrappedTokenGateway";

export default func;
