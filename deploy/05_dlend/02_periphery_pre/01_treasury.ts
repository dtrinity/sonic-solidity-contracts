import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  TREASURY_CONTROLLER_ID,
  TREASURY_IMPL_ID,
  TREASURY_PROXY_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { walletAddresses } = await getConfig(hre);

  const governanceMultisig = walletAddresses.governanceMultisig;

  // Deploy Treasury proxy
  const treasuryProxyDeployment = await hre.deployments.deploy(
    TREASURY_PROXY_ID,
    {
      from: deployer,
      args: [],
      contract: "InitializableAdminUpgradeabilityProxy",
      autoMine: true,
      log: false,
    },
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
    },
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
    },
  );

  // Initialize implementation contract to prevent other calls
  const treasuryImplContract = await hre.ethers.getContractAt(
    "AaveEcosystemReserveV2",
    treasuryImplDeployment.address,
  );

  // Claim the implementation contract
  await treasuryImplContract.initialize(governanceMultisig);

  // Initialize proxy
  const proxy = await hre.ethers.getContractAt(
    "InitializableAdminUpgradeabilityProxy",
    treasuryProxyDeployment.address,
  );

  const initializePayload = treasuryImplContract.interface.encodeFunctionData(
    "initialize",
    [treasuryControllerDeployment.address],
  );

  await proxy["initialize(address,address,bytes)"](
    treasuryImplDeployment.address,
    governanceMultisig,
    initializePayload,
  );

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["dlend", "dlend-periphery-pre"];
func.dependencies = [];
func.id = "dLend:Treasury";

export default func;
