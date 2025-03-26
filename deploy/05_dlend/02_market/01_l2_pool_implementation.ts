import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_IMPL_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { lendingDeployer } = await hre.getNamedAccounts();

  // Get the addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  // Get the pool libraries
  const supplyLibraryDeployment = await hre.deployments.get("SupplyLogic");
  const borrowLibraryDeployment = await hre.deployments.get("BorrowLogic");
  const liquidationLibraryDeployment =
    await hre.deployments.get("LiquidationLogic");
  const eModeLibraryDeployment = await hre.deployments.get("EModeLogic");
  const bridgeLibraryDeployment = await hre.deployments.get("BridgeLogic");
  const flashLoanLogicDeployment = await hre.deployments.get("FlashLoanLogic");
  const poolLogicDeployment = await hre.deployments.get("PoolLogic");

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
  const calldataLogicDeployment = await hre.deployments.deploy(
    "CalldataLogic",
    {
      from: lendingDeployer,
      args: [],
      autoMine: true,
      log: false,
    }
  );

  // Deploy L2 supported Pool
  const poolDeployment = await hre.deployments.deploy(POOL_IMPL_ID, {
    from: lendingDeployer,
    args: [addressesProviderAddress],
    contract: "L2Pool",
    libraries: {
      ...commonLibraries,
      CalldataLogic: calldataLogicDeployment.address,
    },
    autoMine: true,
    log: false,
  });

  console.log(`------------------------`);
  console.log(`Initialize L2 pool implementation`);
  console.log(`  - Pool implementation: ${poolDeployment.address}`);
  console.log(`  - Address Provider   : ${addressesProviderAddress}`);

  // Initialize implementation
  const poolContract = await hre.ethers.getContractAt(
    "Pool",
    poolDeployment.address
  );
  const initPoolResponse = await poolContract.initialize(
    addressesProviderAddress
  );
  const initPoolReceipt = await initPoolResponse.wait();
  console.log(`  - TxHash  : ${initPoolReceipt?.hash}`);
  console.log(`  - From    : ${initPoolReceipt?.from}`);
  console.log(`  - GasUsed : ${initPoolReceipt?.gasUsed.toString()}`);
  console.log(`------------------------`);

  // Return true to indicate deployment success
  return true;
};

func.id = "L2PoolImplementations";
func.tags = ["lbp", "lbp-market"];

export default func;
