import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig as getLocalhostConfig } from "./networks/localhost";
import { getConfig as getSonicMainNetConfig } from "./networks/sonic_mainnet";
import { getConfig as getSonicTestNetConfig } from "./networks/sonic_testnet";
import { Config } from "./types";

/**
 * Get the configuration for the network
 *
 * @param hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  hre: HardhatRuntimeEnvironment,
): Promise<Config> {
  switch (hre.network.name) {
    case "sonic_testnet":
      return getSonicTestNetConfig(hre);
    case "sonic_mainnet":
      return getSonicMainNetConfig(hre);
    case "hardhat":
    case "localhost":
      return getLocalhostConfig(hre);
    default:
      throw new Error(`Unknown network: ${hre.network.name}`);
  }
}
