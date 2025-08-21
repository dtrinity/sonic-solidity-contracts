import { ethers } from "ethers";

const PeripheryAbi = [
  "function run(bytes swapCalldata, uint256 flashAmount, uint256 slippageBps) external",
];

/**
 *
 * @param address
 * @param signer
 */
export function getPeriphery(address: string, signer: ethers.Signer) {
  return new ethers.Contract(address, PeripheryAbi, signer);
}
