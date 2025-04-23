import fs from "fs";
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
  const poolDataProviderPath = config.parentDeploymentPaths?.poolDataProvider;

  if (!poolDataProviderPath) {
    throw new Error("Deployment path for PoolDataProvider not found");
  }

  if (!fs.existsSync(poolDataProviderPath)) {
    throw new Error(
      `PoolDataProvider deployment not found on path ${poolDataProviderPath}`,
    );
  }

  const poolDataProviderDeployment = JSON.parse(
    fs.readFileSync(poolDataProviderPath, "utf8"),
  );

  if (!poolDataProviderDeployment.address) {
    throw new Error("PoolDataProvider address is not found");
  }

  return poolDataProviderDeployment.address;
}
