import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

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

  console.log(`Deploying DLoopCoreLogic on network ${hre.network.name} (chainId: ${chainId})`);

  // Deploy DLoopCoreLogic
  await deployDLoopCoreLogic(hre, deployer);

  return true;
};

func.tags = ["dloop", "dloop-core-logic"];
func.id = DLOOP_CORE_LOGIC_ID;

export default func;
