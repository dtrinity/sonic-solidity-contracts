import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { setupInitialReserves } from "../../typescript/dlend";

// Define the reserve symbols to setup
const reserveSymbols = ["WETH", "scETH", "wstkscETH"];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log(
    `Starting setup for ${reserveSymbols.join(", ")} reserves using helper...`,
  );

  try {
    await setupInitialReserves(hre, reserveSymbols);
    console.log(
      `✅ ${__filename.split("/").slice(-2).join("/")}: ${reserveSymbols.join(", ")} reserves setup complete.`,
    );
  } catch (error) {
    console.error(
      `❌ Error setting up ${reserveSymbols.join(", ")} reserves:`,
      error,
    );
    return false;
  }

  return true;
};

// Update ID, Tags, and Dependencies
func.id = `add-eth-lst-reserves`;
func.tags = [
  "dlend",
  "dlend-market",
  "dlend-reserves",
  "dlend-eth-lst-reserves",
  "dlend-WETH",
  "dlend-scETH",
  "dlend-wstkscETH",
];
func.dependencies = [
  "dLend:init_reserves",
  "setup-weth-sceth-wstksceth-for-usd-oracle-wrapper",
];

export default func;
