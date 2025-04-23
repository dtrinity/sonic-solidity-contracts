import fs from "fs";
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

  const poolAddressesProviderPath =
    config.parentDeploymentPaths?.poolAddressesProvider;

  if (!poolAddressesProviderPath) {
    throw new Error("Deployment path for PoolAddressesProvider not found");
  }

  // Check if the directory exists
  if (!fs.existsSync(poolAddressesProviderPath)) {
    throw new Error(
      `Deployment for PoolAddressesProvider not found on path ${poolAddressesProviderPath}`,
    );
  }

  const poolAddressesProviderDeployment = JSON.parse(
    fs.readFileSync(poolAddressesProviderPath, "utf8"),
  );

  if (!poolAddressesProviderDeployment.address) {
    throw new Error("PoolAddressesProvider address is not found");
  }

  return poolAddressesProviderDeployment.address;
}

/**
 * Get the Lending pool contract's address
 * - The contract name is `Pool`
 *
 * @returns - The Lending pool contract's address
 */
export async function getPoolContractAddress(): Promise<string> {
  const { lendingDeployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(lendingDeployer);

  const addressProviderAddress =
    await getPoolAddressesProviderAddressFromParent(hre);
  const addressProviderContract = await hre.ethers.getContractAt(
    ["function getPool() external view returns (address)"],
    addressProviderAddress,
    signer,
  );

  return await addressProviderContract.getPool();
}
