import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import {
  TREASURY_CONTROLLER_ID,
  TREASURY_IMPL_ID,
  TREASURY_PROXY_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, governanceMultisig } = await hre.getNamedAccounts();

  // Deploy Treasury proxy
  const treasuryProxyDeployment = await hre.deployments.deploy(
    TREASURY_PROXY_ID,
    {
      from: deployer,
      args: [],
      contract: "InitializableAdminUpgradeabilityProxy",
      autoMine: true,
      log: false,
    }
  );

  // Deploy Treasury Controller
  const treasuryControllerDeployment = await hre.deployments.deploy(
    TREASURY_CONTROLLER_ID,
    {
      from: deployer,
      args: [governanceMultisig],
      contract: "AaveEcosystemReserveController",
      autoMine: true,
      log: false,
    }
  );

  // Deploy Treasury implementation
  const treasuryImplDeployment = await hre.deployments.deploy(
    TREASURY_IMPL_ID,
    {
      from: deployer,
      args: [],
      contract: "AaveEcosystemReserveV2",
      autoMine: true,
      log: false,
    }
  );

  console.log(`-----------------`);
  console.log(
    `Initialize AaveEcosystemReserveV2 Impl at ${treasuryImplDeployment.address}`
  );

  // Initialize implementation contract to prevent other calls
  const treasuryImplContract = await hre.ethers.getContractAt(
    "AaveEcosystemReserveV2",
    treasuryImplDeployment.address
  );

  // Claim the implementation contract
  const treasuryImplResponse =
    await treasuryImplContract.initialize(governanceMultisig);
  const treasuryImplReceipt = await treasuryImplResponse.wait();
  console.log(`  - TxHash: ${treasuryImplReceipt?.hash}`);
  console.log(`  - From: ${treasuryImplReceipt?.from}`);
  console.log(`  - GasUsed: ${treasuryImplReceipt?.gasUsed.toString()}`);
  console.log(`-----------------`);

  // Initialize proxy
  console.log(
    `Initialize Treasury InitializableAdminUpgradeabilityProxy at ${treasuryProxyDeployment.address}`
  );
  const proxy = await hre.ethers.getContractAt(
    "InitializableAdminUpgradeabilityProxy",
    treasuryProxyDeployment.address
  );

  const initializePayload = treasuryImplContract.interface.encodeFunctionData(
    "initialize",
    [treasuryControllerDeployment.address]
  );

  const initProxyResponse = await proxy["initialize(address,address,bytes)"](
    treasuryImplDeployment.address,
    governanceMultisig,
    initializePayload
  );
  const initProxyReceipt = await initProxyResponse.wait();
  console.log(`  - TxHash: ${initProxyReceipt?.hash}`);
  console.log(`  - From: ${initProxyReceipt?.from}`);
  console.log(`  - GasUsed: ${initProxyReceipt?.gasUsed.toString()}`);
  console.log(`-----------------`);

  // Return true to indicate deployment success
  return true;
};

func.tags = ["dlend", "dlend-periphery-pre"];
func.dependencies = [];
func.id = "Treasury";

export default func;
