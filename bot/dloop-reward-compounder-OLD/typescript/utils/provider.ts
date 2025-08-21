import { JsonRpcProvider, Wallet } from "ethers";

/**
 *
 * @param rpcUrl
 */
export function getProvider(rpcUrl: string) {
  return new JsonRpcProvider(rpcUrl);
}

/**
 *
 * @param pk
 * @param rpcUrl
 */
export function getSigner(pk: string, rpcUrl: string) {
  const provider = getProvider(rpcUrl);
  return new Wallet(pk, provider);
}
