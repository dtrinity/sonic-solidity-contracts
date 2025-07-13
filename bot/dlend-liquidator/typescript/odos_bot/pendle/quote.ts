import hre from "hardhat";

import { OdosClient } from "../../odos/client";
import { callSDK, RedeemPyData } from "../../pendle/sdk";
import { getERC4626UnderlyingAsset } from "../../token/erc4626";

/**
 * Interface for PT swap data that will be encoded for the contract
 */
export interface PTSwapData {
  underlyingAsset: string; // Underlying asset from PT swap
  expectedUnderlying: string; // Expected underlying amount from Pendle SDK
  pendleTarget: string; // Target contract for Pendle transaction
  pendleCalldata: string; // Transaction data from Pendle SDK
  odosTarget: string; // Target contract for Odos transaction (can be zero address)
  odosCalldata: string; // Transaction data from Odos API (can be empty)
}

/**
 * Get PT+Odos two-stage swap quote and assembled transaction data
 *
 * @param collateralTokenAddress - The address of the collateral token (PT token)
 * @param borrowTokenAddress - The address of the borrow token
 * @param repayAmount - The amount of the repay
 * @param liquidatorAccountAddress - The address of the liquidator
 * @param chainId - The chain ID
 * @param odosClient - The Odos client
 * @param isUnstakeToken - Whether the collateral token needs to be unstaked
 * @returns The PT swap data for two-stage execution
 */
export async function getPTOdosSwapQuote(
  collateralTokenAddress: string,
  borrowTokenAddress: string,
  repayAmount: bigint,
  liquidatorAccountAddress: string,
  chainId: number,
  odosClient: OdosClient,
  isUnstakeToken: boolean,
): Promise<{ ptSwapData: PTSwapData }> {
  console.log("Getting PT+Odos two-stage swap quote");
  console.log("PT Token:", collateralTokenAddress);
  console.log("Target Token:", borrowTokenAddress);
  console.log("Repay Amount:", repayAmount.toString());

  // Get token contract info
  const ptToken = await hre.ethers.getContractAt(
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function expiry() view returns (uint256)",
    ],
    collateralTokenAddress,
  );

  const borrowToken = await hre.ethers.getContractAt(
    ["function decimals() view returns (uint8)"],
    borrowTokenAddress,
  );

  const ptDecimals = await ptToken.decimals();
  const borrowDecimals = await borrowToken.decimals();
  const ptSymbol = await ptToken.symbol();

  console.log(`PT Token: ${ptSymbol} (${ptDecimals} decimals)`);

  let effectivePTAddress = collateralTokenAddress;

  if (isUnstakeToken) {
    effectivePTAddress = await getERC4626UnderlyingAsset(
      collateralTokenAddress,
    );
    console.log("Using unstaked PT token for quote:", effectivePTAddress);
  }

  // Step 1: Get PT swap quote from Pendle SDK
  console.log("Step 1: Getting PT swap quote from Pendle SDK");

  const readableRepayAmount = OdosClient.parseTokenAmount(
    repayAmount.toString(),
    Number(borrowDecimals),
  );

  // Calculate input amount for PT swap (we need to estimate how much PT to swap)
  // For now, we'll use a conservative estimate and let slippage protection handle precision
  const swapSlippageBufferPercentage = 1.0; // 1% buffer for PT swaps

  const estimatedPTAmount = await estimatePTInputAmount(
    effectivePTAddress,
    borrowTokenAddress,
    readableRepayAmount,
    chainId,
    odosClient,
    swapSlippageBufferPercentage,
  );

  const formattedPTAmount = OdosClient.formatTokenAmount(
    estimatedPTAmount,
    Number(ptDecimals),
  );

  console.log("Estimated PT amount needed:", estimatedPTAmount);
  console.log("Formatted PT amount:", formattedPTAmount);

  // Get the underlying asset from PT token using Pendle SDK
  const underlyingAsset = await getUnderlyingAssetFromPT(
    effectivePTAddress,
    chainId,
  );
  console.log("Underlying asset from PT:", underlyingAsset);

  // Call Pendle SDK to get PT -> underlying swap data
  const pendleResponse = await callSDK<RedeemPyData>(
    `v2/sdk/${chainId}/redeem`,
    {
      receiver: liquidatorAccountAddress, // Contract will receive underlying
      slippage: 0.005, // 0.5% slippage tolerance
      yt: effectivePTAddress, // PT token to redeem
      amountIn: formattedPTAmount, // Amount of PT to swap
      tokenOut: underlyingAsset, // Want underlying asset
    },
  );

  const pendleData = pendleResponse.data;
  console.log("Pendle SDK response:", {
    amountOut: pendleData.data.amountOut,
    priceImpact: pendleData.data.priceImpact,
    target: pendleData.tx.to,
  });

  // Step 2: Get Odos quote for underlying -> target token (if needed)
  console.log("Step 2: Getting Odos quote for underlying -> target");

  let odosTarget = "";
  let odosCalldata = "";

  if (underlyingAsset.toLowerCase() !== borrowTokenAddress.toLowerCase()) {
    console.log("Different tokens - need Odos swap from underlying to target");

    // Use the exact expected output from Pendle as input for Odos
    const underlyingAmountFromPendle = pendleData.data.amountOut;

    const odosQuoteRequest = {
      chainId: chainId,
      inputTokens: [
        {
          tokenAddress: underlyingAsset,
          amount: underlyingAmountFromPendle,
        },
      ],
      outputTokens: [{ tokenAddress: borrowTokenAddress, proportion: 1 }],
      userAddr: liquidatorAccountAddress,
      slippageLimitPercent: swapSlippageBufferPercentage,
    };

    const odosQuote = await odosClient.getQuote(odosQuoteRequest);

    // Assemble Odos transaction
    const assembleRequest = {
      chainId: chainId,
      pathId: odosQuote.pathId,
      userAddr: liquidatorAccountAddress,
      simulate: false,
      receiver: liquidatorAccountAddress, // Contract receives the final tokens
    };

    const assembled = await odosClient.assembleTransaction(assembleRequest);

    odosTarget = assembled.transaction.to;
    odosCalldata = assembled.transaction.data;
  } else {
    console.log("Same token - no Odos swap needed (direct case)");
  }

  // Step 3: Create PTSwapData structure
  const ptSwapData: PTSwapData = {
    underlyingAsset: underlyingAsset,
    expectedUnderlying: pendleData.data.amountOut,
    pendleTarget: pendleData.tx.to,
    pendleCalldata: pendleData.tx.data,
    odosTarget: odosTarget,
    odosCalldata: odosCalldata,
  };

  return { ptSwapData };
}

/**
 * Estimate PT input amount needed for a given target output
 * This is a helper function to estimate how much PT we need to swap
 *
 * @param ptTokenAddress - PT token address
 * @param targetTokenAddress - Target token address
 * @param targetAmount - Target amount needed
 * @param chainId - Chain ID
 * @param odosClient - Odos client
 * @param slippageBuffer - Slippage buffer percentage
 * @returns Estimated PT input amount
 */
async function estimatePTInputAmount(
  ptTokenAddress: string,
  targetTokenAddress: string,
  targetAmount: string,
  chainId: number,
  odosClient: OdosClient,
  slippageBuffer: number,
): Promise<number> {
  try {
    // Get underlying asset first
    const underlyingAsset = await getUnderlyingAssetFromPT(
      ptTokenAddress,
      chainId,
    );

    // If target is the same as underlying, we can estimate 1:1 (plus buffer)
    if (underlyingAsset.toLowerCase() === targetTokenAddress.toLowerCase()) {
      return Number(targetAmount) * (1 + slippageBuffer / 100);
    }

    // Otherwise, estimate via Odos reverse calculation
    const estimatedUnderlyingNeeded = await odosClient.calculateInputAmount(
      targetAmount,
      targetTokenAddress,
      underlyingAsset,
      chainId,
      slippageBuffer,
    );

    // For PT tokens, we typically need slightly more PT than underlying (due to interest)
    // Add an additional buffer for PT price impact
    return Number(estimatedUnderlyingNeeded) * 1.1; // 10% additional buffer for PT
  } catch (error) {
    console.warn(
      "Could not estimate PT input amount, using conservative fallback:",
      error,
    );
    // Fallback: use a conservative estimate
    return Number(targetAmount) * 1.5; // 50% buffer as fallback
  }
}

/**
 * Get the underlying asset address from a PT token
 * This function tries multiple methods to determine the underlying asset
 *
 * @param ptTokenAddress - PT token address
 * @param chainId - Chain ID
 * @returns Underlying asset address
 */
async function getUnderlyingAssetFromPT(
  ptTokenAddress: string,
  chainId: number,
): Promise<string> {
  try {
    // Method 1: Try to call SY() method on PT token
    const ptContract = await hre.ethers.getContractAt(
      ["function SY() external view returns (address)"],
      ptTokenAddress,
    );

    const syAddress = await ptContract.SY();

    // Get underlying from SY token
    const syContract = await hre.ethers.getContractAt(
      ["function yieldToken() external view returns (address)"],
      syAddress,
    );

    const underlyingAddress = await syContract.yieldToken();
    console.log("Found underlying asset via SY method:", underlyingAddress);
    return underlyingAddress;
  } catch (syError) {
    console.log("SY method failed, trying alternative approach:", syError);

    try {
      // Method 2: Query Pendle markets API to find the underlying
      const response = await fetch(
        `https://api.pendle.finance/core/v1/markets/${chainId}`,
      );
      const markets = await response.json();

      // Find market where PT matches our token
      const market = markets.find(
        (m: any) => m.pt.toLowerCase() === ptTokenAddress.toLowerCase(),
      );

      if (market && market.underlyingAsset) {
        console.log("Found underlying asset via API:", market.underlyingAsset);
        return market.underlyingAsset;
      }

      throw new Error("Market not found in API");
    } catch (apiError) {
      console.error("Both methods failed to get underlying asset:", apiError);

      // Method 3: Hardcoded fallback for known PT tokens (based on config)
      const knownPTTokens: Record<string, string> = {
        // Add known PT token mappings here based on your configuration
        // These should be populated from the PT token registry
      };

      const fallbackUnderlying = knownPTTokens[ptTokenAddress.toLowerCase()];

      if (fallbackUnderlying) {
        console.log("Using hardcoded fallback underlying:", fallbackUnderlying);
        return fallbackUnderlying;
      }

      throw new Error(
        `Could not determine underlying asset for PT token: ${ptTokenAddress}`,
      );
    }
  }
}

/**
 * Create PT swap data structure from individual components
 * This is a helper function for testing and manual data creation
 *
 * @param underlyingAsset - Underlying asset address
 * @param expectedUnderlying - Expected underlying amount
 * @param pendleTarget - Pendle target contract
 * @param pendleCalldata - Pendle transaction data
 * @param odosTarget - Odos target contract (optional)
 * @param odosCalldata - Odos transaction data (optional)
 * @returns PTSwapData structure
 */
export function createPTSwapData(
  underlyingAsset: string,
  expectedUnderlying: string,
  pendleTarget: string,
  pendleCalldata: string,
  odosTarget?: string,
  odosCalldata?: string,
): PTSwapData {
  return {
    underlyingAsset,
    expectedUnderlying,
    pendleTarget,
    pendleCalldata,
    odosTarget: odosTarget || "",
    odosCalldata: odosCalldata || "",
  };
}

/**
 * Validate PT swap data structure
 *
 * @param ptSwapData - PT swap data to validate
 * @returns True if valid, throws error if invalid
 */
export function validatePTSwapData(ptSwapData: PTSwapData): boolean {
  if (!ptSwapData.underlyingAsset || ptSwapData.underlyingAsset === "") {
    throw new Error("Missing underlying asset in PT swap data");
  }

  if (!ptSwapData.expectedUnderlying || ptSwapData.expectedUnderlying === "0") {
    throw new Error("Missing or zero expected underlying amount");
  }

  if (!ptSwapData.pendleTarget || ptSwapData.pendleTarget === "") {
    throw new Error("Missing Pendle target contract");
  }

  if (!ptSwapData.pendleCalldata || ptSwapData.pendleCalldata === "0x") {
    throw new Error("Missing Pendle transaction data");
  }

  // Odos target and calldata are optional (for direct case)

  return true;
}
