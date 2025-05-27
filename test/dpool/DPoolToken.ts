import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, ZeroAddress } from "ethers";

import {
  DPUSDCFixture,
  DPoolFixtureResult,
  fundUserWithTokens,
  approveToken,
  depositToPool,
  withdrawFromPool,
  redeemFromPool,
  simulateLPValueIncrease,
  getUserShares,
  getUserBaseAssets,
} from "./fixture";

describe("DPoolToken", () => {
  let fixture: DPoolFixtureResult;

  beforeEach(async () => {
    fixture = await DPUSDCFixture();
  });

  describe("Constructor & Initialization", () => {
    it("should deploy with correct parameters", async () => {
      const { poolToken, baseAssetToken, config } = fixture;

      expect(await poolToken.name()).to.equal(config.poolTokenSymbol);
      expect(await poolToken.symbol()).to.equal(config.poolTokenSymbol);
      expect(await poolToken.asset()).to.equal(baseAssetToken.address);
      expect(await poolToken.baseAsset()).to.equal(baseAssetToken.address);
    });

    it("should set correct roles during initialization", async () => {
      const { poolToken, deployer } = fixture;

      const DEFAULT_ADMIN_ROLE = await poolToken.DEFAULT_ADMIN_ROLE();
      const FEE_MANAGER_ROLE = await poolToken.FEE_MANAGER_ROLE();

      expect(await poolToken.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await poolToken.hasRole(FEE_MANAGER_ROLE, deployer.address)).to.be.true;
    });

    it("should have correct initial values", async () => {
      const { poolToken } = fixture;

      expect(await poolToken.totalSupply()).to.equal(0);
      expect(await poolToken.totalAssets()).to.equal(0);
      expect(await poolToken.withdrawalFeeBps()).to.equal(0);
      expect(await poolToken.maxWithdrawalFeeBps()).to.equal(10000); // 1% from config
    });

    it("should revert constructor with zero addresses", async () => {
      const { baseAssetToken } = fixture;

      const DPoolTokenFactory = await ethers.getContractFactory("DPoolToken");
      
      // Zero base asset
      await expect(
        DPoolTokenFactory.deploy(
          "Test Pool",
          "TEST",
          ZeroAddress,
          fixture.deployer.address,
          fixture.deployer.address,
          1000
        )
      ).to.be.revertedWithCustomError(DPoolTokenFactory, "ZeroAddress");

      // Zero admin
      await expect(
        DPoolTokenFactory.deploy(
          "Test Pool",
          "TEST",
          baseAssetToken.address,
          ZeroAddress,
          fixture.deployer.address,
          1000
        )
      ).to.be.revertedWithCustomError(DPoolTokenFactory, "ZeroAddress");

      // Zero fee manager
      await expect(
        DPoolTokenFactory.deploy(
          "Test Pool",
          "TEST",
          baseAssetToken.address,
          fixture.deployer.address,
          ZeroAddress,
          1000
        )
      ).to.be.revertedWithCustomError(DPoolTokenFactory, "ZeroAddress");
    });

    it("should revert constructor with invalid max fee", async () => {
      const { baseAssetToken } = fixture;

      const DPoolTokenFactory = await ethers.getContractFactory("DPoolToken");
      
      // Max fee too high (over 1%)
      await expect(
        DPoolTokenFactory.deploy(
          "Test Pool",
          "TEST",
          baseAssetToken.address,
          fixture.deployer.address,
          fixture.deployer.address,
          10001 // Over 1%
        )
      ).to.be.revertedWithCustomError(DPoolTokenFactory, "InvalidFeeBps");
    });
  });

  describe("Asset & Share Accounting", () => {
    beforeEach(async () => {
      // Fund users with base assets
      await fundUserWithTokens(
        fixture.baseAssetToken,
        fixture.user1,
        parseUnits("1000", fixture.baseAssetInfo.decimals),
        fixture.deployer
      );
      await fundUserWithTokens(
        fixture.baseAssetToken,
        fixture.user2,
        parseUnits("500", fixture.baseAssetInfo.decimals),
        fixture.deployer
      );
    });

    it("should return correct asset address", async () => {
      const { poolToken, baseAssetToken } = fixture;
      expect(await poolToken.asset()).to.equal(baseAssetToken.address);
      expect(await poolToken.baseAsset()).to.equal(baseAssetToken.address);
    });

    it("should delegate totalAssets to collateral vault", async () => {
      const { poolToken, collateralVault } = fixture;
      
      expect(await poolToken.totalAssets()).to.equal(0);
      expect(await collateralVault.getTotalAssetValue()).to.equal(0);
    });

    it("should track total supply correctly", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      expect(await poolToken.totalSupply()).to.equal(0);

      // Approve and deposit
      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      expect(await poolToken.totalSupply()).to.be.gt(0);
    });

    it("should preview functions work correctly", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      // Preview before any deposits (first deposit)
      const previewShares = await poolToken.previewDeposit(depositAmount);
      const previewAssets = await poolToken.previewMint(previewShares);
      
      expect(previewAssets).to.equal(depositAmount);

      // Approve and deposit
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      const actualShares = await getUserShares(poolToken, user1);
      expect(actualShares).to.equal(previewShares);
    });
  });

  describe("Deposit Flow", () => {
    beforeEach(async () => {
      // Fund users with base assets
      await fundUserWithTokens(
        fixture.baseAssetToken,
        fixture.user1,
        parseUnits("1000", fixture.baseAssetInfo.decimals),
        fixture.deployer
      );
      await fundUserWithTokens(
        fixture.baseAssetToken,
        fixture.user2,
        parseUnits("500", fixture.baseAssetInfo.decimals),
        fixture.deployer
      );
    });

    it("should handle single user deposit correctly", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      const balanceBefore = await getUserBaseAssets(baseAssetToken, user1);
      
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      const balanceAfter = await getUserBaseAssets(baseAssetToken, user1);
      const shares = await getUserShares(poolToken, user1);

      expect(BigInt(balanceBefore.toString()) - BigInt(balanceAfter.toString())).to.equal(depositAmount);
      expect(shares).to.be.gt(0);
      expect(await poolToken.totalSupply()).to.equal(shares);
    });

    it("should allocate shares proportionally for multiple users", async () => {
      const { poolToken, baseAssetToken, user1, user2 } = fixture;
      
      const deposit1 = parseUnits("100", fixture.baseAssetInfo.decimals);
      const deposit2 = parseUnits("200", fixture.baseAssetInfo.decimals);

      // First user deposits
      await approveToken(baseAssetToken, user1, poolToken.address, deposit1);
      await depositToPool(poolToken, user1, deposit1);
      const shares1 = await getUserShares(poolToken, user1);

      // Second user deposits double amount
      await approveToken(baseAssetToken, user2, poolToken.address, deposit2);
      await depositToPool(poolToken, user2, deposit2);
      const shares2 = await getUserShares(poolToken, user2);

      // User2 should have approximately 2x shares of user1
      expect(shares2).to.be.closeTo(BigInt(shares1.toString()) * 2n, BigInt(shares1.toString()) / 100n); // Within 1% tolerance
    });

    it("should handle large deposits correctly", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const largeAmount = parseUnits("10000", fixture.baseAssetInfo.decimals);
      
      // Fund user with large amount
      await fundUserWithTokens(fixture.baseAssetToken, user1, largeAmount, fixture.deployer);
      
      await approveToken(baseAssetToken, user1, poolToken.address, largeAmount);
      await depositToPool(poolToken, user1, largeAmount);

      const shares = await getUserShares(poolToken, user1);
      expect(shares).to.be.gt(0);
      expect(await poolToken.totalAssets()).to.be.gt(0);
    });

    it("should handle small deposits with precision", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      // Small amount (1 unit in base asset decimals)
      const smallAmount = parseUnits("1", fixture.baseAssetInfo.decimals);
      
      await approveToken(baseAssetToken, user1, poolToken.address, smallAmount);
      await depositToPool(poolToken, user1, smallAmount);

      const shares = await getUserShares(poolToken, user1);
      expect(shares).to.be.gt(0);
    });

    it("should calculate correct exchange rate after value appreciation", async () => {
      const { poolToken, baseAssetToken, user1, user2, curvePool, otherAssetToken } = fixture;
      
      const initialDeposit = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      // User1 deposits first
      await approveToken(baseAssetToken, user1, poolToken.address, initialDeposit);
      await depositToPool(poolToken, user1, initialDeposit);
      const initialShares = await getUserShares(poolToken, user1);

      // Simulate LP value increase by adding liquidity to Curve pool
      await simulateLPValueIncrease(
        curvePool,
        fixture.baseAssetToken,
        otherAssetToken,
        fixture.deployer,
        parseUnits("1000", fixture.baseAssetInfo.decimals),
        parseUnits("1000", fixture.otherAssetInfo.decimals)
      );

      // User2 deposits same amount after appreciation
      await approveToken(baseAssetToken, user2, poolToken.address, initialDeposit);
      await depositToPool(poolToken, user2, initialDeposit);
      const user2Shares = await getUserShares(poolToken, user2);

      // User2 should get fewer shares due to increased value
      expect(user2Shares).to.be.lt(initialShares);
    });

    it("should revert deposit when router/vault not set", async () => {
      const { baseAssetToken, deployer } = fixture;

      // Deploy a new DPoolToken without setting router/vault
      const DPoolTokenFactory = await ethers.getContractFactory("DPoolToken");
      const newPoolToken = await DPoolTokenFactory.deploy(
        "Test Pool",
        "TEST",
        baseAssetToken.address,
        deployer.address,
        deployer.address,
        1000
      );

      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      await approveToken(baseAssetToken, fixture.user1, await newPoolToken.getAddress(), depositAmount);

      await expect(
        newPoolToken.connect(fixture.user1).deposit(depositAmount, fixture.user1.address)
      ).to.be.revertedWithCustomError(newPoolToken, "RouterOrVaultNotSet");
    });
  });

  describe("Withdrawal Flow", () => {
    beforeEach(async () => {
      // Fund and deposit for users
      const user1Amount = parseUnits("1000", fixture.baseAssetInfo.decimals);
      const user2Amount = parseUnits("500", fixture.baseAssetInfo.decimals);

      await fundUserWithTokens(fixture.baseAssetToken, fixture.user1, user1Amount, fixture.deployer);
      await fundUserWithTokens(fixture.baseAssetToken, fixture.user2, user2Amount, fixture.deployer);

      // Both users deposit
      await approveToken(fixture.baseAssetToken, fixture.user1, fixture.poolToken.address, user1Amount);
      await approveToken(fixture.baseAssetToken, fixture.user2, fixture.poolToken.address, user2Amount);
      
      await depositToPool(fixture.poolToken, fixture.user1, parseUnits("500", fixture.baseAssetInfo.decimals));
      await depositToPool(fixture.poolToken, fixture.user2, parseUnits("200", fixture.baseAssetInfo.decimals));
    });

    it("should handle basic withdrawal correctly", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const withdrawAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      const balanceBefore = await getUserBaseAssets(baseAssetToken, user1);
      const sharesBefore = await getUserShares(poolToken, user1);

      await withdrawFromPool(poolToken, user1, withdrawAmount);

      const balanceAfter = await getUserBaseAssets(baseAssetToken, user1);
      const sharesAfter = await getUserShares(poolToken, user1);

      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
      expect(sharesBefore - sharesAfter).to.be.gt(0);
    });

    it("should handle redeem correctly", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const userShares = await getUserShares(poolToken, user1);
      const redeemShares = userShares / 2n; // Redeem half

      const balanceBefore = await getUserBaseAssets(baseAssetToken, user1);
      
      await redeemFromPool(poolToken, user1, redeemShares);

      const balanceAfter = await getUserBaseAssets(baseAssetToken, user1);
      const remainingShares = await getUserShares(poolToken, user1);

      expect(balanceAfter).to.be.gt(balanceBefore);
      expect(remainingShares).to.be.closeTo(userShares - redeemShares, 1n);
    });

    it("should apply withdrawal fees correctly", async () => {
      const { poolToken, user1, deployer } = fixture;
      
      // Set withdrawal fee to 1% (100 BPS)
      await poolToken.connect(deployer).setWithdrawalFeeBps(100);

      const withdrawAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      const balanceBefore = await getUserBaseAssets(fixture.baseAssetToken, user1);

      await expect(withdrawFromPool(poolToken, user1, withdrawAmount))
        .to.emit(poolToken, "WithdrawalFee");

      const balanceAfter = await getUserBaseAssets(fixture.baseAssetToken, user1);
      const actualReceived = balanceAfter - balanceBefore;

      // Should receive 99% of requested amount (1% fee)
      const expectedReceived = withdrawAmount * 99n / 100n;
      expect(actualReceived).to.equal(expectedReceived);
    });

    it("should handle zero fee withdrawals", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      // Fee should be 0 by default
      expect(await poolToken.withdrawalFeeBps()).to.equal(0);

      const withdrawAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      const balanceBefore = await getUserBaseAssets(baseAssetToken, user1);

      await withdrawFromPool(poolToken, user1, withdrawAmount);

      const balanceAfter = await getUserBaseAssets(baseAssetToken, user1);
      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("should handle multiple withdrawals by same user", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const withdrawAmount1 = parseUnits("50", fixture.baseAssetInfo.decimals);
      const withdrawAmount2 = parseUnits("75", fixture.baseAssetInfo.decimals);

      const initialBalance = await getUserBaseAssets(baseAssetToken, user1);

      await withdrawFromPool(poolToken, user1, withdrawAmount1);
      const balanceAfter1 = await getUserBaseAssets(baseAssetToken, user1);

      await withdrawFromPool(poolToken, user1, withdrawAmount2);
      const balanceAfter2 = await getUserBaseAssets(baseAssetToken, user1);

      expect(balanceAfter1 - initialBalance).to.equal(withdrawAmount1);
      expect(balanceAfter2 - balanceAfter1).to.equal(withdrawAmount2);
    });

    it("should update preview functions with fees", async () => {
      const { poolToken, deployer } = fixture;
      
      // Set withdrawal fee to 2% (200 BPS)
      await poolToken.connect(deployer).setWithdrawalFeeBps(200);

      const withdrawAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      // Preview should account for fee
      const previewShares = await poolToken.previewWithdraw(withdrawAmount);
      const previewAssets = await poolToken.previewRedeem(previewShares);

      // previewRedeem should return amount after fee (98% of original)
      const expectedAfterFee = withdrawAmount * 98n / 100n;
      expect(previewAssets).to.be.closeTo(expectedAfterFee, expectedAfterFee / 100n);
    });
  });

  describe("Access Control & Administration", () => {
    it("should allow admin to set router", async () => {
      const { poolToken, router, deployer } = fixture;
      
      await expect(poolToken.connect(deployer).setRouter(router.address))
        .to.emit(poolToken, "RouterSet");

      expect(await poolToken.router()).to.equal(router.address);
    });

    it("should allow admin to set collateral vault", async () => {
      const { poolToken, collateralVault, deployer } = fixture;
      
      await expect(poolToken.connect(deployer).setCollateralVault(collateralVault.address))
        .to.emit(poolToken, "CollateralVaultSet");

      expect(await poolToken.collateralVault()).to.equal(collateralVault.address);
    });

    it("should allow fee manager to set withdrawal fee", async () => {
      const { poolToken, deployer } = fixture;
      
      const newFee = 500; // 5%
      await expect(poolToken.connect(deployer).setWithdrawalFeeBps(newFee))
        .to.emit(poolToken, "WithdrawalFeeSet")
        .withArgs(0, newFee);

      expect(await poolToken.withdrawalFeeBps()).to.equal(newFee);
    });

    it("should prevent non-admin from setting router", async () => {
      const { poolToken, router, user1 } = fixture;
      
      await expect(
        poolToken.connect(user1).setRouter(router.address)
      ).to.be.revertedWithCustomError(poolToken, "AccessControlUnauthorizedAccount");
    });

    it("should prevent non-admin from setting collateral vault", async () => {
      const { poolToken, collateralVault, user1 } = fixture;
      
      await expect(
        poolToken.connect(user1).setCollateralVault(collateralVault.address)
      ).to.be.revertedWithCustomError(poolToken, "AccessControlUnauthorizedAccount");
    });

    it("should prevent non-fee-manager from setting withdrawal fee", async () => {
      const { poolToken, user1 } = fixture;
      
      await expect(
        poolToken.connect(user1).setWithdrawalFeeBps(100)
      ).to.be.revertedWithCustomError(poolToken, "AccessControlUnauthorizedAccount");
    });

    it("should prevent setting zero addresses", async () => {
      const { poolToken, deployer } = fixture;
      
      await expect(
        poolToken.connect(deployer).setRouter(ZeroAddress)
      ).to.be.revertedWithCustomError(poolToken, "ZeroAddress");

      await expect(
        poolToken.connect(deployer).setCollateralVault(ZeroAddress)
      ).to.be.revertedWithCustomError(poolToken, "ZeroAddress");
    });

    it("should prevent setting fee above maximum", async () => {
      const { poolToken, deployer } = fixture;
      
      const maxFee = await poolToken.maxWithdrawalFeeBps();
      
      await expect(
        poolToken.connect(deployer).setWithdrawalFeeBps(maxFee + 1n)
      ).to.be.revertedWithCustomError(poolToken, "InvalidFeeBps");
    });

    it("should allow role transfers", async () => {
      const { poolToken, deployer, user1 } = fixture;
      
      const DEFAULT_ADMIN_ROLE = await poolToken.DEFAULT_ADMIN_ROLE();
      const FEE_MANAGER_ROLE = await poolToken.FEE_MANAGER_ROLE();

      // Grant fee manager role to user1
      await poolToken.connect(deployer).grantRole(FEE_MANAGER_ROLE, user1.address);
      
      // User1 should now be able to set fees
      await poolToken.connect(user1).setWithdrawalFeeBps(100);
      expect(await poolToken.withdrawalFeeBps()).to.equal(100);

      // Revoke role
      await poolToken.connect(deployer).revokeRole(FEE_MANAGER_ROLE, user1.address);
      
      // User1 should no longer be able to set fees
      await expect(
        poolToken.connect(user1).setWithdrawalFeeBps(200)
      ).to.be.revertedWithCustomError(poolToken, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Edge Cases & Boundary Conditions", () => {
    it("should handle empty vault state correctly", async () => {
      const { poolToken } = fixture;
      
      expect(await poolToken.totalAssets()).to.equal(0);
      expect(await poolToken.totalSupply()).to.equal(0);
    });

    it("should handle first deposit setting exchange rate", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      await fundUserWithTokens(fixture.baseAssetToken, user1, depositAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      const shares = await getUserShares(poolToken, user1);
      
      // First deposit should get shares approximately equal to assets (1:1 ratio)
      expect(shares).to.be.closeTo(depositAmount, depositAmount / 100n);
    });

    it("should handle precision for very small amounts", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      // Use smallest possible unit
      const tinyAmount = 1n;
      
      await fundUserWithTokens(fixture.baseAssetToken, user1, tinyAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, tinyAmount);
      await depositToPool(poolToken, user1, tinyAmount);

      const shares = await getUserShares(poolToken, user1);
      expect(shares).to.be.gt(0);
    });

    it("should handle complete vault withdrawal", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;
      
      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      // Setup: fund, approve, and deposit
      await fundUserWithTokens(fixture.baseAssetToken, user1, depositAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      // Withdraw everything
      const allShares = await getUserShares(poolToken, user1);
      await redeemFromPool(poolToken, user1, allShares);

      // Check final state
      expect(await getUserShares(poolToken, user1)).to.equal(0);
      expect(await poolToken.totalSupply()).to.equal(0);
    });
  });
}); 