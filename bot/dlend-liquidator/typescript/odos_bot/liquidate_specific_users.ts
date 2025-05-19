import dotenv from "dotenv";
import hre from "hardhat";

import { getConfig } from "../../config/config";
import { printLog } from "../common/log";
import { getUserHealthFactor } from "../dlend_helpers/user";
import { runBotBatch } from "./core";

dotenv.config();

/**
 * This script liquidates specific users by their addresses using Odos pools.
 *
 * To run this script, run the following command:
 *    yarn hardhat run --network <network> typescript/odos_bot/liquidate_specific_users.ts
 */
async function main(): Promise<void> {
  const userAddresses = process.env.USER_ADDRESSES?.split(",");

  if (!userAddresses) {
    throw new Error(
      "USER_ADDRESSES must be set in environment variables. Example: 0x123,0x456,0x789",
    );
  }

  const index = 1;
  const { deployer } = await hre.getNamedAccounts();

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
