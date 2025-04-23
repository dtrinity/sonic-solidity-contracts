import axios from "axios";
import hre from "hardhat";

import { getConfig } from "../../config/config";
import { getPoolContractAddress } from "./pool";

export interface UserStateLog {
  healthFactor: string;
  toLiquidateAmount: string;
  collateralToken:
    | {
        address: string;
        symbol: string;
      }
    | undefined;
  debtToken:
    | {
        address: string;
        symbol: string;
      }
    | undefined;
  lastTrial: number;
  profitInUSD: string;
  profitable: boolean;
  success: boolean;
  error: Error | string;
  errorMessage: string;
}

export interface User {
  id: string;
}

/**
 * Get the user account data on the Lending Pool
 *
 * @param userAddress - The address of the user
 * @returns - User account data on the Lending Pool
 */
export async function getUserAccountData(userAddress: string): Promise<{
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
}> {
  const poolContractAddress = await getPoolContractAddress();
  const poolContract = await hre.ethers.getContractAt(
    [
      "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
    ],
    poolContractAddress,
  );
  return await poolContract.getUserAccountData(userAddress);
}

/**
 * Get the scaled health factor of the user on the Lending Pool
 *
 * @param userAddress - The address of the user
 * @returns - The scaled health factor of the user on the Lending Pool
 */
export async function getUserHealthFactor(
  userAddress: string,
): Promise<number> {
  const { healthFactor } = await getUserAccountData(userAddress);
  return Number(healthFactor) / 1e18;
}

/**
 * Get all users in the Lending Pool for Odos liquidation
 *
 * @returns All user addresses
 */
export async function getAllLendingUserAddresses(): Promise<string[]> {
  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  const graphUrl = config.liquidatorBotOdos.graphConfig.url;

  if (graphUrl.length < 10) {
    throw Error("Invalid graph URL: " + graphUrl);
  }

  const batchSize = config.liquidatorBotOdos.graphConfig.batchSize;

  if (batchSize < 1) {
    throw Error("Invalid batch size: " + batchSize);
  }

  const query = `query GetAccounts($first: Int, $lastId: ID){
    accounts(
        first: $first, 
        where: { id_gt: $lastId } 
        orderBy: id, 
        orderDirection: asc
    ) {
      id
    }
  }`;

  let lastId = "";
  const allUsers: string[] = [];

  type GraphReturnType<T> = { data: { data?: T; errors?: object } };
  type GraphParams = { query: string; variables: object };

  while (true) {
    const result = await axios
      .post<
        GraphParams,
        GraphReturnType<{ accounts: Omit<User, "isBorrower">[] }>
      >(graphUrl, {
        query: query,
        variables: { lastId, first: batchSize },
      })
      .then((r) => {
        if (r.data.errors) throw Error(JSON.stringify(r.data.errors));
        if (!r.data.data) throw Error("Unknown graph error");
        return r.data.data;
      });
    const users = result.accounts.map((u) => u.id);
    allUsers.push(...users);

    if (result.accounts.length === 0) {
      break;
    }

    lastId = result.accounts[result.accounts.length - 1].id;
  }
  return allUsers;
}
