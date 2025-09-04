import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { Pool, TestERC20 } from "../../typechain-types";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { dLendFixture, DLendFixtureResult } from "./fixtures";

describe("dLEND Pool", () => {
  // Test fixture and common variables
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;
  let user2Signer: SignerWithAddress;
  let pool: Pool;
  let dStableAsset: string;
  let collateralAsset: string;
  let fixture: DLendFixtureResult;

  beforeEach(async () => {
    // Get named accounts
    const { deployer, user1, user2 } = await hre.getNamedAccounts();
    // Get signers for named accounts
    deployerSigner = await hre.ethers.getSigner(deployer);
    user1Signer = await hre.ethers.getSigner(user1);
    user2Signer = await hre.ethers.getSigner(user2);

    // Load the fixture
    fixture = await dLendFixture();
    pool = fixture.contracts.pool;

    // Get the ACL Manager
    const addressesProvider = await hre.ethers.getContractAt(
      "PoolAddressesProvider",
      (await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID)).address,
    );
    const aclManager = await hre.ethers.getContractAt(
      "ACLManager",
      await addressesProvider.getACLManager(),
    );

    // Grant POOL_ADMIN_ROLE to deployer
    await aclManager.addPoolAdmin(deployerSigner.address);

    // Get reserves
    const reservesList = await pool.getReservesList();

    // Get contract instances and configuration for each reserve
    for (const asset of reservesList) {
      const reserveData = await pool.getReserveData(asset);
      const config =
        await fixture.contracts.dataProvider.getReserveConfigurationData(asset);

      // Get token contracts
      const tokenContract = await hre.ethers.getContractAt("TestERC20", asset);
      const symbol = await tokenContract.symbol();

      // Store asset configuration
      fixture.assets[asset] = {
        address: asset,
        aToken: reserveData.aTokenAddress,
        stableDebtToken: reserveData.stableDebtTokenAddress,
        variableDebtToken: reserveData.variableDebtTokenAddress,
        borrowingEnabled: config.borrowingEnabled,
        ltv: config.ltv,
        liquidationThreshold: config.liquidationThreshold,
        symbol,
      };
    }

    // Find a dStable asset and a collateral asset
    dStableAsset = fixture.dStables.dUSD; // Default to dUSD as the dStable to test with

    // Look for a non-dStable collateral asset (specifically sfrxUSD or stS)
    for (const [asset, config] of Object.entries(fixture.assets)) {
      // Skip dStables and look for assets that can be used as collateral (LTV > 0)
      if (config.ltv !== BigInt(0)) {
        collateralAsset = asset;
        break;
      }
    }

    if (!dStableAsset || !collateralAsset) {
      throw new Error(
        "Could not find required test assets - need one dStable and one collateral asset",
      );
    }

    // Supply the dStable asset to the pool to ensure there's enough liquidity for borrowing
    // This is needed because the borrowing tests fail due to arithmetic overflow when there's not enough liquidity
    const dStableToken = await hre.ethers.getContractAt(
      "TestERC20",
      dStableAsset,
    );
    const dStableSupplyAmount = ethers.parseUnits("1000", 18); // Supply a reasonable amount

    // Approve and supply the dStable to the pool
    await dStableToken.approve(await pool.getAddress(), dStableSupplyAmount);
    await pool.supply(
      dStableAsset,
      dStableSupplyAmount,
      deployerSigner.address,
      0,
    );

    // Log reserve configuration for both assets
    const dStableConfig =
      await fixture.contracts.dataProvider.getReserveConfigurationData(
        dStableAsset,
      );
    const collateralConfig =
      await fixture.contracts.dataProvider.getReserveConfigurationData(
        collateralAsset,
      );
  });

  describe("Supply", () => {
    beforeEach(async () => {
      // Check reserve configuration
      const config =
        await fixture.contracts.dataProvider.getReserveConfigurationData(
          collateralAsset,
        );

      // For collateral assets, LTV should be > 0
      expect(config.ltv).to.not.equal(
        BigInt(0),
        "Collateral LTV should be greater than 0",
      );
      expect(config.isActive).to.be.true;
      expect(config.isFrozen).to.be.false;

      // For dStables, LTV should be 0 to prevent subsidy syphoning
      const dStableConfig =
        await fixture.contracts.dataProvider.getReserveConfigurationData(
          dStableAsset,
        );
      expect(dStableConfig.ltv).to.equal(
        BigInt(0),
        "dStable LTV should be 0 to prevent subsidy syphoning",
      );
      expect(dStableConfig.borrowingEnabled).to.be.true,
        "dStable should be borrowable";
    });

    it("should allow users to supply assets", async () => {
      const amount = ethers.parseUnits("100", 18); // Assuming 18 decimals
      const asset = await ethers.getContractAt("TestERC20", collateralAsset);
      const aToken = fixture.contracts.aTokens[collateralAsset];

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateralToken.transfer(user1Signer.address, amount);

      // Approve spending
      await asset
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), amount);

      // Supply asset
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(collateralAsset, amount, await user1Signer.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Check aToken balance
      const aTokenBalance = await aToken.balanceOf(
        await user1Signer.getAddress(),
      );
      expect(aTokenBalance).to.equal(amount);

      // Check user configuration
      const userConfig = await fixture.contracts.pool.getUserConfiguration(
        await user1Signer.getAddress(),
      );
      expect(userConfig.data).to.not.equal(0); // User should have some configuration set
    });

    it("should update user account data after supply", async () => {
      const amount = ethers.parseUnits("100", 18);
      const asset = await ethers.getContractAt("TestERC20", collateralAsset);

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateralToken.transfer(user1Signer.address, amount);

      // Supply asset
      await asset
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), amount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(collateralAsset, amount, await user1Signer.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Check user account data
      const { totalCollateralBase, totalDebtBase, availableBorrowsBase } =
        await fixture.contracts.pool.getUserAccountData(
          await user1Signer.getAddress(),
        );

      expect(totalCollateralBase).to.be.gt(0);
      expect(totalDebtBase).to.equal(0);
      expect(availableBorrowsBase).to.be.gt(0);
    });
  });

  describe("Borrow", () => {
    it("should allow users to borrow dStables", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateralToken.transfer(user1Signer.address, collateralAmount);

      // Supply collateral first
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateral
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(
          collateralAsset,
          collateralAmount,
          await user1Signer.getAddress(),
          0,
        );

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Get dStable contracts
      const dStable = await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dStableAsset,
      );
      const variableDebtToken =
        fixture.contracts.variableDebtTokens[dStableAsset];

      // Get initial dStable balance
      const initialDStableBalance = await dStable.balanceOf(
        await user1Signer.getAddress(),
      );

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user1Signer)
        .borrow(
          dStableAsset,
          borrowAmount,
          2,
          0,
          await user1Signer.getAddress(),
        ); // 2 = variable rate

      // Check debt token balance
      const debtBalance = await variableDebtToken.balanceOf(
        await user1Signer.getAddress(),
      );
      expect(debtBalance).to.be.closeTo(
        borrowAmount,
        ethers.parseUnits("0.0001", 18),
      ); // Use closeTo for potential minor interest accrual

      // Check borrowed token balance increase
      const finalDStableBalance = await dStable.balanceOf(
        await user1Signer.getAddress(),
      );
      expect(finalDStableBalance).to.equal(
        initialDStableBalance + borrowAmount,
      );
    });

    it("should update user position after borrowing", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateralToken.transfer(user1Signer.address, collateralAmount);

      // Supply collateral first
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateral
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(
          collateralAsset,
          collateralAmount,
          await user1Signer.getAddress(),
          0,
        );

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Get position before borrowing
      const beforeBorrow = await fixture.contracts.pool.getUserAccountData(
        await user1Signer.getAddress(),
      );

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user1Signer)
        .borrow(
          dStableAsset,
          borrowAmount,
          2,
          0,
          await user1Signer.getAddress(),
        );

      // Get position after borrowing
      const afterBorrow = await fixture.contracts.pool.getUserAccountData(
        await user1Signer.getAddress(),
      );

      expect(afterBorrow.totalDebtBase).to.be.gt(beforeBorrow.totalDebtBase);
      expect(afterBorrow.availableBorrowsBase).to.be.lt(
        beforeBorrow.availableBorrowsBase,
      );
      // Health factor might fluctuate slightly due to interest, check it remains reasonable
      expect(afterBorrow.healthFactor).to.be.lt(beforeBorrow.healthFactor);
      expect(afterBorrow.healthFactor).to.be.gt(ethers.parseUnits("1", 18)); // Ensure health factor is still > 1
    });
  });

  describe("User Position", () => {
    it("should correctly calculate user position values", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateralToken.transfer(user1Signer.address, collateralAmount);

      // Supply collateral
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      await collateral
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(
          collateralAsset,
          collateralAmount,
          await user1Signer.getAddress(),
          0,
        );

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user1Signer)
        .borrow(
          dStableAsset,
          borrowAmount,
          2,
          0,
          await user1Signer.getAddress(),
        );

      // Get user position
      const {
        totalCollateralBase,
        totalDebtBase,
        availableBorrowsBase,
        currentLiquidationThreshold,
        ltv,
        healthFactor,
      } = await fixture.contracts.pool.getUserAccountData(
        await user1Signer.getAddress(),
      );

      // Verify position calculations
      expect(totalCollateralBase).to.be.gt(0);
      expect(totalDebtBase).to.be.gt(0);
      expect(availableBorrowsBase).to.be.gte(0);
      expect(currentLiquidationThreshold).to.be.gt(0);
      expect(ltv).to.be.gt(0);
      expect(healthFactor).to.be.gt(1); // Health factor should be > 1 to avoid liquidation
    });
  });

  describe("Interest Accrual", () => {
    it("should increase dStable liquidityIndex over time when borrowed", async () => {
      // Find two distinct collateral assets
      const collateralAssets = Object.entries(fixture.assets)
        .filter(([_, config]) => !config.isDStable && config.ltv !== BigInt(0))
        .map(([addr, _]) => addr);

      if (collateralAssets.length < 2) {
        throw new Error(
          "Need at least two distinct non-dStable collateral assets for this test setup.",
        );
      }
      const collateralAsset1 = collateralAssets[0]; // User 1 supplies this
      const collateralAsset2 = collateralAssets[1]; // User 2 supplies this

      const user1SupplyAmount = ethers.parseUnits("1000", 18); // User1 supplies collateral
      const user2SupplyAmount = ethers.parseUnits("1000", 18); // User2 supplies different collateral
      const borrowAmount = ethers.parseUnits("100", 18); // User2 borrows dStable

      const collateralToken1 = (await ethers.getContractAt(
        "TestERC20",
        collateralAsset1,
      )) as TestERC20;
      const collateralToken2 = (await ethers.getContractAt(
        "TestERC20",
        collateralAsset2,
      )) as TestERC20;
      const dStableToken = (await ethers.getContractAt(
        "TestERC20",
        dStableAsset,
      )) as TestERC20;

      // --- Setup User 1 (Supplies collateral, but doesn't borrow - not strictly needed but good practice) ---
      await collateralToken1
        .connect(deployerSigner)
        .transfer(user1Signer.address, user1SupplyAmount);
      await collateralToken1
        .connect(user1Signer)
        .approve(await pool.getAddress(), user1SupplyAmount);
      await pool
        .connect(user1Signer)
        .supply(collateralAsset1, user1SupplyAmount, user1Signer.address, 0);
      // No need to enable collateral for user1 in this test flow

      // --- Setup User 2 (Supplies different collateral, borrows dStable) ---
      await collateralToken2
        .connect(deployerSigner)
        .transfer(user2Signer.address, user2SupplyAmount);
      await collateralToken2
        .connect(user2Signer)
        .approve(await pool.getAddress(), user2SupplyAmount);
      await pool
        .connect(user2Signer)
        .supply(collateralAsset2, user2SupplyAmount, user2Signer.address, 0);
      await pool
        .connect(user2Signer)
        .setUserUseReserveAsCollateral(collateralAsset2, true); // Enable the *correct* collateral

      // --- User 2 Borrows dStableAsset ---
      // Note: Deployer supplied dStable liquidity in beforeEach
      await pool
        .connect(user2Signer)
        .borrow(dStableAsset, borrowAmount, 2, 0, user2Signer.address); // 2 = variable rate

      // --- Test Interest Accrual on dStableAsset ---
      // Record initial liquidity index for dStableAsset (AFTER borrow establishes utilization)
      const initialReserveData = await pool.getReserveData(dStableAsset);
      const initialLiquidityIndex = initialReserveData.liquidityIndex;
      expect(initialLiquidityIndex).to.be.gt(0);

      // Advance time significantly
      const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
      await time.increase(ONE_YEAR_IN_SECS);

      // Perform a minimal interaction with the *dStableAsset* reserve to trigger index update
      // Using User 2 to repay 1 wei
      const interactionAmount = BigInt(1);
      await dStableToken
        .connect(deployerSigner)
        .transfer(user2Signer.address, interactionAmount); // Give user2 1 wei dStable
      await dStableToken
        .connect(user2Signer)
        .approve(await pool.getAddress(), interactionAmount); // Approve pool
      await pool
        .connect(user2Signer)
        .repay(dStableAsset, interactionAmount, 2, user2Signer.address); // Repay 1 wei variable debt

      // Record final liquidity index for dStableAsset
      const finalReserveData = await pool.getReserveData(dStableAsset);
      const finalLiquidityIndex = finalReserveData.liquidityIndex;

      // Assert that the liquidity index has increased
      expect(finalLiquidityIndex).to.be.gt(
        initialLiquidityIndex,
        "dStable liquidity index should increase after time passes and interaction when reserve is borrowed",
      );
    });
  });
});
