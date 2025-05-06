import { BigNumber } from "@ethersproject/bignumber";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TransactionReceipt } from "ethers";
import hre from "hardhat";

/**
 * Approve the allowance if needed
 *
 * @param erc20TokenAddress - The address of the ERC20 token
 * @param spender - The address of the spender
 * @param amount - The amount of the allowance
 * @param ownerSigner - The signer
 * @returns The transaction receipt or null if the allowance is already approved
 */
export async function approveAllowanceIfNeeded(
  erc20TokenAddress: string,
  spender: string,
  amount: BigNumber,
  ownerSigner: HardhatEthersSigner,
): Promise<TransactionReceipt | null> {
  const tokenContract = await hre.ethers.getContractAt(
    [
      "function approve(address spender, uint256 amount) public returns (bool)",
      "function allowance(address owner, address spender) public view returns (uint256)",
    ],
    erc20TokenAddress,
    ownerSigner,
  );

  // Get the required allowance to be approved
  const allowance: bigint = await tokenContract.allowance(
    await ownerSigner.getAddress(),
    spender,
  );

  // If the allowance is less than the amount, approve the amount
  if (allowance < amount.toBigInt()) {
    const approveTx = await tokenContract.approve(spender, amount.toBigInt());
    return await approveTx.wait();
  }

  return null;
}
