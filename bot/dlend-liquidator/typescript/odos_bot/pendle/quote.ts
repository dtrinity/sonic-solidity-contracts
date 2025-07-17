import hre from "hardhat";

import { OdosClient } from "../../odos/client";
import { getPTMarketInfo, swapExactIn } from "../../pendle/sdk";
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
 * Uses exact out approach: calculates backwards from exact repay amount needed
 *
 * @param collateralTokenAddress - The address of the collateral token (PT token)
 * @param borrowTokenAddress - The address of the borrow token
 * @param repayAmount - The exact amount of borrow token needed (exact out)
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
  console.log("Getting PT+Odos two-stage swap quote (exact out approach)");
  console.log("PT Token:", collateralTokenAddress);
  console.log("Target Token:", borrowTokenAddress);
  console.log("Exact Repay Amount Needed:", repayAmount.toString());

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

  const pyMarketInfo = await getPTMarketInfo(effectivePTAddress, chainId);

  const readableRepayAmount = OdosClient.parseTokenAmount(
    repayAmount.toString(),
    Number(borrowDecimals),
  );

  console.log("Readable repay amount:", readableRepayAmount);

  // Step 1: Calculate how much underlying asset we need for exact borrow token amount
  console.log("Step 1: Calculating underlying needed for exact borrow token amount");
  
  let underlyingAmountNeeded: string;
  let odosTarget = "";
  let odosCalldata = "";
  let formattedUnderlyingAmount: string;

  if (pyMarketInfo.underlyingAsset.toLowerCase() === borrowTokenAddress.toLowerCase()) {
    // Direct case: underlying asset is the target token
    console.log("Direct case: underlying asset = target token");
    underlyingAmountNeeded = readableRepayAmount;
  } else {
    // Need Odos swap: calculate how much underlying needed for exact borrow token out
    console.log("Odos swap needed: calculating underlying input for exact borrow token output");
    
    const swapSlippageBufferPercentage = 0.5; // 0.5% buffer for Odos
    
    // Use Odos reverse calculation to find required underlying input
    const underlyingInputNeeded = await odosClient.calculateInputAmount(
      readableRepayAmount,
      borrowTokenAddress,
      pyMarketInfo.underlyingAsset,
      chainId,
      swapSlippageBufferPercentage,
    );

    underlyingAmountNeeded = underlyingInputNeeded;
    console.log("Underlying amount needed for Odos swap:", underlyingAmountNeeded);

    // Get Odos quote for the exact swap we'll need to do
    const underlyingToken = await hre.ethers.getContractAt(
      ["function decimals() view returns (uint8)"],
      pyMarketInfo.underlyingAsset,
    );
    const underlyingDecimals = await underlyingToken.decimals();

    formattedUnderlyingAmount = OdosClient.formatTokenAmount(
      underlyingInputNeeded,
      Number(underlyingDecimals),
    );

    const odosQuoteRequest = {
      chainId: chainId,
      inputTokens: [
        {
          tokenAddress: pyMarketInfo.underlyingAsset,
          amount: formattedUnderlyingAmount,
        },
      ],
      outputTokens: [{ tokenAddress: borrowTokenAddress, proportion: 1 }],
      userAddr: liquidatorAccountAddress,
      slippageLimitPercent: swapSlippageBufferPercentage,
    };

    const odosQuote = await odosClient.getQuote(odosQuoteRequest);
    console.log("Odos quote:", {
      inputAmount: formattedUnderlyingAmount,
      expectedOutput: odosQuote.outAmounts[0]
    });

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
  }

  // Step 2: Calculate how much PT needed for exact underlying amount
  console.log("Step 2: Calculating PT needed for exact underlying amount");
  console.log("Target underlying amount:", underlyingAmountNeeded);

  // For Pendle reverse calculation, we can use swapExactIn in reverse direction
  // by swapping underlying → PT to see the rate, then calculate the inverse
  const ptEstimationAmount = OdosClient.formatTokenAmount(
    "1", // 1 unit to get the rate
    Number(ptDecimals),
  );

  const rateResponse = await swapExactIn(
    effectivePTAddress,
    ptEstimationAmount,
    pyMarketInfo.underlyingAsset,
    receiverAddress,
    pyMarketInfo.marketAddress,
    chainId,
    0.01, // 1% slippage for rate calculation
  );

  // Calculate PT needed based on the rate
  const underlyingPerPT = Number(rateResponse.data.data.amountOut);
  const ptAmountNeeded = Number(underlyingAmountNeeded) / underlyingPerPT;
  
  // Add buffer for Pendle slippage and price impact
  const pendleSlippageBufferPercentage = 1.0; // 1% buffer for Pendle
  const ptAmountWithBuffer = ptAmountNeeded * (1 + pendleSlippageBufferPercentage / 100);

  const formattedPTAmount = OdosClient.formatTokenAmount(
    ptAmountWithBuffer,
    Number(ptDecimals),
  );

  console.log("PT calculation:", {
    underlyingPerPT,
    ptAmountNeeded,
    ptAmountWithBuffer,
    formattedPTAmount
  });

  // Step 3: Get the actual Pendle swap data for the calculated PT amount
  console.log("Step 3: Getting Pendle swap data for calculated PT amount");

  const pendleResponse = await swapExactIn(
    effectivePTAddress,
    formattedPTAmount,
    pyMarketInfo.underlyingAsset,
    receiverAddress,
    pyMarketInfo.marketAddress,
    chainId,
    0.01, // 1% slippage
  );

  const pendleData = pendleResponse.data;
  console.log("Pendle SDK response:", {
    ptInput: formattedPTAmount,
    underlyingOut: pendleData.data.amountOut,
    priceImpact: pendleData.data.priceImpact,
    target: pendleData.tx.to,
  });

  // Verify we get enough underlying from Pendle
  const actualUnderlyingOut = Number(pendleData.data.amountOut);
  const targetUnderlyingAmount = Number(underlyingAmountNeeded);
  
  if (actualUnderlyingOut < targetUnderlyingAmount) {
    console.warn(`Pendle output (${actualUnderlyingOut}) less than needed (${targetUnderlyingAmount})`);
    console.warn("Consider increasing PT input amount or slippage tolerance");
  }

  // Step 4: Create PTSwapData structure
  const ptSwapData: PTSwapData = {
    underlyingAsset: pyMarketInfo.underlyingAsset,
    pendleRouter: pendleData.tx.to,
    pendleCalldata: pendleData.tx.data,
    odosRouter: odosTarget,
    odosCalldata: odosCalldata,
  };

  console.log("Two-stage swap plan:");
  console.log(`  Stage 1 (Pendle): ${formattedPTAmount} PT → ${pendleData.data.amountOut} underlying`);
  console.log(`  Stage 2 (Odos): ${underlyingAmountNeeded} underlying → ${readableRepayAmount} target`);

  return { ptSwapData };
}


