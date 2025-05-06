import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { setupInitialReserves } from "../../typescript/dlend";

const reserveSymbol = "wstkscUSD";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log(`Starting setup for ${reserveSymbol} reserve using helper...`);

  try {
    await setupInitialReserves(hre, [reserveSymbol]);
    console.log(
      `✅ ${__filename.split("/").slice(-2).join("/")}: ${reserveSymbol} reserve setup complete.`,
    );
  } catch (error) {
    console.error(`❌ Error setting up ${reserveSymbol} reserve:`, error);
    return false;
  }

  return true;
};

// Update ID, Tags, and Dependencies
func.id = `add-${reserveSymbol}-reserve`;
func.tags = [
  "dlend",
  "dlend-market",
  "dlend-reserves",
  `dlend-${reserveSymbol}`,
];
func.dependencies = [
  "dLend:init_reserves",
  "setup-wstkscusd-for-usd-redstone-composite-oracle-wrapper",
];

export default func;
