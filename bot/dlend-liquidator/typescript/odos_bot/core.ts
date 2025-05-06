import { BigNumber } from "@ethersproject/bignumber";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import dotenv from "dotenv";
import { ethers } from "ethers";
import hre from "hardhat";
import path from "path";

import { getConfig } from "../../config/config";
import {
  FlashLoanLiquidatorAaveBorrowRepayOdos,
  FlashMintLiquidatorAaveBorrowRepayOdos,
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
  getOdosFlashLoanLiquidatorBotContract,
  getOdosFlashMintDUSDLiquidatorBotContract,
} from "./bot_contract";
import { NotProfitableLiquidationError } from "./error";
import {
  getLiquidationProfitInUSD,
  getUserLiquidationParams,
} from "./liquidation";
import { sendSlackMessage } from "./notification";
import { getAssembledQuote, getOdosSwapQuote } from "./quote";

// Load environment variables
dotenv.config();

const notProfitableUserMemory = new ShortTermIgnoreMemory(
  3 * 60, // 3 minutes
  path.join(".", "state", `${hre.network.name}`),
);

/**
 * Run the Odos liquidator bot
 *
 * @param index - The index of the run
 */
export async function runOdosBot(index: number): Promise<void> {
  printLog(index, "Running Odos liquidator bot");

  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  const { deployer } = await hre.getNamedAccounts();
  const flashMintLiquidatorBotContract =
    await getOdosFlashMintDUSDLiquidatorBotContract(deployer);
  const flashLoanLiquidatorBotContract =
    await getOdosFlashLoanLiquidatorBotContract(deployer);

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
      `Liquidating batch ${batchIndex + 1} of ${batchedAllUserAddresses.length}`,
    );

    try {
      await runBotBatch(
        index,
        batchUserAddresses,
        deployer,
        flashMintLiquidatorBotContract,
        flashLoanLiquidatorBotContract,
        config.liquidatorBotOdos.healthFactorBatchSize,
        config.liquidatorBotOdos.healthFactorThreshold,
        config.liquidatorBotOdos.profitableThresholdInUSD,
      );
    } catch (error: any) {
      printLog(
        index,
        `Error occurred at batch ${batchIndex + 1} of ${batchedAllUserAddresses.length}: ${error}`,
      );
    }

    printLog(
      index,
      `Finished liquidating batch ${
        batchIndex + 1
      } of ${batchedAllUserAddresses.length}`,
    );
    printLog(index, ``);
  }

  printLog(index, `Finished running liquidator bot`);
}

/**
 * Run the Odos liquidator bot for a batch of users
 *
 * @param index - The index of the run
 * @param allUserAddresses - The addresses of the users to liquidate
 * @param deployer - The address of the liquidator bot deployer
 * @param flashMintLiquidatorBotContract - The flash mint liquidator bot contract
 * @param flashLoanLiquidatorBotContract - The flash loan liquidator bot contract
 * @param healthFactorBatchSize - The size of the health factor batch
 * @param healthFactorThreshold - The threshold of the health factor
 * @param profitableThresholdInUSD - The threshold of the liquidation profit in USD
 */
export async function runBotBatch(
  index: number,
  allUserAddresses: string[],
  deployer: string,
  flashMintLiquidatorBotContract: FlashMintLiquidatorAaveBorrowRepayOdos,
  flashLoanLiquidatorBotContract: FlashLoanLiquidatorAaveBorrowRepayOdos,
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
    `Checking health factors of ${allUserAddresses.length} users`,
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
    printLog(index, `No health factors fetched, skipping`);
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

  printLog(index, `Found ${liquidatableUserInfos.length} liquidatable users`);

  for (const userInfo of liquidatableUserInfos) {
    const userState: UserStateLog = {
      healthFactor: userInfo.healthFactor.toString(),
      toLiquidateAmount: "",
      collateralToken: undefined,
      debtToken: undefined,
      lastTrial: Date.now(),
      success: false,
      profitInUSD: "",
      profitable: false,
      error: "",
      errorMessage: "",
    };

    try {
      printLog(
        index,
        `Checking user ${userInfo.userAddress} for liquidation with health factor ${userInfo.healthFactor}`,
      );

      const liquidationParams = await getUserLiquidationParams(
        userInfo.userAddress,
      );

      userState.toLiquidateAmount =
        liquidationParams.toLiquidateAmount.toString();
      userState.collateralToken = {
        address: liquidationParams.collateralToken.reserveTokenInfo.address,
        symbol: liquidationParams.collateralToken.reserveTokenInfo.symbol,
      };
      userState.debtToken = {
        address: liquidationParams.debtToken.reserveTokenInfo.address,
        symbol: liquidationParams.debtToken.reserveTokenInfo.symbol,
      };

      if (liquidationParams.toLiquidateAmount.isZero()) {
        printLog(
          index,
          `User ${userInfo.userAddress} has 0 debt to liquidate, skipping`,
        );
        notProfitableUserMemory.put(userInfo.userAddress);

        userState.success = false;
        userState.error = "No debt to liquidate";
        userState.errorMessage = "No debt to liquidate";
      } else {
        const liquidationProfitInUSD = await getLiquidationProfitInUSD(
          liquidationParams.debtToken.reserveTokenInfo,
          {
            rawValue: BigNumber.from(liquidationParams.debtToken.priceInUSD),
            decimals: liquidationParams.debtToken.priceDecimals,
          },
          liquidationParams.toLiquidateAmount.toBigInt(),
        );

        userState.profitInUSD = liquidationProfitInUSD.toString();
        userState.profitable =
          liquidationProfitInUSD >= profitableThresholdInUSD;

        if (userState.profitable) {
          printLog(
            index,
            `Liquidating user ${userInfo.userAddress} with health factor ${userInfo.healthFactor}`,
          );

          userState.lastTrial = Date.now();
          userState.success = false;

          const txHash = await performOdosLiquidationDefault(
            liquidationParams.userAddress,
            deployer,
            liquidationParams.debtToken.reserveTokenInfo.address,
            liquidationParams.collateralToken.reserveTokenInfo.address,
            liquidationParams.toLiquidateAmount.toBigInt(),
            flashMintLiquidatorBotContract,
            flashLoanLiquidatorBotContract,
          );

          userState.success = true;

          const successMessage =
            `<!channel> 🎯 *Successful Liquidation via Odos DEX* 🎯\n\n` +
            `User \`${userInfo.userAddress}\`:\n` +
            `• Health Factor: ${userInfo.healthFactor}\n` +
            `• Profit: $${Number(userState.profitInUSD).toFixed(2)}\n` +
            `• Collateral Token: ${userState.collateralToken?.symbol}\n` +
            `• Debt Token: ${userState.debtToken?.symbol}\n` +
            `• Repaid Amount: ${ethers.formatUnits(
              userState.toLiquidateAmount,
              liquidationParams.debtToken.reserveTokenInfo.decimals,
            )} ${liquidationParams.debtToken.reserveTokenInfo.symbol}\n` +
            `• Transaction Hash: ${txHash}`;

          await sendSlackMessage(successMessage);
        } else {
          printLog(
            index,
            `User ${userInfo.userAddress} is not profitable to liquidate due to profitable threshold`,
          );
          notProfitableUserMemory.put(userInfo.userAddress);

          userState.success = false;
        }
      }
    } catch (error: any) {
      if (error instanceof NotProfitableLiquidationError) {
        printLog(
          index,
          `User ${userInfo.userAddress} is not profitable to liquidate with error: ${error.message}`,
        );
        notProfitableUserMemory.put(userInfo.userAddress);

        userState.success = false;
        userState.collateralToken = {
          address: error.collateralTokenInfo.address,
          symbol: error.collateralTokenInfo.symbol,
        };
        userState.debtToken = {
          address: error.borrowTokenInfo.address,
          symbol: error.borrowTokenInfo.symbol,
        };
        userState.error = error;
        userState.errorMessage = error.message;
      } else {
        printLog(
          index,
          `Error occurred while liquidating user ${userInfo.userAddress}: ${error}`,
        );
        notProfitableUserMemory.put(userInfo.userAddress);

        userState.success = false;
        userState.error = error;
        userState.errorMessage = error.message;

        const errorMessage =
          `<!channel> ⚠️ *Odos DEX Liquidation Error* ⚠️\n\n` +
          `Failed to liquidate user \`${userInfo.userAddress}\`:\n` +
          `• Health Factor: ${userInfo.healthFactor}\n` +
          `• Error: ${error.message}\n` +
          `• Collateral Token: ${userState.collateralToken?.symbol}\n` +
          `• Debt Token: ${userState.debtToken?.symbol}`;

        await sendSlackMessage(errorMessage);
      }
    }

    saveToFile(
      path.join(
        notProfitableUserMemory.getStateDirPath(),
        "user-states",
        `${userInfo.userAddress}.json`,
      ),
      JSON.stringify(userState, null, 2),
    );
  }
}

/**
 * Perform the liquidation using Odos for swaps
 *
 * @param borrowerAccountAddress - The address of the borrower
 * @param liquidatorAccountAddress - The address of the liquidator
 * @param borrowTokenAddress - The address of the borrow token
 * @param collateralTokenAddress - The address of the collateral token
 * @param repayAmount - The amount of the repay
 * @param flashMintLiquidatorBotContract - The flash mint liquidator bot contract
 * @param flashLoanLiquidatorBotContract - The flash loan liquidator bot contract
 * @returns The transaction hash
 */
export async function performOdosLiquidationDefault(
  borrowerAccountAddress: string,
  liquidatorAccountAddress: string,
  borrowTokenAddress: string,
  collateralTokenAddress: string,
  repayAmount: bigint,
  flashMintLiquidatorBotContract:
    | FlashMintLiquidatorAaveBorrowRepayOdos
    | undefined,
  flashLoanLiquidatorBotContract:
    | FlashLoanLiquidatorAaveBorrowRepayOdos
    | undefined,
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
    console.log("Unstake token detected, checking for underlying asset");
    const unstakeCollateralToken = await getERC4626UnderlyingAsset(
      collateralTokenInfo.address,
    );
    console.log("Unstake collateral token:", unstakeCollateralToken);
  }

  const { quote } = await getOdosSwapQuote(
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

  if (borrowTokenInfo.address === config.liquidatorBotOdos.dUSDAddress) {
    if (!flashMintLiquidatorBotContract) {
      throw new Error("Flash mint liquidator bot contract not found");
    }

    console.log("Liquidating with flash minting");

    return await executeFlashMintLiquidation(
      flashMintLiquidatorBotContract,
      quote,
      odosRouter,
      signer,
      odosClient,
      params,
    );
  } else {
    if (!flashLoanLiquidatorBotContract) {
      throw new Error("Flash loan liquidator bot contract not found");
    }

    console.log("Liquidating with flash loan");

    return await executeFlashLoanLiquidation(
      flashLoanLiquidatorBotContract,
      quote,
      odosRouter,
      signer,
      odosClient,
      params,
    );
  }
}

/**
 * Execute liquidation with flash mint
 *
 * @param flashMintLiquidatorBotContract - The flash mint liquidator bot contract
 * @param quote - The quote
 * @param odosRouter - The Odos router
 * @param signer - The signer
 * @param odosClient - The Odos client
 * @param params - The parameters
 * @param params.borrowerAccountAddress - The address of the borrower
 * @param params.borrowTokenAddress - The address of the borrow token
 * @param params.collateralTokenAddress - The address of the collateral token
 * @param params.repayAmount - The amount of the repay
 * @param params.chainId - The chain ID
 * @param params.liquidatorAccountAddress - The address of the liquidator
 * @param params.isUnstakeToken - Whether the collateral token needs to be unstaked
 * @returns The transaction hash
 */
async function executeFlashMintLiquidation(
  flashMintLiquidatorBotContract: FlashMintLiquidatorAaveBorrowRepayOdos,
  quote: QuoteResponse,
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
  const assembledQuote = await getAssembledQuote(
    odosRouter,
    signer,
    odosClient,
    quote,
    params,
    await flashMintLiquidatorBotContract.getAddress(),
  );

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

  const tx = await flashMintLiquidatorBotContract.liquidate(
    borrowReverseAddresses.aTokenAddress,
    collateralReverseAddresses.aTokenAddress,
    params.borrowerAccountAddress,
    params.repayAmount,
    false,
    params.isUnstakeToken,
    assembledQuote.transaction.data,
  );
  const receipt = await tx.wait();
  return receipt?.hash as string;
}

/**
 * Execute liquidation with flash loan
 *
 * @param flashLoanLiquidatorBotContract - The flash loan liquidator bot contract
 * @param quote - The quote
 * @param odosRouter - The Odos router
 * @param signer - The signer
 * @param odosClient - The Odos client
 * @param params - The parameters
 * @param params.borrowerAccountAddress - The address of the borrower
 * @param params.borrowTokenAddress - The address of the borrow token
 * @param params.collateralTokenAddress - The address of the collateral token
 * @param params.repayAmount - The amount of the repay
 * @param params.chainId - The chain ID
 * @param params.liquidatorAccountAddress - The address of the liquidator
 * @param params.isUnstakeToken - Whether the collateral token needs to be unstaked
 * @returns The transaction hash
 */
async function executeFlashLoanLiquidation(
  flashLoanLiquidatorBotContract: FlashLoanLiquidatorAaveBorrowRepayOdos,
  quote: QuoteResponse,
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
  const assembledQuote = await getAssembledQuote(
    odosRouter,
    signer,
    odosClient,
    quote,
    params,
    await flashLoanLiquidatorBotContract.getAddress(),
  );

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

  const tx = await flashLoanLiquidatorBotContract.liquidate(
    borrowReverseAddresses.aTokenAddress,
    collateralReverseAddresses.aTokenAddress,
    params.borrowerAccountAddress,
    params.repayAmount,
    false,
    params.isUnstakeToken,
    assembledQuote.transaction.data,
  );
  const receipt = await tx.wait();
  return receipt?.hash as string;
}
