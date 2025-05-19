import { getUserLiquidationParams } from "./liquidation";

/**
 * Example of how to get the liquidation parameters for a user
 */
async function main(): Promise<void> {
  // Example user address to check for liquidation
  const userAddress = "0x9f33ad57a2861bbdb05b1c0156ea065f6f1f1ea8";

  try {
    const liquidationParams = await getUserLiquidationParams(userAddress);

    console.log("Liquidation Parameters:");
    console.log("User Address:", liquidationParams.userAddress);
    console.log(
      "Collateral Token:",
      liquidationParams.collateralToken.reserveTokenInfo.symbol,
    );
    console.log(
      "Debt Token:",
      liquidationParams.debtToken.reserveTokenInfo.symbol,
    );
    console.log("Amount to Repay:", liquidationParams.toRepayAmount.toString());
  } catch (error) {
    console.error("Error getting liquidation params:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
