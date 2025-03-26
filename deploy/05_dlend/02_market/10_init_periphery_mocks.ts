import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../../typescript/deploy-ids";
import { isLocalNetwork, isTestnetNetwork } from "../../../utils/utils";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (
    !isLocalNetwork(hre.network.name) &&
    !isTestnetNetwork(hre.network.name)
  ) {
    console.log(
      `Skipping deploying MockFlashLoanReceiver on ${hre.network.name}`
    );
    return false;
  }

  const { lendingDeployer } = await hre.getNamedAccounts();
  const deployer = await hre.ethers.getSigner(lendingDeployer);

  // Get addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  // Deploy MockFlashLoanReceiver
  const mockFlashLoanReceiverDeployment = await hre.deployments.deploy(
    "MockFlashLoanReceiver",
    {
      contract: "MockFlashLoanReceiver",
      from: deployer.address,
      args: [addressesProviderAddress],
      log: true,
    }
  );

  console.log(`------------------------`);
  console.log(`Deployed MockFlashLoanReceiver`);
  console.log(`  - Address: ${mockFlashLoanReceiverDeployment.address}`);
  console.log(`  - Pool Addresses Provider: ${addressesProviderAddress}`);
  console.log(`------------------------`);

  return true;
};

func.id = "init_periphery_mocks";
func.tags = ["market", "periphery"];
func.dependencies = ["addresses-provider"];

export default func;
