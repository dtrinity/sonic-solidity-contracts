import hre from "hardhat";

import {
  FLASH_LOAN_LIQUIDATOR_ODOS_ID,
  FLASH_MINT_DUSD_LIQUIDATOR_ODOS_ID,
} from "../../config/deploy-ids";
import {
  FlashLoanLiquidatorAaveBorrowRepayOdos,
  FlashMintLiquidatorAaveBorrowRepayOdos,
} from "../../typechain-types";

/**
 * Get the Odos flash mint liquidator bot contract
 *
 * @param callerAddress - The address of the caller
 * @returns The flash mint liquidator bot contract
 */
export async function getOdosFlashMintDUSDLiquidatorBotContract(
  callerAddress: string,
): Promise<FlashMintLiquidatorAaveBorrowRepayOdos> {
  const signer = await hre.ethers.getSigner(callerAddress);

  const liquidatorBotDeployment = await hre.deployments.get(
    FLASH_MINT_DUSD_LIQUIDATOR_ODOS_ID,
  );

  if (!liquidatorBotDeployment) {
    throw new Error(
      `${FLASH_MINT_DUSD_LIQUIDATOR_ODOS_ID} bot deployment not found`,
    );
  }

  const contract = await hre.ethers.getContractAt(
    "FlashMintLiquidatorAaveBorrowRepayOdos",
    liquidatorBotDeployment.address,
    signer,
  );

  return contract as unknown as FlashMintLiquidatorAaveBorrowRepayOdos;
}

/**
 * Get the Odos flash loan liquidator bot contract
 *
 * @param callerAddress - The address of the caller
 * @returns The flash loan liquidator bot contract
 */
export async function getOdosFlashLoanLiquidatorBotContract(
  callerAddress: string,
): Promise<FlashLoanLiquidatorAaveBorrowRepayOdos> {
  const signer = await hre.ethers.getSigner(callerAddress);

  const liquidatorBotDeployment = await hre.deployments.get(
    FLASH_LOAN_LIQUIDATOR_ODOS_ID,
  );

  if (!liquidatorBotDeployment) {
    throw new Error(
      `${FLASH_LOAN_LIQUIDATOR_ODOS_ID} bot deployment not found`,
    );
  }

  const contract = await hre.ethers.getContractAt(
    "FlashLoanLiquidatorAaveBorrowRepayOdos",
    liquidatorBotDeployment.address,
    signer,
  );

  return contract as unknown as FlashLoanLiquidatorAaveBorrowRepayOdos;
}
