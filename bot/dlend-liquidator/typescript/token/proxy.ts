import hre from "hardhat";

import { getConfig } from "../../config/config";

/**
 * Get the proxy contract address for a token
 *
 * @param tokenAddress - Address of the token
 * @returns The proxy contract address. If there is no proxy contract, return empty string
 */
export async function getProxyContract(tokenAddress: string): Promise<string> {
  const config = await getConfig(hre);

  if (config.tokenProxyContractMap) {
    if (config.tokenProxyContractMap[tokenAddress]) {
      return config.tokenProxyContractMap[tokenAddress];
    }
  }

  return "";
}
