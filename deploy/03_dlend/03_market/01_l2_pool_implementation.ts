import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  BORROW_LOGIC_ID,
  BRIDGE_LOGIC_ID,
  CALLDATA_LOGIC_ID,
  EMODE_LOGIC_ID,
  FLASH_LOAN_LOGIC_ID,
  LIQUIDATION_LOGIC_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_IMPL_ID,
  POOL_LOGIC_ID,
  SUPPLY_LOGIC_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get the addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Get the pool libraries
  const supplyLibraryDeployment = await hre.deployments.get(SUPPLY_LOGIC_ID);
  const borrowLibraryDeployment = await hre.deployments.get(BORROW_LOGIC_ID);
  const liquidationLibraryDeployment = await hre.deployments.get(LIQUIDATION_LOGIC_ID);
  const eModeLibraryDeployment = await hre.deployments.get(EMODE_LOGIC_ID);
  const bridgeLibraryDeployment = await hre.deployments.get(BRIDGE_LOGIC_ID);
  const flashLoanLogicDeployment = await hre.deployments.get(FLASH_LOAN_LOGIC_ID);
  const poolLogicDeployment = await hre.deployments.get(POOL_LOGIC_ID);

  const commonLibraries = {
    LiquidationLogic: liquidationLibraryDeployment.address,
    SupplyLogic: supplyLibraryDeployment.address,
    EModeLogic: eModeLibraryDeployment.address,
    FlashLoanLogic: flashLoanLogicDeployment.address,
    BorrowLogic: borrowLibraryDeployment.address,
    BridgeLogic: bridgeLibraryDeployment.address,
    PoolLogic: poolLogicDeployment.address,
  };

  // Deploy L2 libraries
  const calldataLogicDeployment = await hre.deployments.deploy(CALLDATA_LOGIC_ID, {
    from: deployer,
    args: [],
    autoMine: true,
    log: false,
  });

  // Deploy L2 supported Pool
  const poolDeployment = await hre.deployments.deploy(POOL_IMPL_ID, {
    from: deployer,
    args: [addressesProviderAddress],
    contract: "L2Pool",
    libraries: {
      ...commonLibraries,
      CalldataLogic: calldataLogicDeployment.address,
    },
    autoMine: true,
    log: false,
  });

  // Initialize implementation
  const poolContract = await hre.ethers.getContractAt("Pool", poolDeployment.address);
  await poolContract.initialize(addressesProviderAddress);

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  // Return true to indicate deployment success
  return true;
};

func.id = "dLend:L2PoolImplementations";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];

export default func;
