import ethers from "ethers";
import hre from "hardhat";

import { fetchTokenInfo } from "./info";
import { getProxyContract } from "./proxy";

/**
 * Get the underlying asset of an ERC4626 token
 * - If the token is not an ERC4626 token, throw an error
 * - If the token is the zero address, throw an error
 *
 * @param tokenAddress - Address of the ERC4626 token
 * @returns The underlying asset address
 */
export async function getERC4626UnderlyingAsset(
  tokenAddress: string,
): Promise<string> {
  if (tokenAddress === ethers.ZeroAddress || tokenAddress === "") {
    throw new Error(
      `Token address cannot be zero address or empty: ${tokenAddress}`,
    );
  }

  const { dexDeployer } = await hre.getNamedAccounts();

  let actualTokenAddress = await getProxyContract(tokenAddress);

  // If there is no proxy contract, use the token address directly
  if (actualTokenAddress === "") {
    actualTokenAddress = tokenAddress;
  }

  const erc4626Contract = await hre.ethers.getContractAt(
    ["function asset() external view returns (address)"],
    actualTokenAddress,
    await hre.ethers.getSigner(dexDeployer),
  );

  // If the token is not an ERC4626 token, throw an error
  try {
    return await erc4626Contract.asset();
  } catch (error) {
    console.log("Error getting ERC4626 underlying asset", error);
    const tokenInfo = await fetchTokenInfo(hre, tokenAddress);
    throw new Error(
      `Token ${tokenInfo.symbol} is not an ERC4626 token: ${error}`,
    );
  }
}
