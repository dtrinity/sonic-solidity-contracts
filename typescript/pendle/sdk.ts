import axios, { AxiosResponse } from "axios";

const HOSTED_SDK_URL = "https://api-v2.pendle.finance/core/";

// Pendle PYFactory ABI for isPT function
const PY_FACTORY_ABI = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isPT",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

type MethodReturnType<Data> = {
  tx: {
    data: string;
    to: string;
    value: string;
  };
  data: Data;
};

export type SwapData = { amountOut: string; priceImpact: number };
export type AddLiquidityData = {
  amountLpOut: string;
  amountYtOut: string;
  priceImpact: number;
};
export type AddLiquidityDualData = { amountOut: string; priceImpact: number };
export type RemoveLiquidityData = { amountOut: string; priceImpact: number };
export type RemoveLiquidityDualData = {
  amountTokenOut: string;
  amountPtOut: string;
  priceImpact: number;
};
export type MintPyData = { amountOut: string; priceImpact: number };
export type MintSyData = { amountOut: string; priceImpact: number };
export type RedeemPyData = { amountOut: string; priceImpact: number };
export type RedeemSyData = { amountOut: string; priceImpact: number };
export type TransferLiquidityData = {
  amountLpOut: string;
  amountYtOut: string;
  priceImpact: number;
};
export type RollOverPtData = { amountPtOut: string; priceImpact: number };

/**
 * Interface for PT market information
 */
export interface PTMarketInfo {
  marketAddress: string; // Market contract address
  underlyingAsset: string; // Underlying asset address
}

/**
 * Interface for Pendle API market data
 */
interface PendleMarket {
  name: string;
  address: string;
  expiry: string;
  pt: string; // Format: "chainId-address"
  yt: string; // Format: "chainId-address"
  sy: string; // Format: "chainId-address"
  underlyingAsset: string; // Format: "chainId-address"
  details: any;
  isNew: boolean;
  isPrime: boolean;
  timestamp: string;
}

/**
 * Interface for Pendle markets API response
 */
interface PendleMarketsResponse {
  markets: PendleMarket[];
}

export interface LimitOrderResponse {
  /** Hash of the order */
  id: string;
  /** Signature of order, signed by maker */
  signature: string;
  /** Chain id */
  chainId: number;
  /** BigInt string of salt */
  salt: string;
  /** BigInt string of expiry, in second */
  expiry: string;
  /** BigInt string of nonce */
  nonce: string;
  /** LimitOrderType { 0 : TOKEN_FOR_PT, 1 : PT_FOR_TOKEN, 2 : TOKEN_FOR_YT, 3 : YT_FOR_TOKEN } */
  type: 0 | 1 | 2 | 3;
  /** Token used by user to make order */
  token: string;
  /** YT address */
  yt: string;
  /** Maker address */
  maker: string;
  /** Receiver address */
  receiver: string;
  /** BigInt string of making amount, the amount of token if the order is TOKEN_FOR_PT or TOKEN_FOR_YT, otherwise the amount of PT or YT */
  makingAmount: string;
  /** BigInt string of remaining making amount, the unit is the same as makingAmount */
  lnImpliedRate: string;
  /** BigInt string of failSafeRate */
  failSafeRate: string;
  /** Bytes string for permit */
  permit: string;
}

/**
 * Helper function to extract address from "chainId-address" format
 *
 * @param addressWithChainId - Address in format "146-0x123..."
 * @returns Just the address part "0x123..."
 */
function extractAddressFromChainId(addressWithChainId: string): string {
  const parts = addressWithChainId.split("-");
  return parts.length > 1 ? parts[1] : addressWithChainId;
}

/**
 * Calls the Pendle hosted SDK API with the specified path and parameters
 *
 * @param path The API endpoint path to call (e.g., 'v2/sdk/146/redeem')
 * @param params Optional query parameters to include in the request
 * @returns Promise that resolves to the API response containing transaction data and result data
 */
export async function callSDK<Data>(path: string, params: Record<string, any> = {}): Promise<AxiosResponse<MethodReturnType<Data>>> {
  const response = await axios.get<MethodReturnType<Data>>(HOSTED_SDK_URL + path, {
    params,
  });

  return response;
}

/**
 * Swaps an exact amount of PT tokens for a specified token
 *
 * @param tokenIn The PT token address
 * @param amountIn The amount of PT tokens to swap
 * @param tokenOut The token address to swap to
 * @param receiver The address to receive the swapped tokens
 * @param market The market address
 * @param chainId The chain ID
 * @param slippage The slippage tolerance for the swap
 * @returns The SDK response containing transaction data and result data
 */
export async function estimateSwapExactIn(
  tokenIn: string,
  amountIn: string,
  tokenOut: string,
  receiver: string,
  market: string,
  chainId: number,
  slippage: number = 0.01,
): Promise<AxiosResponse<MethodReturnType<RedeemPyData>>> {
  return await callSDK<RedeemPyData>(`v2/sdk/${chainId}/markets/${market}/swap`, {
    receiver: receiver,
    slippage: slippage,
    tokenIn: tokenIn,
    amountIn: amountIn,
    tokenOut: tokenOut,
    enableAggregator: true,
  });
}

/**
 * Get the market address and underlying asset address from a PT token
 * Uses Pendle API to find the corresponding market and underlying asset
 *
 * @param ptTokenAddress - PT token address
 * @param chainId - Chain ID
 * @returns Object containing market address and underlying asset address
 */
export async function getPTMarketInfo(ptTokenAddress: string, chainId: number): Promise<PTMarketInfo> {
  try {
    // Call markets API for both active and inactive markets
    const [activeResponse, inactiveResponse] = await Promise.all([
      axios.get<PendleMarketsResponse>(HOSTED_SDK_URL + `v1/${chainId}/markets/active`),
      axios.get<PendleMarketsResponse>(HOSTED_SDK_URL + `v1/${chainId}/markets/inactive`),
    ]);

    const activeMarketsData = activeResponse.data;
    const inactiveMarketsData = inactiveResponse.data;

    if (!activeMarketsData?.markets || !inactiveMarketsData?.markets) {
      throw new Error("Invalid markets response format");
    }

    // Compose two lists - active and inactive markets
    const activeMarkets = activeMarketsData.markets;
    const inactiveMarkets = inactiveMarketsData.markets;
    const allMarkets = [...activeMarkets, ...inactiveMarkets];
    // Find market where PT matches our token in both active and inactive markets
    const market = allMarkets.find((m: PendleMarket) => {
      const ptAddress = extractAddressFromChainId(m.pt);
      return ptAddress.toLowerCase() === ptTokenAddress.toLowerCase();
    });

    if (!market) {
      throw new Error(`Market not found for PT token: ${ptTokenAddress}`);
    }

    if (!market.address || !market.underlyingAsset) {
      throw new Error(`Invalid market data for PT token: ${ptTokenAddress}`);
    }

    const marketAddress = market.address;
    const underlyingAsset = extractAddressFromChainId(market.underlyingAsset);

    // Determine if market is active or inactive
    const isActiveMarket = activeMarkets.some((m: PendleMarket) => m.address === market.address);
    const marketStatus = isActiveMarket ? "active" : "inactive";

    console.log(`Found PT market info via API:`, {
      ptToken: ptTokenAddress,
      marketAddress,
      underlyingAsset,
      status: marketStatus,
    });

    return {
      marketAddress,
      underlyingAsset,
    };
  } catch (error) {
    console.error("Failed to get PT market info from API:", error);
    throw new Error(`Could not determine market info for PT token: ${ptTokenAddress}`);
  }
}

/**
 * Check if a token is a PT token using the Pendle pyFactory's isPT function
 *
 * @param tokenAddress - The address of the token to check
 * @param pyFactory - The address of the Pendle pyFactory contract
 * @returns True if the token is a PT token
 */
export async function isPT(tokenAddress: string, pyFactory: string): Promise<boolean> {
  try {
    // We need to dynamically import ethers to avoid circular dependencies
    const { ethers } = await import("hardhat");

    // Connect to the pyFactory contract
    const pyFactoryContract = await ethers.getContractAt(PY_FACTORY_ABI, pyFactory);

    // Call isPT function to check if the token is a PT token
    const isPT = await pyFactoryContract.isPT(tokenAddress);
    return isPT;
  } catch (error) {
    console.warn(`Failed to check if ${tokenAddress} is PT token using pyFactory ${pyFactory}:`, error);
    return false;
  }
}
