import hre from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig } from "../../config/config";

/**
 * Get the PoolAddressesProvider address from the parent deployment
 *
 * @param hre - The Hardhat runtime environment
 * @returns - The PoolAddressesProvider address
 */
export async function getPoolAddressesProviderAddressFromParent(
  hre: HardhatRuntimeEnvironment,
): Promise<string> {
  const config = await getConfig(hre);

  const poolAddressesProviderAddress =
    config.parentDeploymentAddresses?.poolAddressesProvider;

  if (!poolAddressesProviderAddress) {
    throw new Error("PoolAddressesProvider address not found");
  }

  return poolAddressesProviderAddress;
}

/**
 * Get the Lending pool contract's address
 * - The contract name is `Pool`
 *
 * @returns - The Lending pool contract's address
 */
export async function getPoolContractAddress(): Promise<string> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const addressProviderAddress =
    await getPoolAddressesProviderAddressFromParent(hre);
  const addressProviderContract = await hre.ethers.getContractAt(
    ["function getPool() external view returns (address)"],
    addressProviderAddress,
    signer,
  );

  return await addressProviderContract.getPool();
}
