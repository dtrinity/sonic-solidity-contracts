import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { setupNewReserves } from "../../typescript/dlend";

// Define the reserve symbols to setup
const reserveSymbols = ["PTaUSDC", "PTwstkscUSD", "wOS"];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log(
    `Starting setup for ${reserveSymbols.join(", ")} reserves using helper...`,
  );

  await setupNewReserves(hre, reserveSymbols);
  console.log(
    `✅ ${__filename.split("/").slice(-2).join("/")}: ${reserveSymbols.join(", ")} reserves setup complete.`,
  );

  return true;
};

func.id = `add-ptausdc-ptwstkscusd-wos-reserves`;
func.tags = [
  "dlend",
  "dlend-market",
  "dlend-reserves",
  "dlend-PTaUSDC",
  "dlend-PTwstkscUSD",
  "dlend-wOS",
];
func.dependencies = [
  "dLend:init_reserves",
  "setup-ptausdc-ptwstkscusd-wos-for-usd-oracle-wrapper",
];

export default func;
