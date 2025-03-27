import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Deploy SupplyLogic
  await hre.deployments.deploy("SupplyLogic", {
    from: deployer,
    args: [],
    contract: "SupplyLogic",
    autoMine: true,
    log: false,
  });

  // Deploy BorrowLogic
  const borrowLogicDeployment = await hre.deployments.deploy("BorrowLogic", {
    from: deployer,
    args: [],
    contract: "BorrowLogic",
    autoMine: true,
    log: false,
  });

  // Deploy LiquidationLogic
  await hre.deployments.deploy("LiquidationLogic", {
    from: deployer,
    args: [],
    contract: "LiquidationLogic",
    autoMine: true,
    log: false,
  });

  // Deploy EModeLogic
  await hre.deployments.deploy("EModeLogic", {
    from: deployer,
    args: [],
    contract: "EModeLogic",
    autoMine: true,
    log: false,
  });

  // Deploy BridgeLogic
  await hre.deployments.deploy("BridgeLogic", {
    from: deployer,
    args: [],
    contract: "BridgeLogic",
    autoMine: true,
    log: false,
  });

  // Deploy ConfiguratorLogic
  await hre.deployments.deploy("ConfiguratorLogic", {
    from: deployer,
    args: [],
    contract: "ConfiguratorLogic",
    autoMine: true,
    log: false,
  });

  // Deploy FlashLoanLogic with BorrowLogic dependency
  await hre.deployments.deploy("FlashLoanLogic", {
    from: deployer,
    args: [],
    contract: "FlashLoanLogic",
    autoMine: true,
    log: false,
    libraries: {
      BorrowLogic: borrowLogicDeployment.address,
    },
  });

  // Deploy PoolLogic
  await hre.deployments.deploy("PoolLogic", {
    from: deployer,
    args: [],
    contract: "PoolLogic",
    autoMine: true,
    log: false,
  });

  // Return true to indicate deployment success
  return true;
};

func.id = "LogicLibraries";
func.tags = ["dlend", "dlend-core"];

export default func;
