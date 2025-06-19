import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BigNumberish } from "ethers";
import { deployments, ethers } from "hardhat";

import { DLoopCoreDLend, ERC20 } from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { DLOOP_CORE_DLEND_ID } from "../../../typescript/deploy-ids";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../../typescript/token/utils";

export interface DLoopCoreDLendFixture {
  dloopCoreDLend: DLoopCoreDLend;
  collateralToken: ERC20;
  debtToken: ERC20;
  collateralTokenInfo: TokenInfo;
  debtTokenInfo: TokenInfo;
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;
  user3: HardhatEthersSigner;
  targetLeverageBps: number;
  lowerBoundBps: number;
  upperBoundBps: number;
}

// Constants from the config - matching the 3x_sFRAX_dUSD vault
export const TARGET_LEVERAGE_BPS = 300 * ONE_PERCENT_BPS; // 300% leverage = 3x
export const LOWER_BOUND_BPS = 200 * ONE_PERCENT_BPS; // 200% = 2x
export const UPPER_BOUND_BPS = 400 * ONE_PERCENT_BPS; // 400% = 4x

/**
 * Deploy the DLoopCoreDLend using existing deployments
 * This uses the "3x_sFRAX_dUSD" vault from the config
 */
export async function prepareDLoopCoreDLendFixture(): Promise<DLoopCoreDLendFixture> {
  const accounts = await ethers.getSigners();
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];

  // Deploy all necessary contracts using the deployment tags
  const deploymentTags = [
    "local-setup", // Mock tokens and oracles
    "oracle", // Oracle setup
    "dusd", // dUSD token and ecosystem
    "dUSD-aTokenWrapper",
    "dS-aTokenWrapper",
    "dlend", // dLend core and periphery
    "dloop", // dLoop core contracts
  ];

  await deployments.fixture(deploymentTags);

  // Get the deployed DLoopCoreDLend contract - using the vault symbol from config
  const vaultSymbol = "FRAX-dUSD-3x"; // From localhost.ts config
  const deploymentName = `${DLOOP_CORE_DLEND_ID}-${vaultSymbol}`;

  const dLoopDeployment = await deployments.get(deploymentName);
  const dloopCoreDLend = await ethers.getContractAt(
    "DLoopCoreDLend",
    dLoopDeployment.address,
  );

  // Get collateral token (sfrxUSD) and debt token (dUSD) from the deployed contract
  const collateralTokenAddress =
    await dloopCoreDLend.getCollateralTokenAddress();
  const debtTokenAddress = await dloopCoreDLend.getDebtTokenAddress();

  // Get token contracts and info
  const { contract: collateralToken, tokenInfo: collateralTokenInfo } =
    await getTokenContractForSymbol(
      { deployments, ethers } as any,
      deployer.address,
      "sfrxUSD",
    );

  const { contract: debtToken, tokenInfo: debtTokenInfo } =
    await getTokenContractForSymbol(
      { deployments, ethers } as any,
      deployer.address,
      "dUSD",
    );

  // Verify the addresses match
  if (collateralTokenAddress !== (await collateralToken.getAddress())) {
    throw new Error("Collateral token address mismatch");
  }

  if (debtTokenAddress !== (await debtToken.getAddress())) {
    throw new Error("Debt token address mismatch");
  }

  return {
    dloopCoreDLend: dloopCoreDLend as unknown as DLoopCoreDLend,
    collateralToken: collateralToken as unknown as ERC20,
    debtToken: debtToken as unknown as ERC20,
    collateralTokenInfo,
    debtTokenInfo,
    accounts,
    deployer,
    user1,
    user2,
    user3,
    targetLeverageBps: TARGET_LEVERAGE_BPS,
    lowerBoundBps: LOWER_BOUND_BPS,
    upperBoundBps: UPPER_BOUND_BPS,
  };
}

/**
 * Setup function to prepare the test environment
 * This mints tokens to users and seeds the dLend pool with initial liquidity
 *
 * @param fixture - The fixture to use
 * @param initialTokenAmount - The amount of tokens to mint to each user
 */
export async function testSetup(
  fixture: DLoopCoreDLendFixture,
  initialTokenAmount: BigNumberish = ethers.parseEther("10000"),
): Promise<void> {
  const { collateralToken, debtToken, accounts } = fixture;

  // Mint tokens to all test users (assuming they are mintable test tokens)
  for (let i = 0; i < 5; i++) {
    const user = accounts[i];

    try {
      // Try to mint collateral tokens
      if (typeof (collateralToken as any).mint === "function") {
        await (collateralToken as any).mint(user.address, initialTokenAmount);
      }

      // Try to mint debt tokens
      if (typeof (debtToken as any).mint === "function") {
        await (debtToken as any).mint(user.address, initialTokenAmount);
      }
      // eslint-disable-next-line unused-imports/no-unused-vars -- error is not used
    } catch (error) {
      // If minting fails, try to get tokens from the deployer
      const deployerBalance = await collateralToken.balanceOf(
        accounts[0].address,
      );

      if (deployerBalance >= BigInt(initialTokenAmount.toString())) {
        await collateralToken
          .connect(accounts[0])
          .transfer(user.address, initialTokenAmount);
      }

      const deployerDebtBalance = await debtToken.balanceOf(
        accounts[0].address,
      );

      if (deployerDebtBalance >= BigInt(initialTokenAmount.toString())) {
        await debtToken
          .connect(accounts[0])
          .transfer(user.address, initialTokenAmount);
      }
    }
  }

  // Seed the dLend pool with initial liquidity to prevent arithmetic overflow
  // This is crucial for the interest rate calculations to work properly
  const liquidityProvider = accounts[0]; // Use deployer as liquidity provider
  const seedLiquidity = ethers.parseEther("100000"); // 100k tokens

  console.log("Attempting to seed dLend pool with initial liquidity...");

  try {
    // Get the pool contract address
    const poolAddress = await fixture.dloopCoreDLend.getLendingPool();
    console.log("Pool address:", poolAddress);

    // Use the Pool contract directly which has the supply method
    const pool = await ethers.getContractAt("Pool", poolAddress);

    // Supply debt tokens (dUSD) to the pool so users can borrow against collateral
    const debtTokenBalance = await debtToken.balanceOf(
      liquidityProvider.address,
    );
    console.log("Debt token balance:", ethers.formatEther(debtTokenBalance));

    if (debtTokenBalance >= seedLiquidity) {
      console.log("Supplying debt tokens to pool...");
      await debtToken
        .connect(liquidityProvider)
        .approve(poolAddress, seedLiquidity);
      await pool.connect(liquidityProvider).supply(
        await debtToken.getAddress(),
        seedLiquidity,
        liquidityProvider.address,
        0, // No referral code
      );
      console.log("Successfully supplied debt tokens to pool");
    } else {
      console.log("Insufficient debt token balance for seeding");
    }

    // Also supply collateral tokens to the pool for better liquidity
    const collateralBalance = await collateralToken.balanceOf(
      liquidityProvider.address,
    );
    console.log(
      "Collateral token balance:",
      ethers.formatEther(collateralBalance),
    );

    if (collateralBalance >= seedLiquidity) {
      console.log("Supplying collateral tokens to pool...");
      await collateralToken
        .connect(liquidityProvider)
        .approve(poolAddress, seedLiquidity);
      await pool.connect(liquidityProvider).supply(
        await collateralToken.getAddress(),
        seedLiquidity,
        liquidityProvider.address,
        0, // No referral code
      );
      console.log("Successfully supplied collateral tokens to pool");
    } else {
      console.log("Insufficient collateral token balance for seeding");
    }
  } catch (error) {
    console.warn("Warning: Could not seed dLend pool with liquidity:", error);
  }
}
