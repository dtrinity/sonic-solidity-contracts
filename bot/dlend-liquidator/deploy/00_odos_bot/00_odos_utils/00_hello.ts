import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

// Define deployment ID
const HELLO_ID = "Hello";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log("Deploying Hello library");
  const { liquidatorBotDeployer } = await hre.getNamedAccounts();

  // Deploy Hello library
  await hre.deployments.deploy(HELLO_ID, {
    from: liquidatorBotDeployer,
    contract: "contracts/libraries/Hello.sol:Hello",
    args: [],
    libraries: undefined,
    autoMine: true,
    log: false,
  });

  const HelloDeployment = await hre.deployments.get(HELLO_ID);
  console.log(`📚 Deployed Hello library at ${HelloDeployment.address}`);

  return true;
};

func.id = "Hello";
func.dependencies = ["Address"];
func.tags = ["Hello"];
export default func;
