import hre from "hardhat";

import { getConfig } from "../../config/config";
import { printLog } from "../common/log";
import { getUserHealthFactor } from "../dlend_helpers/user";
import {
  getOdosFlashLoanLiquidatorBotContract,
  getOdosFlashMintDUSDLiquidatorBotContract,
} from "./bot_contract";
import { runBotBatch } from "./core";

/**
 * This script liquidates specific users by their addresses using Odos pools.
 *
 * To run this script, run the following command:
 *    yarn hardhat run --network <network> typescript/odos_bot/liquidate_specific_users.ts
 */
async function main(): Promise<void> {
  const userAddresses: string[] = [
    // Specify the user addresses to liquidate
    "0x781ee269d636b9ecb7c590fcb50120905854e94e",
  ];

  const index = 1;
  const { deployer } = await hre.getNamedAccounts();
  const flashMintLiquidatorBotContract =
    await getOdosFlashMintDUSDLiquidatorBotContract(deployer);
  const flashLoanLiquidatorBotContract =
    await getOdosFlashLoanLiquidatorBotContract(deployer);

  printLog(index, "Printing health factors of the users to liquidate");

  for (const userAddress of userAddresses) {
    const healthFactor = await getUserHealthFactor(userAddress);
    printLog(index, `User: ${userAddress}, Health Factor: ${healthFactor}`);
  }
  printLog(index, "");

  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not set");
  }

  printLog(index, `Liquidating ${userAddresses.length} users`);
  await runBotBatch(
    index,
    userAddresses,
    deployer,
    flashMintLiquidatorBotContract,
    flashLoanLiquidatorBotContract,
    config.liquidatorBotOdos.healthFactorBatchSize,
    config.liquidatorBotOdos.healthFactorThreshold,
    config.liquidatorBotOdos.profitableThresholdInUSD,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
