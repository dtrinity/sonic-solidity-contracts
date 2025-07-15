import hre from "hardhat";

import { OdosClient } from "../../odos/client";
import { getPTMarketInfo, swapExactPToToken } from "../../pendle/sdk";
import { getERC4626UnderlyingAsset } from "../../token/erc4626";

/**
 * Interface for PT swap data that will be encoded for the contract
 */
export interface PTSwapData {
  underlyingAsset: string; // Underlying asset from PT swap
  pendleRouter: string; // Target contract for Pendle transaction
  pendleCalldata: string; // Transaction data from Pendle SDK
  odosRouter: string; // Target contract for Odos transaction (can be zero address)
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
 * @param receiverAddress - The address of the contract that will receive the final tokens from swap operations
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
  receiverAddress: string,
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
  const pyMarketInfo = await getPTMarketInfo(effectivePTAddress, chainId);

  const estimatedPTAmount = await estimatePTInputAmount(
    pyMarketInfo.underlyingAsset,
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

  // Call Pendle SDK to get PT -> underlying swap data
  const pendleResponse = await swapExactPToToken(
    effectivePTAddress,
    formattedPTAmount,
    pyMarketInfo.underlyingAsset,
    receiverAddress,
    pyMarketInfo.marketAddress,
    chainId,
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

  if (
    pyMarketInfo.underlyingAsset.toLowerCase() !==
    borrowTokenAddress.toLowerCase()
  ) {
    console.log("Different tokens - need Odos swap from underlying to target");

    // Use the exact expected output from Pendle as input for Odos
    const underlyingAmountFromPendle = pendleData.data.amountOut;

    const odosQuoteRequest = {
      chainId: chainId,
      inputTokens: [
        {
          tokenAddress: pyMarketInfo.underlyingAsset,
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
      receiver: receiverAddress,
    };

    const assembled = await odosClient.assembleTransaction(assembleRequest);

    odosTarget = assembled.transaction.to;
    odosCalldata = assembled.transaction.data;
  } else {
    console.log("Same token - no Odos swap needed (direct case)");
  }

  // Step 3: Create PTSwapData structure
  const ptSwapData: PTSwapData = {
    underlyingAsset: pyMarketInfo.underlyingAsset,
    pendleRouter: pendleData.tx.to,
    pendleCalldata: pendleData.tx.data,
    odosRouter: odosTarget,
    odosCalldata: odosCalldata,
  };

  return { ptSwapData };
}

/**
 * Estimate PT input amount needed for a given target output
 * This is a helper function to estimate how much PT we need to swap
 *
 * @param ptUnderlyingAsset - PT underlying asset address
 * @param targetTokenAddress - Target token address
 * @param targetAmount - Target amount needed
 * @param chainId - Chain ID
 * @param odosClient - Odos client
 * @param slippageBuffer - Slippage buffer percentage
 * @returns Estimated PT input amount
 */
async function estimatePTInputAmount(
  ptUnderlyingAsset: string,
  targetTokenAddress: string,
  targetAmount: string,
  chainId: number,
  odosClient: OdosClient,
  slippageBuffer: number,
): Promise<number> {
  try {
    // If target is the same as underlying, we can estimate 1:1 (plus buffer)
    if (ptUnderlyingAsset.toLowerCase() === targetTokenAddress.toLowerCase()) {
      return Number(targetAmount) * (1 + slippageBuffer / 100);
    }

    // Otherwise, estimate via Odos reverse calculation
    const estimatedUnderlyingNeeded = await odosClient.calculateInputAmount(
      targetAmount,
      targetTokenAddress,
      ptUnderlyingAsset,
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
