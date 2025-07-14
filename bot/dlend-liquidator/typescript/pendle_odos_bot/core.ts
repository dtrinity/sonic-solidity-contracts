import { BigNumber } from "@ethersproject/bignumber";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import dotenv from "dotenv";
import { ethers } from "ethers";
import hre from "hardhat";
import path from "path";

import { getConfig } from "../../config/config";
import {
  FlashLoanLiquidatorAaveBorrowRepayPTOdos,
  FlashMintLiquidatorAaveBorrowRepayPTOdos,
} from "../../typechain-types";
import { batchProcessing, splitToBatches } from "../common/batch";
import { ShortTermIgnoreMemory } from "../common/cache";
import { saveToFile } from "../common/file";
import { printLog } from "../common/log";
import { getReserveTokensAddressesFromAddress } from "../dlend_helpers/reserve";
import {
  getAllLendingUserAddresses,
  getUserHealthFactor,
  UserStateLog,
} from "../dlend_helpers/user";
import { OdosClient } from "../odos/client";
import { QuoteResponse } from "../odos/types";
import { getERC4626UnderlyingAsset } from "../token/erc4626";
import { fetchTokenInfo } from "../token/info";
import {
  getPTOdosFlashLoanLiquidatorBotContract,
  getPTOdosFlashMintDStableLiquidatorBotContract,
} from "./bot_contract";
import {
  getLiquidationProfitInUSD,
  getUserLiquidationParams,
} from "../odos_bot/liquidation";
import { sendSlackMessage } from "../odos_bot/notification";
import { getAssembledQuote } from "../odos_bot/quote";
import { getPTOdosSwapQuote, createPTSwapData } from "./quote";

// Load environment variables
dotenv.config();

const notProfitableUserMemory = new ShortTermIgnoreMemory(
  3 * 60, // 3 minutes
  path.join(".", "state", `${hre.network.name}`),
);

/**
 * Run the PT+Odos liquidator bot
 *
 * @param index - The index of the run
 */
export async function runPTOdosBot(index: number): Promise<void> {
  printLog(index, "Running PT+Odos liquidator bot");

  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  let allUserAddresses = await getAllLendingUserAddresses();

  printLog(index, `Found ${allUserAddresses.length} users totally`);

  // Filter the ignored users
  allUserAddresses = allUserAddresses.filter(
    (userAddress: string) => !notProfitableUserMemory.isIgnored(userAddress),
  );
  printLog(
    index,
    `Found ${allUserAddresses.length} users after filtering the ignored ones`,
  );

  // Shuffle the user addresses to make sure all addresses have the opportunity to be checked
  allUserAddresses = allUserAddresses.sort(() => Math.random() - 0.5);

  const batchedAllUserAddresses = splitToBatches(
    allUserAddresses,
    config.liquidatorBotOdos.liquidatingBatchSize,
  );

  for (const batchUserAddresses of batchedAllUserAddresses) {
    const batchIndex = batchedAllUserAddresses.indexOf(batchUserAddresses);
    printLog(
      index,
      `Liquidating PT batch ${batchIndex + 1} of ${batchedAllUserAddresses.length}`,
    );

    const { deployer } = await hre.getNamedAccounts();

    try {
      await runPTBotBatch(
        index,
        batchUserAddresses,
        deployer,
        config.liquidatorBotOdos.healthFactorBatchSize,
        config.liquidatorBotOdos.healthFactorThreshold,
        config.liquidatorBotOdos.profitableThresholdInUSD,
      );
    } catch (error: any) {
      printLog(
        index,
        `Error occurred at PT batch ${batchIndex + 1} of ${batchedAllUserAddresses.length}: ${error}`,
      );
    }

    printLog(
      index,
      `Finished liquidating PT batch ${
        batchIndex + 1
      } of ${batchedAllUserAddresses.length}`,
    );
    printLog(index, ``);
  }

  printLog(index, `Finished running PT liquidator bot`);
}

/**
 * Run the PT+Odos liquidator bot for a batch of users
 *
 * @param index - The index of the run
 * @param allUserAddresses - The addresses of the users to liquidate
 * @param deployer - The address of the liquidator bot deployer
 * @param healthFactorBatchSize - The size of the health factor batch
 * @param healthFactorThreshold - The threshold of the health factor
 * @param profitableThresholdInUSD - The threshold of the liquidation profit in USD
 */
export async function runPTBotBatch(
  index: number,
  allUserAddresses: string[],
  deployer: string,
  healthFactorBatchSize: number,
  healthFactorThreshold: number,
  profitableThresholdInUSD: number,
): Promise<void> {
  const liquidatableUserInfos: {
    userAddress: string;
    healthFactor: number;
  }[] = [];

  printLog(
    index,
    `Checking health factors of ${allUserAddresses.length} users for PT liquidation`,
  );

  const healthFactorsRaw = await batchProcessing(
    allUserAddresses,
    healthFactorBatchSize,
    async (userAddress: string) => {
      try {
        if (!userAddress) {
          throw new Error("User address is not provided");
        }

        const res = await getUserHealthFactor(userAddress);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return res;
      } catch (error: any) {
        printLog(
          index,
          `Error occurred while getting health factor of user ${userAddress}: ${error.message}`,
        );
        return undefined;
      }
    },
    false,
  );

  // Only keep the health factors that are not undefined
  const healthFactors = healthFactorsRaw.filter(
    (healthFactor) => healthFactor !== undefined,
  ) as number[];

  printLog(index, `Fetched ${healthFactors.length} health factors`);

  if (healthFactors.length === 0) {
    printLog(index, `No health factors fetched, skipping PT liquidation`);
    return;
  }

  for (let i = 0; i < allUserAddresses.length; i++) {
    if (healthFactors[i] < healthFactorThreshold) {
      liquidatableUserInfos.push({
        userAddress: allUserAddresses[i],
        healthFactor: healthFactors[i],
      });
    }
  }

  printLog(index, `Found ${liquidatableUserInfos.length} liquidatable users for PT`);

  for (const userInfo of liquidatableUserInfos) {
    const userState: UserStateLog = {
      healthFactor: userInfo.healthFactor.toString(),
      toRepayAmount: "",
      collateralToken: undefined,
      debtToken: undefined,
      lastTrial: Date.now(),
      success: false,
      profitInUSD: "",
      profitable: false,
      step: "",
      error: "",
      errorMessage: "",
    };

    try {
      printLog(
        index,
        `Checking PT user ${userInfo.userAddress} for liquidation with health factor ${userInfo.healthFactor}`,
      );

      userState.step = "getting_user_liquidation_params";

      const liquidationParams = await getUserLiquidationParams(
        userInfo.userAddress,
      );

      userState.step = "got_user_liquidation_params";

      userState.toRepayAmount = liquidationParams.toRepayAmount.toString();
      userState.collateralToken = {
        address: liquidationParams.collateralToken.reserveTokenInfo.address,
        symbol: liquidationParams.collateralToken.reserveTokenInfo.symbol,
        decimals: liquidationParams.collateralToken.reserveTokenInfo.decimals,
      };
      userState.debtToken = {
        address: liquidationParams.debtToken.reserveTokenInfo.address,
        symbol: liquidationParams.debtToken.reserveTokenInfo.symbol,
        decimals: liquidationParams.debtToken.reserveTokenInfo.decimals,
      };

      if (liquidationParams.toRepayAmount.isZero()) {
        printLog(
          index,
          `PT User ${userInfo.userAddress} has 0 debt to repay, skipping`,
        );
        notProfitableUserMemory.put(userInfo.userAddress);

        userState.step = "no_debt_to_repay";
        userState.success = false;
        userState.error = "No debt to repay";
        userState.errorMessage = "No debt to repay";
      } else {
        // Check if collateral token is a PT token
        userState.step = "checking_pt_token";
        
        const isPTToken = await checkIfPTToken(liquidationParams.collateralToken.reserveTokenInfo.address);
        
        if (!isPTToken) {
          printLog(
            index,
            `Collateral token ${liquidationParams.collateralToken.reserveTokenInfo.symbol} is not a PT token, skipping PT liquidation`,
          );
          notProfitableUserMemory.put(userInfo.userAddress);
          userState.step = "not_pt_token";
          userState.success = false;
          userState.error = "Not a PT token";
          userState.errorMessage = "Collateral is not a PT token";
          continue;
        }

        userState.step = "getting_liquidation_profit_in_usd";

        const liquidationProfitInUSD = await getLiquidationProfitInUSD(
          liquidationParams.debtToken.reserveTokenInfo,
          {
            rawValue: BigNumber.from(liquidationParams.debtToken.priceInUSD),
            decimals: liquidationParams.debtToken.priceDecimals,
          },
          liquidationParams.toRepayAmount.toBigInt(),
        );

        userState.profitInUSD = liquidationProfitInUSD.toString();
        printLog(index, `PT Profit in USD: $${liquidationProfitInUSD.toFixed(4)}`);
        userState.profitable =
          liquidationProfitInUSD >= profitableThresholdInUSD;

        userState.step = "got_liquidation_profit_in_usd";

        if (userState.profitable) {
          printLog(
            index,
            `Liquidating PT user ${userInfo.userAddress} with health factor ${userInfo.healthFactor}`,
          );
          printLog(
            index,
            ` - PT Debt token: ${liquidationParams.debtToken.reserveTokenInfo.symbol}`,
          );
          printLog(
            index,
            ` - PT Collateral token: ${liquidationParams.collateralToken.reserveTokenInfo.symbol}`,
          );
          printLog(
            index,
            ` - PT To repay: ${liquidationParams.toRepayAmount.toString()}`,
          );

          userState.step = "profitable_pt_user_performing_liquidation";
          userState.lastTrial = Date.now();
          userState.success = false;

          const txHash = await performPTOdosLiquidationDefault(
            liquidationParams.userAddress,
            deployer,
            liquidationParams.debtToken.reserveTokenInfo.address,
            liquidationParams.collateralToken.reserveTokenInfo.address,
            liquidationParams.toRepayAmount.toBigInt(),
          );

          userState.step = "successful_pt_liquidation";
          userState.success = true;

          const successMessage =
            `<!channel> 🎯 *Successful PT Liquidation via Pendle+Odos* 🎯\n\n` +
            `User \`${userInfo.userAddress}\`:\n` +
            `• Health Factor: ${userInfo.healthFactor}\n` +
            `• Profit: $${Number(userState.profitInUSD).toFixed(6)}\n` +
            `• PT Collateral Token: ${userState.collateralToken?.symbol}\n` +
            `• Debt Token: ${userState.debtToken?.symbol}\n` +
            `• Repaid Amount: ${ethers.formatUnits(
              userState.toRepayAmount,
              userState.debtToken.decimals,
            )} ${userState.debtToken.symbol}\n` +
            `• Transaction Hash: ${txHash}`;

          await sendSlackMessage(successMessage);
        } else {
          printLog(
            index,
            `PT User ${userInfo.userAddress} is not profitable to liquidate due to profitable threshold: $${liquidationProfitInUSD.toFixed(4)} < $${profitableThresholdInUSD}`,
          );
          notProfitableUserMemory.put(userInfo.userAddress);

          userState.success = false;
          userState.step = "not_profitable_pt_user";
        }
      }
    } catch (error: any) {
      printLog(
        index,
        `Error occurred while liquidating PT user ${userInfo.userAddress}: ${error}`,
      );
      notProfitableUserMemory.put(userInfo.userAddress);

      userState.success = false;
      userState.error = error;
      userState.errorMessage = error.message;

      const debtTokenDecimals = userState.debtToken?.decimals;
      const debtTokenSymbol = userState.debtToken?.symbol;

      const errorMessage =
        `<!channel> ⚠️ *PT Liquidation Error (Pendle+Odos)* ⚠️\n\n` +
        `Failed to liquidate PT user \`${userInfo.userAddress}\`:\n` +
        `• Health Factor: ${userInfo.healthFactor}\n` +
        `• Error: ${error.message}\n` +
        `• PT Collateral Token: ${userState.collateralToken?.symbol}\n` +
        `• Debt Token: ${debtTokenSymbol}\n` +
        `• To Repay: ${ethers.formatUnits(
          userState.toRepayAmount,
          debtTokenDecimals,
        )} ${debtTokenSymbol}\n` +
        `• Profit (USD): $${Number(userState.profitInUSD).toFixed(6)}\n` +
        `• Step: ${userState.step}`;

      await sendSlackMessage(errorMessage);
    }

    saveToFile(
      path.join(
        notProfitableUserMemory.getStateDirPath(),
        "pt-user-states",
        `${userInfo.userAddress}.json`,
      ),
      JSON.stringify(userState, null, 2),
    );
  }
}

/**
 * Check if a token is a PT token by calling the contract's isPTToken method
 *
 * @param tokenAddress - The address of the token to check
 * @returns True if the token is a PT token
 */
async function checkIfPTToken(tokenAddress: string): Promise<boolean> {
  try {
    // Try to call expiry() method - PT tokens should have this
    const contract = await hre.ethers.getContractAt(
      ["function expiry() external view returns (uint256)"],
      tokenAddress,
    );
    
    // If this doesn't revert, it's likely a PT token
    await contract.expiry();
    return true;
  } catch {
    return false;
  }
}

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
  const signer = await hre.ethers.getSigner(liquidatorAccountAddress);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  const { odosApiUrl, odosRouter, isUnstakeTokens } = config.liquidatorBotOdos;
  const network = await hre.ethers.provider.getNetwork();
  const odosClient = new OdosClient(odosApiUrl);
  const chainId = Number(network.chainId);

  const collateralTokenInfo = await fetchTokenInfo(hre, collateralTokenAddress);
  const borrowTokenInfo = await fetchTokenInfo(hre, borrowTokenAddress);
  const isUnstakeToken = isUnstakeTokens[collateralTokenInfo.address] === true;

  if (isUnstakeToken) {
    console.log("Unstake token detected for PT liquidation, checking for underlying asset");
    const unstakeCollateralToken = await getERC4626UnderlyingAsset(
      collateralTokenInfo.address,
    );
    console.log("Unstake PT collateral token:", unstakeCollateralToken);
  }

  // Get PT swap quote and Odos quote
  const { ptSwapData } = await getPTOdosSwapQuote(
    collateralTokenAddress,
    borrowTokenAddress,
    repayAmount,
    liquidatorAccountAddress,
    chainId,
    odosClient,
    isUnstakeToken,
  );

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

  if (flashMinterAddresses.includes(borrowTokenInfo.address)) {
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

    console.log("Liquidating PT with flash minting");

    return await executeFlashMintPTLiquidation(
      flashMintPTLiquidatorBotContract,
      ptSwapData,
      odosRouter,
      signer,
      odosClient,
      params,
    );
  } else {
    const flashLoanPTLiquidatorBotContract =
      await getPTOdosFlashLoanLiquidatorBotContract(liquidatorAccountAddress);

    if (!flashLoanPTLiquidatorBotContract) {
      throw new Error("Flash loan PT liquidator bot contract not found");
    }

    console.log("Liquidating PT with flash loan");

    return await executeFlashLoanPTLiquidation(
      flashLoanPTLiquidatorBotContract,
      ptSwapData,
      odosRouter,
      signer,
      odosClient,
      params,
    );
  }
}

/**
 * Execute liquidation with flash mint for PT tokens
 *
 * @param flashMintPTLiquidatorBotContract - The flash mint PT liquidator bot contract
 * @param ptSwapData - The PT swap data
 * @param odosRouter - The Odos router
 * @param signer - The signer
 * @param odosClient - The Odos client
 * @param params - The parameters
 * @returns The transaction hash
 */
async function executeFlashMintPTLiquidation(
  flashMintPTLiquidatorBotContract: FlashMintLiquidatorAaveBorrowRepayPTOdos,
  ptSwapData: any,
  odosRouter: string,
  signer: HardhatEthersSigner,
  odosClient: OdosClient,
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
  const collateralTokenInfo = await fetchTokenInfo(hre, params.collateralTokenAddress);
  const borrowTokenInfo = await fetchTokenInfo(hre, params.borrowTokenAddress);

  const collateralReverseAddresses = await getReserveTokensAddressesFromAddress(
    collateralTokenInfo.address,
  );
  const borrowReverseAddresses = await getReserveTokensAddressesFromAddress(
    borrowTokenInfo.address,
  );

  // Encode PTSwapData for the contract
  const encodedSwapData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,uint256,address,bytes,address,bytes)"],
    [[
      ptSwapData.underlyingAsset,
      ptSwapData.expectedUnderlying,
      ptSwapData.pendleTarget,
      ptSwapData.pendleCalldata,
      ptSwapData.odosTarget || ethers.ZeroAddress,
      ptSwapData.odosCalldata || "0x",
    ]]
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
 * @param odosRouter - The Odos router
 * @param signer - The signer
 * @param odosClient - The Odos client
 * @param params - The parameters
 * @returns The transaction hash
 */
async function executeFlashLoanPTLiquidation(
  flashLoanPTLiquidatorBotContract: FlashLoanLiquidatorAaveBorrowRepayPTOdos,
  ptSwapData: any,
  odosRouter: string,
  signer: HardhatEthersSigner,
  odosClient: OdosClient,
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
  const collateralTokenInfo = await fetchTokenInfo(hre, params.collateralTokenAddress);
  const borrowTokenInfo = await fetchTokenInfo(hre, params.borrowTokenAddress);

  const collateralReverseAddresses = await getReserveTokensAddressesFromAddress(
    collateralTokenInfo.address,
  );
  const borrowReverseAddresses = await getReserveTokensAddressesFromAddress(
    borrowTokenInfo.address,
  );

  // Encode PTSwapData for the contract
  const encodedSwapData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,uint256,address,bytes,address,bytes)"],
    [[
      ptSwapData.underlyingAsset,
      ptSwapData.expectedUnderlying,
      ptSwapData.pendleTarget,
      ptSwapData.pendleCalldata,
      ptSwapData.odosTarget || ethers.ZeroAddress,
      ptSwapData.odosCalldata || "0x",
    ]]
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