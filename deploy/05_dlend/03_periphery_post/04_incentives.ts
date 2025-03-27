import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const MARKET_NAME = "Sonic";
const LENDING_PERIPHERY_VERSION = "1.0.0";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Get AddressesProvider address
  const addressesProvider = await deployments.get("AddressesProvider");

  console.log("Deploying IncentivesProxy...");
  const incentivesProxy = await deploy("IncentivesProxy", {
    from: deployer,
    args: [addressesProvider.address],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`IncentivesProxy deployed at: ${incentivesProxy.address}`);
  return true;
};

func.id = `Incentives:${MARKET_NAME}:lending-periphery@${LENDING_PERIPHERY_VERSION}`;
func.tags = ["dlend", "dlend-periphery-post"];
func.dependencies = [
  "dlend-core",
  "dlend-periphery-pre",
  "dlend-market",
  "AddressesProvider",
];

export default func;
