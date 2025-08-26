import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { DLOOP_CORE_LOGIC_ID } from "../../../typescript/deploy-ids";

/**
 * Deploy DLoopCoreLogic library contract
 *
 * @param hre - Hardhat runtime environment
 * @param deployer - The address of the deployer
 * @returns True if the deployment is successful
 */
async function deployDLoopCoreLogic(hre: HardhatRuntimeEnvironment, deployer: string): Promise<boolean> {
  console.log("Deploying DLoopCoreLogic library contract...");

  await hre.deployments.deploy(DLOOP_CORE_LOGIC_ID, {
    from: deployer,
    contract: "DLoopCoreLogic",
    args: [],
    log: true,
    autoMine: true,
  });

  console.log("DLoopCoreLogic library deployed successfully");
  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getChainId } = hre;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

  // Allow local deployments (do not skip on localhost/hardhat)
  // Get network config
  const networkConfig = await getConfig(hre);
  const dloopConfig = networkConfig.dLoop;

  // Skip if no dLOOP configuration
  if (!dloopConfig) {
    console.log(`No dLOOP configuration found for network ${hre.network.name}. Skipping DLoopCoreLogic deployment.`);
    return;
  }

  console.log(`Deploying DLoopCoreLogic on network ${hre.network.name} (chainId: ${chainId})`);

  // Deploy DLoopCoreLogic
  await deployDLoopCoreLogic(hre, deployer);

  return true;
};

func.tags = ["dloop", "core", "logic"];
func.id = DLOOP_CORE_LOGIC_ID;

export default func;
