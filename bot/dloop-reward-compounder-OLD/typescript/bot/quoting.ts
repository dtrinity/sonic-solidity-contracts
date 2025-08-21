import { ethers } from "ethers";

import { addBps } from "../utils/numbers";

const CoreAbi = [
  "function exchangeThreshold() view returns (uint256)",
  "function previewMint(uint256) view returns (uint256)",
];

/**
 *
 * @param provider
 * @param core
 * @param slippageBps
 * @param maxInput
 */
export async function buildSwapCalldata(
  provider: ethers.Provider,
  core: string,
  slippageBps: number,
  maxInput: bigint,
) {
  const coreCtr = new ethers.Contract(core, CoreAbi, provider);
  const S: bigint = await coreCtr.exchangeThreshold();
  if (S === 0n) throw new Error("zero threshold");
  const required: bigint = await coreCtr.previewMint(S);
  const buffered = addBps(required, slippageBps);
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const calldata = abi.encode(["uint256", "uint256"], [buffered, maxInput]);
  return { S, required, buffered, calldata };
}
