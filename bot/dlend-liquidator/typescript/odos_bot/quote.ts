import hre from "hardhat";

import { OdosClient } from "../odos/client";
import { getERC4626UnderlyingAsset } from "../token/erc4626";

/**
 * Get Odos swap quote and assembled transaction data
 *
 * @param collateralTokenAddress - The address of the collateral token
 * @param borrowTokenAddress - The address of the borrow token
 * @param repayAmount - The amount of the repay
 * @param liquidatorAccountAddress - The address of the liquidator
 * @param chainId - The chain ID
 * @param odosClient - The Odos client
 * @param isUnstakeToken - Whether the collateral token needs to be unstaked
 * @returns The quote and the collateral token
 */
export async function getOdosSwapQuote(
  collateralTokenAddress: string,
  borrowTokenAddress: string,
  repayAmount: bigint,
  liquidatorAccountAddress: string,
  chainId: number,
  odosClient: OdosClient,
  isUnstakeToken: boolean,
): Promise<{ quote: any; collateralToken: any }> {
  const collateralToken = await hre.ethers.getContractAt(
    ["function decimals() view returns (uint8)"],
    collateralTokenAddress,
  );
  const borrowToken = await hre.ethers.getContractAt(
    ["function decimals() view returns (uint8)"],
    borrowTokenAddress,
  );
  const collateralDecimals = await collateralToken.decimals();
  const borrowDecimals = await borrowToken.decimals();

  const readableRepayAmount = OdosClient.parseTokenAmount(
    repayAmount.toString(),
    Number(borrowDecimals),
  );

  let effectiveCollateralAddress = collateralTokenAddress;

  if (isUnstakeToken) {
    effectiveCollateralAddress = await getERC4626UnderlyingAsset(
      collateralTokenAddress,
    );
    console.log(
      "Using unstaked collateral token for quote:",
      effectiveCollateralAddress,
    );
  }

  const swapSlippageBufferPercentage = 0.5; // 0.5% buffer

  const inputAmount = await odosClient.calculateInputAmount(
    readableRepayAmount,
    borrowTokenAddress,
    effectiveCollateralAddress,
    chainId,
    swapSlippageBufferPercentage,
  );

  const formattedInputAmount = OdosClient.formatTokenAmount(
    inputAmount,
    Number(collateralDecimals),
  );

  const quoteRequest = {
    chainId: chainId,
    inputTokens: [
      {
        tokenAddress: effectiveCollateralAddress,
        amount: formattedInputAmount,
      },
    ],
    outputTokens: [{ tokenAddress: borrowTokenAddress, proportion: 1 }],
    userAddr: liquidatorAccountAddress,
    slippageLimitPercent: swapSlippageBufferPercentage,
  };

  const quote = await odosClient.getQuote(quoteRequest);
  return { quote, collateralToken };
}

/**
 * Get assembled quote from Odos with required approvals
 *
 * @param collateralToken - The collateral token
 * @param odosRouter - The Odos router
 * @param signer - The signer
 * @param odosClient - The Odos client
 * @param quote - The quote
 * @param params - The parameters
 * @param params.chainId - The chain ID
 * @param params.liquidatorAccountAddress - The address of the liquidator
 * @param receiverAddress - The address of the receiver
 * @returns The assembled quote
 */
export async function getAssembledQuote(
  collateralToken: any,
  odosRouter: string,
  signer: any,
  odosClient: OdosClient,
  quote: any,
  params: {
    chainId: number;
    liquidatorAccountAddress: string;
  },
  receiverAddress: string,
): Promise<any> {
  const approveRouterTx = await collateralToken
    .connect(signer)
    .approve(odosRouter, quote.inAmounts[0]);
  await approveRouterTx.wait();

  const assembleRequest = {
    chainId: params.chainId,
    pathId: quote.pathId,
    userAddr: params.liquidatorAccountAddress,
    simulate: false,
    receiver: receiverAddress,
  };
  const assembled = await odosClient.assembleTransaction(assembleRequest);

  const approveSwapperTx = await collateralToken
    .connect(signer)
    .approve(receiverAddress, quote.inAmounts[0]);
  await approveSwapperTx.wait();

  return assembled;
}
