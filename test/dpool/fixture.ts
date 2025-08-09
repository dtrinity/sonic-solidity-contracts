import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";

import {
  DPoolCurvePeriphery,
  DPoolVaultCurveLP,
  ICurveStableSwapNG,
  IERC20,
} from "../../typechain-types";

export interface DPoolFixtureResult {
  // Contracts
  vault: DPoolVaultCurveLP;
  periphery: DPoolCurvePeriphery;
  curvePool: ICurveStableSwapNG;

  // Tokens
  baseAssetToken: IERC20;
  otherAssetToken: IERC20;

  // Signers
  deployer: SignerWithAddress;
  user1: SignerWithAddress;
  user2: SignerWithAddress;
  admin: SignerWithAddress;

  // Pool info
  baseAssetInfo: {
    address: string;
    symbol: string;
    decimals: number;
  };
  otherAssetInfo: {
    address: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * Create a dPool fixture for USDC/USDS Curve pool
 */
export async function DPoolUSDCFixture(): Promise<DPoolFixtureResult> {
  const [deployer, user1, user2, admin] = await ethers.getSigners();

  // Deploy all contracts first
  await deployments.fixture(); // Start from a fresh deployment
  await deployments.fixture(["dpool"]); // Deploy dPool system

  // Get deployed contracts using the expected deployment names
  const vaultDeployment = await deployments.get("DPoolVault_USDC_USDS_Curve");
  const peripheryDeployment = await deployments.get(
    "DPoolPeriphery_USDC_USDS_Curve",
  );
  const curvePoolDeployment = await deployments.get("USDC_USDS_CurvePool");
  const usdcDeployment = await deployments.get("USDC");
  const usdsDeployment = await deployments.get("USDS");

  // Connect to contracts
  const vault = (await ethers.getContractAt(
    "DPoolVaultCurveLP",
    vaultDeployment.address,
  )) as DPoolVaultCurveLP;
  const periphery = (await ethers.getContractAt(
    "DPoolCurvePeriphery",
    peripheryDeployment.address,
  )) as DPoolCurvePeriphery;
  const curvePool = (await ethers.getContractAt(
    "ICurveStableSwapNG",
    curvePoolDeployment.address,
  )) as ICurveStableSwapNG;
  const baseAssetToken = (await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    usdcDeployment.address,
  )) as unknown as IERC20;
  const otherAssetToken = (await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    usdsDeployment.address,
  )) as unknown as IERC20;

  return {
    vault,
    periphery,
    curvePool,
    baseAssetToken,
    otherAssetToken,
    deployer,
    user1,
    user2,
    admin,
    baseAssetInfo: {
      address: usdcDeployment.address,
      symbol: "USDC",
      decimals: 6,
    },
    otherAssetInfo: {
      address: usdsDeployment.address,
      symbol: "USDS",
      decimals: 18,
    },
  };
}

/**
 * Create a dPool fixture for frxUSD/USDC Curve pool
 */
export async function DPoolfrxUSDFixture(): Promise<DPoolFixtureResult> {
  const [deployer, user1, user2, admin] = await ethers.getSigners();

  // Deploy all contracts first
  await deployments.fixture(); // Start from a fresh deployment
  await deployments.fixture(["dpool"]); // Deploy dPool system

  // Get deployed contracts using the expected deployment names
  const vaultDeployment = await deployments.get("DPoolVault_frxUSD_USDC_Curve");
  const peripheryDeployment = await deployments.get(
    "DPoolPeriphery_frxUSD_USDC_Curve",
  );
  const curvePoolDeployment = await deployments.get("frxUSD_USDC_CurvePool");
  const frxUSDDeployment = await deployments.get("frxUSD");
  const usdcDeployment = await deployments.get("USDC");

  // Connect to contracts
  const vault = (await ethers.getContractAt(
    "DPoolVaultCurveLP",
    vaultDeployment.address,
  )) as DPoolVaultCurveLP;
  const periphery = (await ethers.getContractAt(
    "DPoolCurvePeriphery",
    peripheryDeployment.address,
  )) as DPoolCurvePeriphery;
  const curvePool = (await ethers.getContractAt(
    "ICurveStableSwapNG",
    curvePoolDeployment.address,
  )) as ICurveStableSwapNG;
  const baseAssetToken = (await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    frxUSDDeployment.address,
  )) as unknown as IERC20;
  const otherAssetToken = (await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    usdcDeployment.address,
  )) as unknown as IERC20;

  return {
    vault,
    periphery,
    curvePool,
    baseAssetToken,
    otherAssetToken,
    deployer,
    user1,
    user2,
    admin,
    baseAssetInfo: {
      address: frxUSDDeployment.address,
      symbol: "frxUSD",
      decimals: 18,
    },
    otherAssetInfo: {
      address: usdcDeployment.address,
      symbol: "USDC",
      decimals: 6,
    },
  };
}

// --- Helper functions ---

/**
 * Fund a user with tokens from the deployer
 *
 * @param token
 * @param user
 * @param amount
 * @param funder
 */
export async function fundUserWithTokens(
  token: IERC20,
  user: SignerWithAddress,
  amount: bigint,
  funder: SignerWithAddress,
): Promise<void> {
  await token.connect(funder).transfer(user.address, amount);
}

/**
 * Approve token spending
 *
 * @param token
 * @param user
 * @param spender
 * @param amount
 */
export async function approveToken(
  token: IERC20,
  user: SignerWithAddress,
  spender: string,
  amount: bigint,
): Promise<void> {
  await token.connect(user).approve(spender, amount);
}

/**
 * Deposit LP tokens directly to vault
 *
 * @param vault
 * @param user
 * @param lpAmount
 */
export async function depositLPToVault(
  vault: DPoolVaultCurveLP,
  user: SignerWithAddress,
  lpAmount: bigint,
): Promise<void> {
  await vault.connect(user).deposit(lpAmount, user.address);
}

/**
 * Withdraw LP tokens directly from vault
 *
 * @param vault
 * @param user
 * @param assets
 */
export async function withdrawLPFromVault(
  vault: DPoolVaultCurveLP,
  user: SignerWithAddress,
  assets: bigint,
): Promise<void> {
  await vault.connect(user).withdraw(assets, user.address, user.address);
}

/**
 * Redeem shares from vault
 *
 * @param vault
 * @param user
 * @param shares
 */
export async function redeemFromVault(
  vault: DPoolVaultCurveLP,
  user: SignerWithAddress,
  shares: bigint,
): Promise<void> {
  await vault.connect(user).redeem(shares, user.address, user.address);
}

/**
 * Deposit asset via periphery
 *
 * @param periphery
 * @param user
 * @param asset
 * @param amount
 * @param minShares
 * @param maxSlippage
 */
export async function depositAssetViaPeriphery(
  periphery: DPoolCurvePeriphery,
  user: SignerWithAddress,
  asset: string,
  amount: bigint,
  minShares: bigint = 0n,
  maxSlippage: number = 100, // 1%
): Promise<void> {
  await periphery
    .connect(user)
    .depositAsset(asset, amount, user.address, minShares, maxSlippage);
}

/**
 * Withdraw to asset via periphery
 *
 * @param periphery
 * @param user
 * @param shares
 * @param asset
 * @param minAmount
 * @param maxSlippage
 */
export async function withdrawToAssetViaPeriphery(
  periphery: DPoolCurvePeriphery,
  user: SignerWithAddress,
  shares: bigint,
  asset: string,
  minAmount: bigint = 0n,
  maxSlippage: number = 100, // 1%
): Promise<void> {
  // Get the vault contract to approve shares
  const vaultAddress = await periphery.vault();
  const vault = await ethers.getContractAt("DPoolVaultCurveLP", vaultAddress);

  // Approve periphery to spend user's vault shares
  await vault.connect(user).approve(await periphery.getAddress(), shares);

  // Now call withdrawToAsset
  await periphery
    .connect(user)
    .withdrawToAsset(
      shares,
      asset,
      user.address,
      user.address,
      minAmount,
      maxSlippage,
    );
}

/**
 * Get user's vault share balance
 *
 * @param vault
 * @param user
 */
export async function getUserShares(
  vault: DPoolVaultCurveLP,
  user: SignerWithAddress,
): Promise<bigint> {
  return await vault.balanceOf(user.address);
}

/**
 * Get user's token balance
 *
 * @param token
 * @param user
 */
export async function getUserTokenBalance(
  token: IERC20,
  user: SignerWithAddress,
): Promise<bigint> {
  return await token.balanceOf(user.address);
}

/**
 * Get vault's total assets
 *
 * @param vault
 */
export async function getVaultTotalAssets(
  vault: DPoolVaultCurveLP,
): Promise<bigint> {
  return await vault.totalAssets();
}

/**
 * Get vault's total supply
 *
 * @param vault
 */
export async function getVaultTotalSupply(
  vault: DPoolVaultCurveLP,
): Promise<bigint> {
  return await vault.totalSupply();
}

/**
 * Add liquidity to mock curve pool (for testing LP token acquisition)
 *
 * @param curvePool
 * @param user
 * @param amount0
 * @param amount1
 * @param minLP
 */
export async function addLiquidityToCurvePool(
  curvePool: ICurveStableSwapNG,
  user: SignerWithAddress,
  amount0: bigint,
  amount1: bigint,
  minLP: bigint = 0n,
): Promise<void> {
  await curvePool
    .connect(user)
    ["add_liquidity(uint256[],uint256)"]([amount0, amount1], minLP);
}

/**
 * Get LP token balance from curve pool
 *
 * @param curvePool
 * @param user
 */
export async function getLPTokenBalance(
  curvePool: ICurveStableSwapNG,
  user: SignerWithAddress,
): Promise<bigint> {
  return await curvePool.balanceOf(user.address);
}
