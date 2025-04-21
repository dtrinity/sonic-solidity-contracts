import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Deploy HelloWorld contract
  const helloWorld = await hre.deployments.deploy("HelloWorld", {
    from: deployer,
    contract: "HelloWorld",
    log: true,
    autoMine: true,
  });

  console.log(`HelloWorld deployed to: ${helloWorld.address}`);

  return true;
};

func.id = "HelloWorld";
func.dependencies = [];
func.tags = ["helloWorld"];

export default func; 