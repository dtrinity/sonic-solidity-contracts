import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

// Define deployment ID
const SAFE_ERC20_ID = "SafeERC20";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log("Deploying SafeERC20 library");
  const { liquidatorBotDeployer } = await hre.getNamedAccounts();

  // Deploy SafeERC20 library
  await hre.deployments.deploy(SAFE_ERC20_ID, {
    from: liquidatorBotDeployer,
    contract: "contracts/libraries/SafeERC20.sol:SafeERC20",
    args: [],
    libraries: undefined,
    autoMine: true,
    log: false,
  });

  const safeERC20Deployment = await hre.deployments.get(SAFE_ERC20_ID);
  console.log(`📚 Deployed SafeERC20 library at ${safeERC20Deployment.address}`);

  return true;
};

func.id = "SafeERC20";
func.dependencies = ["Address"];
func.tags = ["SafeERC20"];
export default func;
