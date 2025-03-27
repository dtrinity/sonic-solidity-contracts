import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const REGISTRY_CONTRACT_NAME = "PoolAddressesProviderRegistry";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, governanceMultisig } = await hre.getNamedAccounts();

  // Deploy the PoolAddressesProviderRegistry contract
  const poolAddressesProviderRegistryDeployedResult =
    await hre.deployments.deploy(REGISTRY_CONTRACT_NAME, {
      from: deployer,
      args: [deployer],
      contract: REGISTRY_CONTRACT_NAME,
      autoMine: true,
      log: false,
    });

  // Get contract instance
  const registryInstance = await hre.ethers.getContractAt(
    REGISTRY_CONTRACT_NAME,
    poolAddressesProviderRegistryDeployedResult.address,
    await hre.ethers.getSigner(deployer)
  );

  console.log(`------------------------`);
  console.log(
    `Transfer ownership of ${REGISTRY_CONTRACT_NAME} to ${governanceMultisig}`
  );
  const response = await registryInstance.transferOwnership(governanceMultisig);
  const receipt = await response.wait();
  console.log(`  - TxHash: ${receipt?.hash}`);
  console.log(`  - From: ${receipt?.from}`);
  console.log(`  - GasUsed: ${receipt?.gasUsed.toString()}`);
  console.log(`------------------------`);

  // Return true to indicate deployment success
  return true;
};

func.id = "PoolAddressesProviderRegistry";
func.tags = ["dlend", "dlend-core"];

export default func;
