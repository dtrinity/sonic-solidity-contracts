import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { DLOOP_CORE_LOGIC_ID, DLOOP_QUOTER_ID } from "../../../typescript/deploy-ids";

/**
 * Deploy DLoopQuoter contract
 *
 * @param hre - Hardhat runtime environment
 * @param deployer - The address of the deployer
 * @returns True if the deployment is successful
 */
async function deployDLoopQuoter(hre: HardhatRuntimeEnvironment, deployer: string): Promise<boolean> {
  console.log("Deploying DLoopQuoter contract...");

  await hre.deployments.deploy(DLOOP_QUOTER_ID, {
    from: deployer,
    contract: "DLoopQuoter",
    args: [],
    log: true,
    autoMine: true,
    libraries: {
      DLoopCoreLogic: (await hre.deployments.get("DLoopCoreLogic")).address,
    },
  });

  console.log("DLoopQuoter deployed successfully");
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

  // DLoopCoreLogic library should be deployed via dependency

  // Skip if no dLOOP configuration
  if (!dloopConfig) {
    console.log(`No dLOOP configuration found for network ${hre.network.name}. Skipping DLoopQuoter deployment.`);
    return;
  }

  console.log(`Deploying DLoopQuoter on network ${hre.network.name} (chainId: ${chainId})`);

  // Deploy DLoopQuoter
  await deployDLoopQuoter(hre, deployer);

  return true;
};

func.tags = ["dloop", "core", "quoter"];
func.dependencies = [DLOOP_CORE_LOGIC_ID];
func.id = DLOOP_QUOTER_ID;

export default func;
