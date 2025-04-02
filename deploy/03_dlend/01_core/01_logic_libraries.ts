import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  BORROW_LOGIC_ID,
  BRIDGE_LOGIC_ID,
  CONFIGURATOR_LOGIC_ID,
  EMODE_LOGIC_ID,
  FLASH_LOAN_LOGIC_ID,
  LIQUIDATION_LOGIC_ID,
  POOL_LOGIC_ID,
  SUPPLY_LOGIC_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Deploy SupplyLogic
  await hre.deployments.deploy(SUPPLY_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "SupplyLogic",
    autoMine: true,
    log: false,
  });

  // Deploy BorrowLogic
  const borrowLogicDeployment = await hre.deployments.deploy(BORROW_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "BorrowLogic",
    autoMine: true,
    log: false,
  });

  // Deploy LiquidationLogic
  await hre.deployments.deploy(LIQUIDATION_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "LiquidationLogic",
    autoMine: true,
    log: false,
  });

  // Deploy EModeLogic
  await hre.deployments.deploy(EMODE_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "EModeLogic",
    autoMine: true,
    log: false,
  });

  // Deploy BridgeLogic
  await hre.deployments.deploy(BRIDGE_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "BridgeLogic",
    autoMine: true,
    log: false,
  });

  // Deploy ConfiguratorLogic
  await hre.deployments.deploy(CONFIGURATOR_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "ConfiguratorLogic",
    autoMine: true,
    log: false,
  });

  // Deploy FlashLoanLogic with BorrowLogic dependency
  await hre.deployments.deploy(FLASH_LOAN_LOGIC_ID, {
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
  await hre.deployments.deploy(POOL_LOGIC_ID, {
    from: deployer,
    args: [],
    contract: "PoolLogic",
    autoMine: true,
    log: false,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  // Return true to indicate deployment success
  return true;
};

func.id = "dLend:LogicLibraries";
func.tags = ["dlend", "dlend-core"];

export default func;
