import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import hre from "hardhat";

import { AAVE_ORACLE_USD_DECIMALS } from "../../config/constants";
import WadRayMath from "../maths/WadRayMath";
import { fetchTokenInfo, TokenInfo } from "../token/info";
import { getAaveProtocolDataProviderAddressFromParent } from "./data_provider";
import { getOraclePrice } from "./oracle";
import { getPoolContractAddress } from "./pool";

export interface UserReserveInfo {
  userAddress: string;
  reserveAddress: string;
  totalSupply: BigNumber;
  totalDebt: BigNumber;
  priceInUSD: BigNumberish;
  priceDecimals: number;
  reserveTokenInfo: TokenInfo;
  liquidationBonus: BigNumber;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
}

/**
 * Get the user reserve information
 *
 * @param userAddress - Address of the user
 * @param reserveAddress - Address of the reserve
 * @returns The user reserve information
 */
export async function getUserReserveInfo(
  userAddress: string,
  reserveAddress: string,
): Promise<UserReserveInfo> {
  const { liquidatorBotDeployer } = await hre.getNamedAccounts();
  const [
    totalSupply,
    totalDebt,
    priceInUSD,
    reserveTokenInfo,
    { liquidationBonus, usageAsCollateralEnabled, borrowingEnabled },
  ] = await Promise.all([
    getUserSupplyBalance(reserveAddress, userAddress),
    getUserDebtBalance(reserveAddress, userAddress),
    getOraclePrice(liquidatorBotDeployer, reserveAddress),
    fetchTokenInfo(hre, reserveAddress),
    getReserveConfigurationData(reserveAddress),
  ]);

  return {
    userAddress,
    reserveAddress,
    totalSupply,
    totalDebt,
    priceInUSD,
    priceDecimals: AAVE_ORACLE_USD_DECIMALS,
    reserveTokenInfo,
    liquidationBonus: BigNumber.from(liquidationBonus),
    usageAsCollateralEnabled,
    borrowingEnabled,
  };
}

/**
 * Get the reserve tokens addresses from the address
 *
 * @param underlyingTokenAddress - The address of the underlying token
 * @returns The reserve token addresses
 */
export async function getReserveTokensAddressesFromAddress(
  underlyingTokenAddress: string,
): Promise<{
  aTokenAddress: string;
  variableDebtTokenAddress: string;
  stableDebtTokenAddress: string;
}> {
  const dataProviderAddress =
    await getAaveProtocolDataProviderAddressFromParent(hre);
  const dataProviderContract = await hre.ethers.getContractAt(
    [
      "function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address variableDebtTokenAddress, address stableDebtTokenAddress)",
    ],
    dataProviderAddress,
  );

  const borrowTokenInfo = await fetchTokenInfo(hre, underlyingTokenAddress);

  const { aTokenAddress, variableDebtTokenAddress, stableDebtTokenAddress } =
    await dataProviderContract.getReserveTokensAddresses(
      borrowTokenInfo.address,
    );

  return {
    aTokenAddress,
    variableDebtTokenAddress,
    stableDebtTokenAddress,
  };
}

/**
 * Get the reserve configuration data
 *
 * @param tokenAddress - The token address
 * @returns - The reserve configuration data
 */
export async function getReserveConfigurationData(
  tokenAddress: string,
): Promise<{
  decimals: bigint;
  ltv: bigint;
  liquidationThreshold: bigint;
  liquidationBonus: bigint; // 10500 means 105%
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  stableBorrowRateEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
}> {
  const dataProviderAddress =
    await getAaveProtocolDataProviderAddressFromParent(hre);
  const dataProviderContract = await hre.ethers.getContractAt(
    [
      "function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
    ],
    dataProviderAddress,
  );

  const {
    decimals,
    ltv,
    liquidationThreshold,
    liquidationBonus,
    reserveFactor,
    usageAsCollateralEnabled,
    borrowingEnabled,
    stableBorrowRateEnabled,
    isActive,
    isFrozen,
  } = await dataProviderContract.getReserveConfigurationData(tokenAddress);

  return {
    decimals,
    ltv,
    liquidationThreshold,
    liquidationBonus,
    reserveFactor,
    usageAsCollateralEnabled,
    borrowingEnabled,
    stableBorrowRateEnabled,
    isActive,
    isFrozen,
  };
}

/**
 * Get the user supply balance of the asset
 * - Reference: https://github.com/stablyio/trinity-solidity-contracts/blob/a6672fbeea4cb7242d242dc19054819c103a0b8b/contracts/lending/core/protocol/libraries/logic/GenericLogic.sol#L282-L299
 *
 * @param assetAddress - The address of the asset
 * @param userAddress - The address of the user
 * @returns - The user supply balance of the asset
 */
export async function getUserSupplyBalance(
  assetAddress: string,
  userAddress: string,
): Promise<BigNumber> {
  const { aTokenAddress } =
    await getReserveTokensAddressesFromAddress(assetAddress);
  const poolAddress = await getPoolContractAddress();

  const aTokenContract = await hre.ethers.getContractAt(
    "AToken",
    aTokenAddress,
    await hre.ethers.getSigner(userAddress),
  );
  const poolContract = await hre.ethers.getContractAt(
    "Pool",
    poolAddress,
    await hre.ethers.getSigner(userAddress),
  );

  const [normalizedIncome, scaleBalance] = await Promise.all([
    poolContract.getReserveNormalizedIncome(assetAddress),
    aTokenContract.scaledBalanceOf(userAddress),
  ]);

  return WadRayMath.rayMul(scaleBalance, normalizedIncome);
}

/**
 * Get the user debt balance of the asset
 * - Reference: https://github.com/stablyio/trinity-solidity-contracts/blob/a6672fbeea4cb7242d242dc19054819c103a0b8b/contracts/lending/core/protocol/libraries/logic/GenericLogic.sol#L247-L270
 *
 * @param assetAddress - The address of the asset
 * @param userAddress - The address of the user
 * @returns - The user debt balance of the asset
 */
export async function getUserDebtBalance(
  assetAddress: string,
  userAddress: string,
): Promise<BigNumber> {
  const { stableDebtTokenAddress, variableDebtTokenAddress } =
    await getReserveTokensAddressesFromAddress(assetAddress);
  const poolAddress = await getPoolContractAddress();

  const poolContract = await hre.ethers.getContractAt(
    "Pool",
    poolAddress,
    await hre.ethers.getSigner(userAddress),
  );

  const variableDebtTokenContract = await hre.ethers.getContractAt(
    "VariableDebtToken",
    variableDebtTokenAddress,
    await hre.ethers.getSigner(userAddress),
  );

  const userVariableDebt = await (async (): Promise<bigint> => {
    const scaledDebtBalance =
      await variableDebtTokenContract.scaledBalanceOf(userAddress);

    if (!BigNumber.from(scaledDebtBalance).isZero()) {
      const normalizeDebt =
        await poolContract.getReserveNormalizedVariableDebt(assetAddress);
      return WadRayMath.rayMul(scaledDebtBalance, normalizeDebt).toBigInt();
    }
    return scaledDebtBalance;
  })();

  const stableDebtTokenContract = await hre.ethers.getContractAt(
    "StableDebtToken",
    stableDebtTokenAddress,
    await hre.ethers.getSigner(userAddress),
  );

  const stableDebtBalance =
    await stableDebtTokenContract.balanceOf(userAddress);
  return BigNumber.from(userVariableDebt).add(stableDebtBalance);
}

/**
 * Get the list of registered reserve tokens on the Lending pool
 *
 * @param poolAddress - The address of the Lending pool
 * @returns - The list of registered reserve tokens on the Lending pool
 */
export async function getReservesList(poolAddress: string): Promise<string[]> {
  const poolContract = await hre.ethers.getContractAt(
    ["function getReservesList() external view returns (address[] memory)"],
    poolAddress,
  );

  return await poolContract.getReservesList();
}
