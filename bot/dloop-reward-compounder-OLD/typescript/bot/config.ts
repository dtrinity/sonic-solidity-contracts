import { addresses as mainnet } from "../../config/networks/sonic_mainnet";
import { addresses as testnet } from "../../config/networks/sonic_testnet";
import type { NetworkAddresses } from "../../config/types";

/**
 *
 * @param network
 */
export function getAddresses(network: string): NetworkAddresses {
  if (network === "sonic_mainnet") return mainnet;
  if (network === "sonic_testnet") return testnet;
  throw new Error(`Unsupported network: ${network}`);
}
