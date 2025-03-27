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
  const pool = await deployments.get("PoolProxy");

  console.log("Deploying WrappedTokenGatewayV3...");
  const wrappedTokenGateway = await deploy("WrappedTokenGatewayV3", {
    from: deployer,
    args: [wrappedNativeTokenAddress, deployer, pool.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(
    `WrappedTokenGatewayV3 deployed at: ${wrappedTokenGateway.address}`
  );
  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];
func.id = "WrappedTokenGatewayV3";

export default func;
