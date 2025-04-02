import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { POOL_PROXY_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get wrapped native token address for the network
  const config = await getConfig(hre);
  const wrappedNativeTokenAddress = config.tokenAddresses.wS;

  // Get pool address
  const pool = await deployments.get(POOL_PROXY_ID);

  const _wrappedTokenGateway = await deploy("WrappedTokenGatewayV3", {
    from: deployer,
    args: [wrappedNativeTokenAddress, deployer, pool.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];
func.id = "dLend:WrappedTokenGatewayV3";

export default func;
