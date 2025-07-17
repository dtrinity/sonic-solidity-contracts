import hre from "hardhat";

import {
  FLASH_LOAN_LIQUIDATOR_PT_ODOS_ID,
  FLASH_MINT_DSTABLE_LIQUIDATOR_PT_ODOS_ID,
} from "../../../config/deploy-ids";
import {
  FlashLoanLiquidatorAaveBorrowRepayPTOdos,
  FlashMintLiquidatorAaveBorrowRepayPTOdos,
} from "../../../typechain-types";

/**
 * Get the PT+Odos flash mint liquidator bot contract
 *
 * @param callerAddress - The address of the caller
 * @param symbol - The symbol of the flash mint contract
 * @returns The flash mint liquidator bot contract
 */
export async function getPTOdosFlashMintDStableLiquidatorBotContract(
  callerAddress: string,
  symbol: string,
): Promise<FlashMintLiquidatorAaveBorrowRepayPTOdos> {
  if (!callerAddress) {
    throw new Error("Caller address is not provided");
  }

  const signer = await hre.ethers.getSigner(callerAddress);

  const deploymentId = getFlashMintPTContractDeploymentName(symbol);

  const liquidatorBotDeployment = await hre.deployments.get(deploymentId);

  if (!liquidatorBotDeployment) {
    throw new Error(`${deploymentId} bot deployment not found`);
  }

  const contract = await hre.ethers.getContractAt(
    "FlashMintLiquidatorAaveBorrowRepayPTOdos",
    liquidatorBotDeployment.address,
    signer,
  );

  return contract as unknown as FlashMintLiquidatorAaveBorrowRepayPTOdos;
}

/**
 * Get the PT+Odos flash loan liquidator bot contract
 *
 * @param callerAddress - The address of the caller
 * @returns The flash loan liquidator bot contract
 */
export async function getPTOdosFlashLoanLiquidatorBotContract(
  callerAddress: string,
): Promise<FlashLoanLiquidatorAaveBorrowRepayPTOdos> {
  if (!callerAddress) {
    throw new Error("Caller address is not provided");
  }

  const signer = await hre.ethers.getSigner(callerAddress);

  const liquidatorBotDeployment = await hre.deployments.get(
    FLASH_LOAN_LIQUIDATOR_PT_ODOS_ID,
  );

  if (!liquidatorBotDeployment) {
    throw new Error(
      `${FLASH_LOAN_LIQUIDATOR_PT_ODOS_ID} bot deployment not found`,
    );
  }

  const contract = await hre.ethers.getContractAt(
    "FlashLoanLiquidatorAaveBorrowRepayPTOdos",
    liquidatorBotDeployment.address,
    signer,
  );

  return contract as unknown as FlashLoanLiquidatorAaveBorrowRepayPTOdos;
}

/**
 * Get the deployment name for the flash mint PT contract
 *
 * @param symbol - The symbol of the flash mint contract
 * @returns The deployment name for the flash mint PT contract
 */
export function getFlashMintPTContractDeploymentName(symbol: string): string {
  return `${FLASH_MINT_DSTABLE_LIQUIDATOR_PT_ODOS_ID}-${symbol}`;
}
