import { batchProcessing } from "../common/batch";
import {
  getAllLendingUserAddresses,
  getUserAccountData,
} from "../dlend_helpers/user";

/**
 * Check health factors of all users
 *
 * To run this script, run the following command:
 *    yarn hardhat run --network <network> typescript/odos_bot/check-all-user-health-factors.ts
 */
async function main(): Promise<void> {
  console.log("Checking all user health factors");

  const allUserAddresses = await getAllLendingUserAddresses();
  console.log(`Found ${allUserAddresses.length} users totally`);

  const healthFactorBatchSize = 10;
  const userDataRaw = await batchProcessing(
    allUserAddresses,
    healthFactorBatchSize,
    async (userAddress: string) => {
      try {
        return getUserAccountData(userAddress);
      } catch (error: any) {
        console.log(
          `Error occurred while getting account data of user ${userAddress}: ${error.message}`,
        );
        return undefined;
      }
    },
    false,
  );

  // Only keep the user data that are not undefined
  const userData = userDataRaw.filter((data) => data !== undefined);

  console.log(`Fetched ${userData.length} user data entries`);

  if (userData.length === 0) {
    console.log(`No user data fetched`);
    return;
  }

  // Create array of user addresses and their data
  const userDetails = allUserAddresses
    .map((address, i) => {
      const data = userData[i];
      if (!data) return undefined;
      return {
        address,
        healthFactor: Number(data.healthFactor) / 1e18,
        totalCollateral: Number(data.totalCollateralBase) / 1e8,
        totalDebt: Number(data.totalDebtBase) / 1e8,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  // // Sort by health factor ascending
  // userDetails.sort((a, b) => a.healthFactor - b.healthFactor);

  // Sort by health factor ascending
  userDetails.sort((a, b) => a.healthFactor - b.healthFactor);

  // Print all user addresses and their data
  for (const {
    address,
    healthFactor,
    totalCollateral,
    totalDebt,
  } of userDetails) {
    // if both 0 collateral and debt, skip
    if (totalCollateral === 0 && totalDebt === 0) {
      continue;
    }
    const ltv = totalDebt / totalCollateral;
    console.log(
      `User ${address}:` +
        `\n  Health Factor    : ${healthFactor}` +
        `\n  LTV              : ${ltv}` +
        `\n  Total Collateral : ${totalCollateral}` +
        `\n  Total Debt       : ${totalDebt}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
