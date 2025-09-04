import hre from "hardhat";

import {
  FLASH_LOAN_LIQUIDATOR_ODOS_ID,
  FLASH_MINT_DSTABLE_LIQUIDATOR_ODOS_ID,
} from "../../config/deploy-ids";
import {
  FlashLoanLiquidatorAaveBorrowRepayOdos,
  FlashMintLiquidatorAaveBorrowRepayOdos,
} from "../../typechain-types";

/**
 * Get the Odos flash mint liquidator bot contract
 *
 * @param callerAddress - The address of the caller
 * @param symbol - The symbol of the flash mint contract
 * @returns The flash mint liquidator bot contract
 */
export async function getOdosFlashMintDStableLiquidatorBotContract(
  callerAddress: string,
  symbol: string,
): Promise<FlashMintLiquidatorAaveBorrowRepayOdos> {
  if (!callerAddress) {
    throw new Error("Caller address is not provided");
  }

  const signer = await hre.ethers.getSigner(callerAddress);

  const deploymentId = getFlashMintContractDeploymentName(symbol);

  const liquidatorBotDeployment = await hre.deployments.get(deploymentId);

  if (!liquidatorBotDeployment) {
    throw new Error(`${deploymentId} bot deployment not found`);
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
  if (!callerAddress) {
    throw new Error("Caller address is not provided");
  }

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

/**
 * Get the deployment name for the flash mint contract
 *
 * @param symbol - The symbol of the flash mint contract
 * @returns The deployment name for the flash mint contract
 */
export function getFlashMintContractDeploymentName(symbol: string): string {
  return `${FLASH_MINT_DSTABLE_LIQUIDATOR_ODOS_ID}-${symbol}`;
}
