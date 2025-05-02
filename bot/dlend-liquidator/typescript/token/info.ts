import { HardhatRuntimeEnvironment } from "hardhat/types";

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

const tokenInfoCache = new Map<string, TokenInfo>();

/**
 * Fetch the token information from blockchain given the token address
 * - It will cache the token information to avoid fetching the same token information multiple times
 *
 * @param hre - Hardhat Runtime Environment
 * @param tokenAddress - The token address
 * @returns The token information
 */
export async function fetchTokenInfo(
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
): Promise<TokenInfo> {
  if (tokenInfoCache.has(tokenAddress)) {
    return tokenInfoCache.get(tokenAddress) as TokenInfo;
  }
  const tokenInfo = await fetchTokenInfoImplementation(hre, tokenAddress);
  tokenInfoCache.set(tokenAddress, tokenInfo);
  return tokenInfo;
}

/**
 * Fetch the token information from blockchain given the token address
 *
 * @param hre - Hardhat Runtime Environment
 * @param tokenAddress - The token address
 * @returns - The token information
 */
async function fetchTokenInfoImplementation(
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
): Promise<TokenInfo> {
  const { deployer } = await hre.getNamedAccounts();

  const tokenContract = new hre.ethers.Contract(
    tokenAddress,
    // ERC20 ABI for getting the token information
    [
      "function symbol() view returns (string)",
      "function name() view returns (string)",
      "function decimals() view returns (uint8)",
    ],
    await hre.ethers.getSigner(deployer), // It is required to have a signer to call the contract
  );

  return {
    address: tokenAddress,
    symbol: await tokenContract.symbol(),
    name: await tokenContract.name(),
    decimals: Number(await tokenContract.decimals()),
  };
}
