import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig } from "../../config/config";

/**
 * Get the Aave Protocol Data Provider address from the parent deployment
 *
 * @param hre - The Hardhat runtime environment
 * @returns - The Aave Protocol Data Provider address
 */
export async function getAaveProtocolDataProviderAddressFromParent(
  hre: HardhatRuntimeEnvironment,
): Promise<string> {
  // Contract in parent is deployments/sonic_mainnet/PoolDataProvider.json

  const config = await getConfig(hre);
  const poolDataProviderAddress =
    config.parentDeploymentAddresses?.poolDataProvider;

  if (!poolDataProviderAddress) {
    throw new Error("Deployment path for PoolDataProvider not found");
  }

  return poolDataProviderAddress;
}
