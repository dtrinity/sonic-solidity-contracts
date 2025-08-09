import { ethers } from "ethers";
import hre from "hardhat";

import { getConfig } from "../../../config/config";
import {
  FlashLoanLiquidatorAaveBorrowRepayPTOdos,
  FlashMintLiquidatorAaveBorrowRepayPTOdos,
} from "../../../typechain-types";
import { getReserveTokensAddressesFromAddress } from "../../dlend_helpers/reserve";
import { OdosClient } from "../../odos/client";
import { getERC4626UnderlyingAsset } from "../../token/erc4626";
import { fetchTokenInfo } from "../../token/info";
import {
  getPTOdosFlashLoanLiquidatorBotContract,
  getPTOdosFlashMintDStableLiquidatorBotContract,
} from "./bot_contract";
import { getPTOdosSwapQuote, PTSwapData } from "./quote";

/**
 * Perform the liquidation using PT+Odos two-stage swaps
 *
 * @param borrowerAccountAddress - The address of the borrower
 * @param liquidatorAccountAddress - The address of the liquidator
 * @param borrowTokenAddress - The address of the borrow token
 * @param collateralTokenAddress - The address of the collateral token (PT token)
 * @param repayAmount - The amount of the repay
 * @returns The transaction hash
 */
export async function performPTOdosLiquidationDefault(
  borrowerAccountAddress: string,
  liquidatorAccountAddress: string,
  borrowTokenAddress: string,
  collateralTokenAddress: string,
  repayAmount: bigint,
): Promise<string> {
  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  const { odosApiUrl, isUnstakeTokens } = config.liquidatorBotOdos;
  const network = await hre.ethers.provider.getNetwork();
  const odosClient = new OdosClient(odosApiUrl);
  const chainId = Number(network.chainId);

  const collateralTokenInfo = await fetchTokenInfo(hre, collateralTokenAddress);
  const borrowTokenInfo = await fetchTokenInfo(hre, borrowTokenAddress);
  const isUnstakeToken = isUnstakeTokens[collateralTokenInfo.address] === true;

  if (isUnstakeToken) {
    console.log(
      "Unstake token detected for PT liquidation, checking for underlying asset",
    );
    const unstakeCollateralToken = await getERC4626UnderlyingAsset(
      collateralTokenInfo.address,
    );
    console.log("Unstake PT collateral token:", unstakeCollateralToken);
  }

  const params = {
    borrowerAccountAddress,
    borrowTokenAddress,
    collateralTokenAddress,
    repayAmount,
    chainId,
    liquidatorAccountAddress,
    isUnstakeToken,
  };

  const flashMinterAddresses = Object.values(
    config.liquidatorBotOdos.flashMinters,
  );

  // Determine which liquidation method to use and get the appropriate contract
  let receiverAddress: string;
  let liquidatorContract:
    | FlashMintLiquidatorAaveBorrowRepayPTOdos
    | FlashLoanLiquidatorAaveBorrowRepayPTOdos;
  let isFlashMint: boolean;

  if (flashMinterAddresses.includes(borrowTokenInfo.address)) {
    // Flash mint liquidation
    const flashMintPTLiquidatorBotContract =
      await getPTOdosFlashMintDStableLiquidatorBotContract(
        liquidatorAccountAddress,
        borrowTokenInfo.symbol,
      );

    if (!flashMintPTLiquidatorBotContract) {
      throw new Error(
        `Flash mint PT liquidator bot contract not found for ${borrowTokenInfo.symbol}`,
      );
    }

    receiverAddress = await flashMintPTLiquidatorBotContract.getAddress();
    liquidatorContract = flashMintPTLiquidatorBotContract;
    isFlashMint = true;
    console.log("Using flash mint liquidation, receiver:", receiverAddress);
  } else {
    // Flash loan liquidation
    const flashLoanPTLiquidatorBotContract =
      await getPTOdosFlashLoanLiquidatorBotContract(liquidatorAccountAddress);

    if (!flashLoanPTLiquidatorBotContract) {
      throw new Error("Flash loan PT liquidator bot contract not found");
    }

    receiverAddress = await flashLoanPTLiquidatorBotContract.getAddress();
    liquidatorContract = flashLoanPTLiquidatorBotContract;
    isFlashMint = false;
    console.log("Using flash loan liquidation, receiver:", receiverAddress);
  }

  // Get PT swap quote and Odos quote with the correct receiver address
  const { ptSwapData } = await getPTOdosSwapQuote(
    collateralTokenAddress,
    borrowTokenAddress,
    repayAmount,
    liquidatorAccountAddress,
    chainId,
    odosClient,
    isUnstakeToken,
    receiverAddress, // Now using the correct contract address
  );

  // Execute the appropriate liquidation
  if (isFlashMint) {
    console.log("Liquidating PT with flash minting");
    return await executeFlashMintPTLiquidation(
      liquidatorContract as FlashMintLiquidatorAaveBorrowRepayPTOdos,
      ptSwapData,
      params,
    );
  } else {
    console.log("Liquidating PT with flash loan");
    return await executeFlashLoanPTLiquidation(
      liquidatorContract as FlashLoanLiquidatorAaveBorrowRepayPTOdos,
      ptSwapData,
      params,
    );
  }
}

/**
 * Execute liquidation with flash mint for PT tokens
 *
 * @param flashMintPTLiquidatorBotContract - The flash mint PT liquidator bot contract
 * @param ptSwapData - The PT swap data
 * @param params - The parameters
 * @param params.borrowerAccountAddress - The address of the borrower
 * @param params.borrowTokenAddress - The address of the borrow token
 * @param params.collateralTokenAddress - The address of the collateral token
 * @param params.repayAmount - The amount of the repay
 * @param params.chainId - The chain ID
 * @param params.liquidatorAccountAddress - The address of the liquidator
 * @param params.isUnstakeToken - Whether to unstake the collateral token
 * @returns The transaction hash
 */
async function executeFlashMintPTLiquidation(
  flashMintPTLiquidatorBotContract: FlashMintLiquidatorAaveBorrowRepayPTOdos,
  ptSwapData: PTSwapData,
  params: {
    borrowerAccountAddress: string;
    borrowTokenAddress: string;
    collateralTokenAddress: string;
    repayAmount: bigint;
    chainId: number;
    liquidatorAccountAddress: string;
    isUnstakeToken: boolean;
  },
): Promise<string> {
  const collateralTokenInfo = await fetchTokenInfo(
    hre,
    params.collateralTokenAddress,
  );
  const borrowTokenInfo = await fetchTokenInfo(hre, params.borrowTokenAddress);

  const collateralReverseAddresses = await getReserveTokensAddressesFromAddress(
    collateralTokenInfo.address,
  );
  const borrowReverseAddresses = await getReserveTokensAddressesFromAddress(
    borrowTokenInfo.address,
  );

  // Encode PTSwapData for the contract
  const encodedSwapData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,address,bytes,address,bytes)"],
    [
      [
        ptSwapData.underlyingAsset,
        ptSwapData.pendleRouter,
        ptSwapData.pendleCalldata,
        ptSwapData.odosRouter || ethers.ZeroAddress,
        ptSwapData.odosCalldata || "0x",
      ],
    ],
  );

  const tx = await flashMintPTLiquidatorBotContract.liquidate(
    borrowReverseAddresses.aTokenAddress,
    collateralReverseAddresses.aTokenAddress,
    params.borrowerAccountAddress,
    params.repayAmount,
    false,
    params.isUnstakeToken,
    encodedSwapData,
  );
  const receipt = await tx.wait();
  return receipt?.hash as string;
}

/**
 * Execute liquidation with flash loan for PT tokens
 *
 * @param flashLoanPTLiquidatorBotContract - The flash loan PT liquidator bot contract
 * @param ptSwapData - The PT swap data
 * @param params - The parameters
 * @param params.borrowerAccountAddress - The address of the borrower
 * @param params.borrowTokenAddress - The address of the borrow token
 * @param params.collateralTokenAddress - The address of the collateral token
 * @param params.repayAmount - The amount of the repay
 * @param params.chainId - The chain ID
 * @param params.liquidatorAccountAddress - The address of the liquidator
 * @param params.isUnstakeToken - Whether to unstake the collateral token
 * @returns The transaction hash
 */
async function executeFlashLoanPTLiquidation(
  flashLoanPTLiquidatorBotContract: FlashLoanLiquidatorAaveBorrowRepayPTOdos,
  ptSwapData: PTSwapData,
  params: {
    borrowerAccountAddress: string;
    borrowTokenAddress: string;
    collateralTokenAddress: string;
    repayAmount: bigint;
    chainId: number;
    liquidatorAccountAddress: string;
    isUnstakeToken: boolean;
  },
): Promise<string> {
  const collateralTokenInfo = await fetchTokenInfo(
    hre,
    params.collateralTokenAddress,
  );
  const borrowTokenInfo = await fetchTokenInfo(hre, params.borrowTokenAddress);

  const collateralReverseAddresses = await getReserveTokensAddressesFromAddress(
    collateralTokenInfo.address,
  );
  const borrowReverseAddresses = await getReserveTokensAddressesFromAddress(
    borrowTokenInfo.address,
  );

  // Encode PTSwapData for the contract
  const encodedSwapData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,address,bytes,address,bytes)"],
    [
      [
        ptSwapData.underlyingAsset,
        ptSwapData.pendleRouter,
        ptSwapData.pendleCalldata,
        ptSwapData.odosRouter || ethers.ZeroAddress,
        ptSwapData.odosCalldata || "0x",
      ],
    ],
  );

  const tx = await flashLoanPTLiquidatorBotContract.liquidate(
    borrowReverseAddresses.aTokenAddress,
    collateralReverseAddresses.aTokenAddress,
    params.borrowerAccountAddress,
    params.repayAmount,
    false,
    params.isUnstakeToken,
    encodedSwapData,
  );
  const receipt = await tx.wait();
  return receipt?.hash as string;
}
