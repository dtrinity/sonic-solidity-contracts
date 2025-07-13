import hre from "hardhat";

/**
 * Check if a token is a PT token by calling the contract's isPTToken method
 *
 * @param tokenAddress - The address of the token to check
 * @returns True if the token is a PT token
 */
export async function checkIfPTToken(tokenAddress: string): Promise<boolean> {
  try {
    // Try to call expiry() method - PT tokens should have this
    const contract = await hre.ethers.getContractAt(
      ["function expiry() external view returns (uint256)"],
      tokenAddress,
    );

    // If this doesn't revert, it's likely a PT token
    await contract.expiry();
    return true;
  } catch {
    return false;
  }
}
