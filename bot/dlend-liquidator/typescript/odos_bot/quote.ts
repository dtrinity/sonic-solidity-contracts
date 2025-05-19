import { BigNumber } from "@ethersproject/bignumber";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import hre from "hardhat";

import { approveAllowanceIfNeeded } from "../common/erc20";
import { OdosClient } from "../odos/client";
import { QuoteResponse } from "../odos/types";
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
 * @returns The quote
 */
export async function getOdosSwapQuote(
  collateralTokenAddress: string,
  borrowTokenAddress: string,
  repayAmount: bigint,
  liquidatorAccountAddress: string,
  chainId: number,
  odosClient: OdosClient,
  isUnstakeToken: boolean,
): Promise<{ quote: QuoteResponse }> {
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
  return { quote };
}

/**
 * Get assembled quote from Odos with required approvals
 *
 * @param odosRouter - The Odos router
 * @param signer - The signer
 * @param odosClient - The Odos client
 * @param quote - The quote
 * @param params - The parameters
 * @param params.chainId - The chain ID
 * @param params.liquidatorAccountAddress - The address of the liquidator
 * @param params.collateralTokenAddress - The address of the collateral token
 * @param receiverAddress - The address of the receiver
 * @returns The assembled quote
 */
export async function getAssembledQuote(
  odosRouter: string,
  signer: HardhatEthersSigner,
  odosClient: OdosClient,
  quote: QuoteResponse,
  params: {
    chainId: number;
    liquidatorAccountAddress: string;
    collateralTokenAddress: string;
  },
  receiverAddress: string,
): Promise<any> {
  await approveAllowanceIfNeeded(
    params.collateralTokenAddress,
    odosRouter,
    BigNumber.from(quote.inAmounts[0]),
    signer,
  );

  const assembleRequest = {
    chainId: params.chainId,
    pathId: quote.pathId,
    userAddr: params.liquidatorAccountAddress,
    simulate: false,
    receiver: receiverAddress,
  };
  const assembled = await odosClient.assembleTransaction(assembleRequest);

  await approveAllowanceIfNeeded(
    params.collateralTokenAddress,
    receiverAddress,
    BigNumber.from(quote.inAmounts[0]),
    signer,
  );

  return assembled;
}
