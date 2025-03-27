import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const MARKET_NAME = "Sonic";
const LENDING_PERIPHERY_VERSION = "1.0.0";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get pool address
  const pool = await deployments.get("Pool");

  console.log("Deploying CurveAdapter...");
  const curveAdapter = await deploy("CurveAdapter", {
    from: deployer,
    args: [pool.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`CurveAdapter deployed at: ${curveAdapter.address}`);
  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = ["Pool"];
func.id = `DLendCurveAdapter`;

export default func;
