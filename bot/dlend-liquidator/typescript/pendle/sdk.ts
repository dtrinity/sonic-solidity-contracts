import axios, { AxiosResponse } from "axios";

const HOSTED_SDK_URL = "https://api-v2.pendle.finance/core/";

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
 * Calls the Pendle hosted SDK API with the specified path and parameters
 *
 * @param path The API endpoint path to call (e.g., 'v2/sdk/146/redeem')
 * @param params Optional query parameters to include in the request
 * @returns Promise that resolves to the API response containing transaction data and result data
 */
export async function callSDK<Data>(
  path: string,
  params: Record<string, any> = {},
): Promise<AxiosResponse<MethodReturnType<Data>>> {
  const response = await axios.get<MethodReturnType<Data>>(
    HOSTED_SDK_URL + path,
    {
      params,
    },
  );

  return response;
}

/**
 * Swaps an exact amount of PT tokens for a specified token
 *
 * @param ptToken The PT token address
 * @param amountIn The amount of PT tokens to swap
 * @param tokenOut The token address to swap to
 * @param receiver The address to receive the swapped tokens
 * @param market The market address
 * @param chainId The chain ID
 * @param slippage The slippage tolerance for the swap
 * @returns The SDK response containing transaction data and result data
 */
export async function swapExactPToToken(
  ptToken: string,
  amountIn: string,
  tokenOut: string,
  receiver: string,
  market: string,
  chainId: number,
  slippage: number = 0.01,
): Promise<AxiosResponse<MethodReturnType<RedeemPyData>>> {
  return await callSDK<RedeemPyData>(
    `v2/sdk/${chainId}/markets/${market}/swap`,
    {
      receiver: receiver,
      slippage: slippage,
      tokenIn: ptToken,
      amountIn: amountIn,
      tokenOut: tokenOut,
      enableAggregator: true,
    },
  );
}
