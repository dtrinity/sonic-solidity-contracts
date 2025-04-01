import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { TestERC20, TestMintableERC20 } from "../../typechain-types";

/**
 * List of dStable symbols that use TestMintableERC20
 */
export const DSTABLE_SYMBOLS = ["dUSD", "dS"] as const;
export type DStableSymbol = (typeof DSTABLE_SYMBOLS)[number];

/**
 * Check if a symbol is a dStable symbol
 *
 * @param symbol - The symbol to check
 * @returns True if the symbol is a dStable symbol, false otherwise
 */
function isDStableSymbol(symbol: string): symbol is DStableSymbol {
  return DSTABLE_SYMBOLS.includes(symbol as DStableSymbol);
}

/**
 * Get the token contract for the given symbol
 *
 * @param hre Hardhat Runtime Environment
 * @param callerAddress Caller address
 * @param symbol Token symbol
 * @returns The TestMintableERC20 contract instance and token info for dStables
 */
export async function getTokenContractForSymbol(
  hre: HardhatRuntimeEnvironment,
  callerAddress: string,
  symbol: DStableSymbol,
): Promise<{ contract: TestMintableERC20; tokenInfo: TokenInfo }>;

/**
 * Get the token contract for the given symbol
 *
 * @param hre Hardhat Runtime Environment
 * @param callerAddress Caller address
 * @param symbol Token symbol
 * @returns The TestERC20 contract instance and token info for non-dStable tokens
 */
export async function getTokenContractForSymbol(
  hre: HardhatRuntimeEnvironment,
  callerAddress: string,
  symbol: string,
): Promise<{ contract: TestERC20; tokenInfo: TokenInfo }>;

/**
 * Implementation of getTokenContractForSymbol
 *
 * @param hre - Hardhat Runtime Environment
 * @param callerAddress - Caller address
 * @param symbol - Token symbol
 */
export async function getTokenContractForSymbol(
  hre: HardhatRuntimeEnvironment,
  callerAddress: string,
  symbol: string,
): Promise<{ contract: TestERC20 | TestMintableERC20; tokenInfo: TokenInfo }> {
  const signer = await ethers.getSigner(callerAddress);

  const tokenDeployment = await deployments.get(symbol);

  if (!tokenDeployment) {
    throw new Error(`Token deployment not found for symbol ${symbol}`);
  }
  const tokenaddress = tokenDeployment.address;

  const inputTokenInfo = await fetchTokenInfo(hre, tokenaddress);

  if (isDStableSymbol(inputTokenInfo.symbol)) {
    const contract = await ethers.getContractAt(
      "TestMintableERC20",
      tokenaddress,
      signer,
    );
    return {
      contract,
      tokenInfo: inputTokenInfo,
    };
  } else {
    const contract = await ethers.getContractAt(
      "TestERC20",
      tokenaddress,
      signer,
    );
    return {
      contract,
      tokenInfo: inputTokenInfo,
    };
  }
}

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
  const tokenContract = await hre.ethers.getContractAt(
    [
      "function symbol() view returns (string)",
      "function name() view returns (string)",
      "function decimals() view returns (uint8)",
    ],
    tokenAddress,
  );

  return {
    address: tokenAddress,
    symbol: await tokenContract.symbol(),
    name: await tokenContract.name(),
    decimals: Number(await tokenContract.decimals()),
  };
}

/**
 * Get the token contract for the given address
 *
 * @param hre Hardhat Runtime Environment
 * @param callerAddress Caller address
 * @param tokenAddress Token address
 * @returns The token contract instance and token info
 */
export async function getTokenContractForAddress(
  hre: HardhatRuntimeEnvironment,
  callerAddress: string,
  tokenAddress: string,
): Promise<{ contract: TestERC20 | TestMintableERC20; tokenInfo: TokenInfo }> {
  const signer = await ethers.getSigner(callerAddress);
  const tokenInfo = await fetchTokenInfo(hre, tokenAddress);

  if (isDStableSymbol(tokenInfo.symbol)) {
    const contract = await ethers.getContractAt(
      "TestMintableERC20",
      tokenAddress,
      signer,
    );
    return {
      contract,
      tokenInfo,
    };
  } else {
    const contract = await ethers.getContractAt(
      "TestERC20",
      tokenAddress,
      signer,
    );
    return {
      contract,
      tokenInfo,
    };
  }
}
