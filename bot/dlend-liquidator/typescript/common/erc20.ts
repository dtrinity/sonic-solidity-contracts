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
 * @param signer - The signer
 * @returns The transaction receipt or null if the allowance is already approved
 */
export async function approveAllowanceIfNeeded(
  erc20TokenAddress: string,
  spender: string,
  amount: BigNumber,
  signer: HardhatEthersSigner,
): Promise<TransactionReceipt | null> {
  const tokenContract = await hre.ethers.getContractAt(
    [
      "function approve(address spender, uint256 amount) public returns (bool)",
      "function allowance(address owner, address spender) public view returns (uint256)",
    ],
    erc20TokenAddress,
    signer,
  );

  // Get the required allowance to be approved
  const allowance = await tokenContract.allowance(
    await tokenContract.owner(),
    spender,
  );

  // If the allowance is less than the amount, approve the amount
  if (allowance.lt(amount)) {
    const approveTx = await tokenContract.approve(spender, amount);
    return await approveTx.wait();
  }

  return null;
}
