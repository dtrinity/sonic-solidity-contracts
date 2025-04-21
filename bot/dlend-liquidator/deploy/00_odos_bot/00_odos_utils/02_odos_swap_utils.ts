import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

// Define deployment ID
const ODOS_SWAP_UTILS_ID = "OdosSwapUtils";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log("Deploying OdosSwapUtils library");
  const { liquidatorBotDeployer } = await hre.getNamedAccounts();

  const safeERC20Deployment = await hre.deployments.get("SafeERC20");

  if (!safeERC20Deployment) {
    throw new Error("SafeERC20 deployment not found");
  }

  if (!safeERC20Deployment.address) {
    throw new Error("SafeERC20 deployment address not found");
  }

  // Deploy OdosSwapUtils library
  await hre.deployments.deploy(ODOS_SWAP_UTILS_ID, {
    from: liquidatorBotDeployer,
    contract: "OdosSwapUtils",
    args: [],
    libraries: {
      "SafeERC20": safeERC20Deployment.address,
    },
    autoMine: true,
    log: false,
  });

  const odosSwapUtilsDeployment = await hre.deployments.get(ODOS_SWAP_UTILS_ID);
  console.log(`📚 Deployed OdosSwapUtils library at ${odosSwapUtilsDeployment.address}`);

  return true;
};

func.id = "OdosSwapUtils";
func.dependencies = ["SafeERC20"];
func.tags = ["OdosSwapUtils"];
export default func;
