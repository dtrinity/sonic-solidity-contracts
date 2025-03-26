import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const REGISTRY_CONTRACT_NAME = "PoolAddressesProviderRegistry";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { lendingDeployer, lendingAddressesProviderRegistryOwner } =
    await hre.getNamedAccounts();

  // Deploy the PoolAddressesProviderRegistry contract
  const poolAddressesProviderRegistryDeployedResult =
    await hre.deployments.deploy(REGISTRY_CONTRACT_NAME, {
      from: lendingDeployer,
      args: [lendingDeployer],
      contract: REGISTRY_CONTRACT_NAME,
      autoMine: true,
      log: false,
    });

  // Get contract instance
  const registryInstance = await hre.ethers.getContractAt(
    REGISTRY_CONTRACT_NAME,
    poolAddressesProviderRegistryDeployedResult.address,
    await hre.ethers.getSigner(lendingDeployer)
  );

  console.log(`------------------------`);
  console.log(
    `Transfer ownership of ${REGISTRY_CONTRACT_NAME} to ${lendingAddressesProviderRegistryOwner}`
  );
  const response = await registryInstance.transferOwnership(
    lendingAddressesProviderRegistryOwner
  );
  const receipt = await response.wait();
  console.log(`  - TxHash: ${receipt?.hash}`);
  console.log(`  - From: ${receipt?.from}`);
  console.log(`  - GasUsed: ${receipt?.gasUsed.toString()}`);
  console.log(`------------------------`);

  // Return true to indicate deployment success
  return true;
};

func.id = "PoolAddressesProviderRegistry";
func.tags = ["lbp", "lbp-core", "lbp-registry"];

export default func;
