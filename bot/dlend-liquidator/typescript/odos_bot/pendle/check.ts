import hre from "hardhat";

// Pendle PYFactory ABI for isPT function
const PY_FACTORY_ABI = [
  {
    "inputs": [{"internalType": "address", "name": "", "type": "address"}],
    "name": "isPT",
    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  }
];

/**
 * Check if a token is a PT token using the Pendle pyFactory's isPT function
 *
 * @param tokenAddress - The address of the token to check
 * @param pyFactory - The address of the Pendle pyFactory contract
 * @returns True if the token is a PT token
 */
export async function checkIfPTToken(tokenAddress: string, pyFactory: string): Promise<boolean> {
  try {
    // Connect to the pyFactory contract
    const pyFactoryContract = await hre.ethers.getContractAt(
      PY_FACTORY_ABI,
      pyFactory,
    );

    // Call isPT function to check if the token is a PT token
    const isPT = await pyFactoryContract.isPT(tokenAddress);
    return isPT;
  } catch (error) {
    console.warn(`Failed to check if ${tokenAddress} is PT token using pyFactory ${pyFactory}:`, error);
    return false;
  }
}
