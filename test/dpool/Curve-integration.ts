import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits } from "ethers";

import {
  DPUSDCFixture,
  DPUSDFixture,
  DPoolFixtureResult,
  fundUserWithTokens,
  approveToken,
  depositToPool,
  withdrawFromPool,
  redeemFromPool,
  simulateLPValueIncrease,
  getUserShares,
  getUserBaseAssets,
  getPoolTokenValue,
  getPoolTokenShares,
} from "./fixture";

describe("dPOOL Integration", () => {
  describe("Complete User Journey", () => {
    let fixture: DPoolFixtureResult;

    beforeEach(async () => {
      fixture = await DPUSDCFixture();
    });

    it("should handle full deposit to withdrawal cycle", async () => {
      const { poolToken, baseAssetToken, user1 } = fixture;

      const depositAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);

      // 1. Setup: Fund user
      await fundUserWithTokens(baseAssetToken, user1, depositAmount, fixture.deployer);

      // 2. Deposit
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      // Verify deposit results
      const userShares = await getUserShares(poolToken, user1);
      expect(userShares).to.be.gt(0);
      expect(await getPoolTokenValue(poolToken)).to.be.gt(0);
      expect(await getPoolTokenShares(poolToken)).to.equal(userShares);

      // 3. Wait some time and simulate yield generation
      await simulateLPValueIncrease(
        fixture.curvePool,
        fixture.baseAssetToken,
        fixture.otherAssetToken,
        fixture.deployer,
        parseUnits("500", fixture.baseAssetInfo.decimals),
        parseUnits("500", fixture.otherAssetInfo.decimals)
      );

      // 4. Check increased value
      const valueAfterYield = await getPoolTokenValue(poolToken);
      expect(valueAfterYield).to.be.gt(depositAmount);

      // 5. Withdraw half
      const withdrawAmount = depositAmount / 2n;
      const balanceBeforeWithdraw = await getUserBaseAssets(baseAssetToken, user1);
      
      await withdrawFromPool(poolToken, user1, withdrawAmount);

      // 6. Verify withdrawal
      const balanceAfterWithdraw = await getUserBaseAssets(baseAssetToken, user1);
      const remainingShares = await getUserShares(poolToken, user1);

      expect(BigInt(balanceAfterWithdraw.toString()) - BigInt(balanceBeforeWithdraw.toString())).to.equal(withdrawAmount);
      expect(remainingShares).to.be.lt(userShares);
      expect(remainingShares).to.be.gt(0);

      // 7. Redeem remaining shares
      await redeemFromPool(poolToken, user1, remainingShares);

      // 8. Verify final state
      const finalShares = await getUserShares(poolToken, user1);
      const finalBalance = await getUserBaseAssets(baseAssetToken, user1);

      expect(finalShares).to.equal(0);
      // User should have received more than originally deposited due to yield
      expect(finalBalance).to.be.gt(balanceBeforeWithdraw);
    });

    it("should handle user earning yield from LP appreciation", async () => {
      const { poolToken, baseAssetToken, user1, curvePool, otherAssetToken } = fixture;

      const depositAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);

      // Setup and deposit
      await fundUserWithTokens(baseAssetToken, user1, depositAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      const initialShares = await getUserShares(poolToken, user1);
      const initialValue = await getPoolTokenValue(poolToken);

      // Simulate significant LP value increase
      const yieldAmount = parseUnits("2000", fixture.baseAssetInfo.decimals);
      await simulateLPValueIncrease(
        curvePool,
        baseAssetToken,
        otherAssetToken,
        fixture.deployer,
        yieldAmount,
        yieldAmount
      );

      // Value should increase significantly
      const newValue = await getPoolTokenValue(poolToken);
      expect(newValue).to.be.gt(initialValue);

      // User shares should be worth more now
      const userShareValue = (BigInt(newValue.toString()) * BigInt(initialShares.toString())) / BigInt((await getPoolTokenShares(poolToken)).toString());
      expect(userShareValue).to.be.gt(depositAmount);

      // Withdraw and verify profit
      const balanceBefore = await getUserBaseAssets(baseAssetToken, user1);
      await redeemFromPool(poolToken, user1, initialShares);
      const balanceAfter = await getUserBaseAssets(baseAssetToken, user1);

      const profit = BigInt(balanceAfter.toString()) - BigInt(balanceBefore.toString());
      expect(profit).to.be.gt(depositAmount); // Earned yield
    });

    it("should handle fees correctly throughout cycle", async () => {
      const { poolToken, baseAssetToken, user1, deployer } = fixture;

      // Set withdrawal fee to 1% (100 BPS)
      await poolToken.connect(deployer).setWithdrawalFeeBps(100);

      const depositAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);

      // Deposit
      await fundUserWithTokens(baseAssetToken, user1, depositAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      const sharesAfterDeposit = await getUserShares(poolToken, user1);

      // Withdraw with fee
      const withdrawAmount = parseUnits("500", fixture.baseAssetInfo.decimals);
      const balanceBefore = await getUserBaseAssets(baseAssetToken, user1);

      await withdrawFromPool(poolToken, user1, withdrawAmount);

      const balanceAfter = await getUserBaseAssets(baseAssetToken, user1);
      const actualReceived = BigInt(balanceAfter.toString()) - BigInt(balanceBefore.toString());

      // Should receive 99% due to 1% fee
      const expectedReceived = withdrawAmount * 99n / 100n;
      expect(actualReceived).to.equal(expectedReceived);

      // Fee should remain in vault, increasing value for remaining shares
      const remainingShares = await getUserShares(poolToken, user1);
      const totalValue = await getPoolTokenValue(poolToken);
      const shareValue = BigInt(totalValue.toString()) * BigInt(remainingShares.toString()) / BigInt((await getPoolTokenShares(poolToken)).toString());

      // Remaining position should be worth more than proportional original deposit
      const originalRemainingValue = (depositAmount - withdrawAmount) * BigInt(remainingShares.toString()) / BigInt(sharesAfterDeposit.toString());
      expect(shareValue).to.be.gt(originalRemainingValue);
    });
  });

  describe("Multi-User Scenarios", () => {
    let fixture: DPoolFixtureResult;

    beforeEach(async () => {
      fixture = await DPUSDCFixture();
    });

    it("should handle multiple users depositing and withdrawing", async () => {
      const { poolToken, baseAssetToken, user1, user2 } = fixture;

      const deposit1 = parseUnits("1000", fixture.baseAssetInfo.decimals);
      const deposit2 = parseUnits("2000", fixture.baseAssetInfo.decimals);

      // User1 deposits first
      await fundUserWithTokens(baseAssetToken, user1, deposit1, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, deposit1);
      await depositToPool(poolToken, user1, deposit1);

      const user1SharesAfterDeposit = await getUserShares(poolToken, user1);
      const totalValueAfterUser1 = await getPoolTokenValue(poolToken);

      // User2 deposits double amount
      await fundUserWithTokens(baseAssetToken, user2, deposit2, fixture.deployer);
      await approveToken(baseAssetToken, user2, await poolToken.getAddress(), deposit2);
      await depositToPool(poolToken, user2, deposit2);

      const user2Shares = await getUserShares(poolToken, user2);
      const totalValueAfterUser2 = await getPoolTokenValue(poolToken);

      // User2 should have approximately 2x shares of user1
      expect(user2Shares).to.be.closeTo(BigInt(user1SharesAfterDeposit.toString()) * 2n, BigInt(user1SharesAfterDeposit.toString()) / 10n);
      expect(totalValueAfterUser2).to.be.closeTo(BigInt(totalValueAfterUser1.toString()) + deposit2, deposit2 / 100n);

      // Both users benefit from yield
      await simulateLPValueIncrease(
        fixture.curvePool,
        fixture.baseAssetToken,
        fixture.otherAssetToken,
        fixture.deployer,
        parseUnits("1000", fixture.baseAssetInfo.decimals),
        parseUnits("1000", fixture.otherAssetInfo.decimals)
      );

      const valueAfterYield = await getPoolTokenValue(poolToken);
      expect(valueAfterYield).to.be.gt(totalValueAfterUser2);

      // User1 withdraws completely
      const user1Balance1 = await getUserBaseAssets(baseAssetToken, user1);
      await redeemFromPool(poolToken, user1, user1SharesAfterDeposit);
      const user1Balance2 = await getUserBaseAssets(baseAssetToken, user1);

      const user1Received = BigInt(user1Balance2.toString()) - BigInt(user1Balance1.toString());
      expect(user1Received).to.be.gt(deposit1); // Should have earned yield

      // User2's position should be unaffected
      const user2SharesAfterUser1Exit = await getUserShares(poolToken, user2);
      expect(user2SharesAfterUser1Exit).to.equal(user2Shares);

      // User2 withdraws half
      const user2Balance1 = await getUserBaseAssets(baseAssetToken, user2);
      await redeemFromPool(poolToken, user2, BigInt(user2Shares.toString()) / 2n);
      const user2Balance2 = await getUserBaseAssets(baseAssetToken, user2);

      const user2Received = BigInt(user2Balance2.toString()) - BigInt(user2Balance1.toString());
      expect(user2Received).to.be.gt(deposit2 / 2n); // Should have earned proportional yield
    });

    it("should allocate yield proportionally among users", async () => {
      const { poolToken, baseAssetToken, user1, user2 } = fixture;

      const deposit1 = parseUnits("1000", fixture.baseAssetInfo.decimals);
      const deposit2 = parseUnits("3000", fixture.baseAssetInfo.decimals);

      // Both users deposit
      await fundUserWithTokens(baseAssetToken, user1, deposit1, fixture.deployer);
      await fundUserWithTokens(baseAssetToken, user2, deposit2, fixture.deployer);

      await approveToken(baseAssetToken, user1, poolToken.address, deposit1);
      await approveToken(baseAssetToken, user2, poolToken.address, deposit2);

      await depositToPool(poolToken, user1, deposit1);
      await depositToPool(poolToken, user2, deposit2);

      const user1Shares = await getUserShares(poolToken, user1);
      const user2Shares = await getUserShares(poolToken, user2);

      // Generate yield
      await simulateLPValueIncrease(
        fixture.curvePool,
        fixture.baseAssetToken,
        fixture.otherAssetToken,
        fixture.deployer,
        parseUnits("2000", fixture.baseAssetInfo.decimals),
        parseUnits("2000", fixture.otherAssetInfo.decimals)
      );

      // Both withdraw completely
      const user1Balance1 = await getUserBaseAssets(baseAssetToken, user1);
      const user2Balance1 = await getUserBaseAssets(baseAssetToken, user2);

      await redeemFromPool(poolToken, user1, user1Shares);
      await redeemFromPool(poolToken, user2, user2Shares);

      const user1Balance2 = await getUserBaseAssets(baseAssetToken, user1);
      const user2Balance2 = await getUserBaseAssets(baseAssetToken, user2);

      const user1Profit = (BigInt(user1Balance2.toString()) - BigInt(user1Balance1.toString())) - deposit1;
      const user2Profit = (BigInt(user2Balance2.toString()) - BigInt(user2Balance1.toString())) - deposit2;

      // User2 should have earned approximately 3x the profit of user1 (proportional to deposit)
      expect(user2Profit).to.be.gt(0);
      expect(user1Profit).to.be.gt(0);
      expect(user2Profit).to.be.closeTo(user1Profit * 3n, user1Profit); // Within 100% tolerance for rounding
    });

    it("should handle user withdrawing while others remain", async () => {
      const { poolToken, baseAssetToken, user1, user2 } = fixture;

      const depositAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);

      // Both users deposit same amount
      await fundUserWithTokens(baseAssetToken, user1, depositAmount, fixture.deployer);
      await fundUserWithTokens(baseAssetToken, user2, depositAmount, fixture.deployer);

      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await approveToken(baseAssetToken, user2, poolToken.address, depositAmount);

      await depositToPool(poolToken, user1, depositAmount);
      await depositToPool(poolToken, user2, depositAmount);

      const user1Shares = await getUserShares(poolToken, user1);
      const user2SharesBefore = await getUserShares(poolToken, user2);
      const totalValueBefore = await getPoolTokenValue(poolToken);

      // User1 withdraws completely
      await redeemFromPool(poolToken, user1, user1Shares);

      // User2's shares should remain the same
      const user2SharesAfter = await getUserShares(poolToken, user2);
      expect(user2SharesAfter).to.equal(user2SharesBefore);

      // Total value should decrease by user1's withdrawal
      const totalValueAfter = await getPoolTokenValue(poolToken);
      expect(totalValueAfter).to.be.lt(totalValueBefore);

      // User2 should still own ~100% of remaining value
      const user2ValueOwnership = (BigInt(totalValueAfter.toString()) * BigInt(user2SharesAfter.toString())) / BigInt((await getPoolTokenShares(poolToken)).toString());
      expect(user2ValueOwnership).to.be.closeTo(BigInt(totalValueAfter.toString()), BigInt(totalValueAfter.toString()) / 100n);

      // Verify user1 has no shares left
      const user1SharesAfter = await getUserShares(poolToken, user1);
      expect(user1SharesAfter).to.equal(0);
    });
  });

  describe("Cross-Pool Operations", () => {
    it("should support both USDC and dUSD pools simultaneously", async () => {
      // Test with both fixture types
      const usdcFixture = await DPUSDCFixture();
      const dusdFixture = await DPUSDFixture();

      const depositAmount = parseUnits("1000", 6); // USDC has 6 decimals
      const depositAmountDUSD = parseUnits("1000", 18); // dUSD has 18 decimals

      // Deposit to USDC pool
      await fundUserWithTokens(
        usdcFixture.baseAssetToken,
        usdcFixture.user1,
        depositAmount,
        usdcFixture.deployer
      );
      await approveToken(
        usdcFixture.baseAssetToken,
        usdcFixture.user1,
        usdcFixture.poolToken.address,
        depositAmount
      );
      await depositToPool(usdcFixture.poolToken, usdcFixture.user1, depositAmount);

      // Deposit to dUSD pool
      await fundUserWithTokens(
        dusdFixture.baseAssetToken,
        dusdFixture.user1,
        depositAmountDUSD,
        dusdFixture.deployer
      );
      await approveToken(
        dusdFixture.baseAssetToken,
        dusdFixture.user1,
        dusdFixture.poolToken.address,
        depositAmountDUSD
      );
      await depositToPool(dusdFixture.poolToken, dusdFixture.user1, depositAmountDUSD);

      // Both pools should have value
      expect(await usdcFixture.poolToken.totalAssets()).to.be.gt(0);
      expect(await dusdFixture.poolToken.totalAssets()).to.be.gt(0);

      // Both users should have shares
      expect(await getUserShares(usdcFixture.poolToken, usdcFixture.user1)).to.be.gt(0);
      expect(await getUserShares(dusdFixture.poolToken, dusdFixture.user1)).to.be.gt(0);

      // Generate yield in both pools
      await simulateLPValueIncrease(
        usdcFixture.curvePool,
        usdcFixture.baseAssetToken,
        usdcFixture.otherAssetToken,
        usdcFixture.deployer,
        parseUnits("500", 6),
        parseUnits("500", 18)
      );

      await simulateLPValueIncrease(
        dusdFixture.curvePool,
        dusdFixture.baseAssetToken,
        dusdFixture.otherAssetToken,
        dusdFixture.deployer,
        parseUnits("500", 18),
        parseUnits("500", 6)
      );

      // Both pools should show increased value
      expect(await usdcFixture.poolToken.totalAssets()).to.be.gt(depositAmount);
      expect(await dusdFixture.poolToken.totalAssets()).to.be.gt(depositAmountDUSD);
    });
  });

  describe("System Configuration Changes", () => {
    let fixture: DPoolFixtureResult;

    beforeEach(async () => {
      fixture = await DPUSDCFixture();
    });

    it("should handle router updates during active positions", async () => {
      const { poolToken, baseAssetToken, user1, deployer, collateralVault } = fixture;

      const depositAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);

      // User deposits
      await fundUserWithTokens(baseAssetToken, user1, depositAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      const sharesAfterDeposit = await getUserShares(poolToken, user1);
      expect(sharesAfterDeposit).to.be.gt(0);

      // Deploy new router
      const DPoolRouterFactory = await ethers.getContractFactory("DPoolRouter");
      const newRouter = await DPoolRouterFactory.deploy(poolToken.address, collateralVault.address);

      // Update router in pool token
      await poolToken.connect(deployer).setRouter(await newRouter.getAddress());

      // Old deposits should still be withdrawable (existing LP tokens in vault)
      // But new deposits would fail until new router is configured

      // Verify withdrawal still works with old position
      const withdrawAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      // This should fail because new router isn't configured yet
      await expect(
        withdrawFromPool(poolToken, user1, withdrawAmount)
      ).to.be.reverted; // Router not configured with adapters

      // Configure new router
      await newRouter.connect(deployer).addLPAdapter(
        fixture.curvePool.address,
        fixture.curveLPAdapter.address
      );
      await newRouter.connect(deployer).setDefaultDepositLP(fixture.curvePool.address);

      // Grant necessary roles
      const DPOOL_TOKEN_ROLE = await newRouter.DPOOL_TOKEN_ROLE();
      await newRouter.connect(deployer).grantRole(DPOOL_TOKEN_ROLE, poolToken.address);

      // Update collateral vault router
      await collateralVault.connect(deployer).setRouter(await newRouter.getAddress());

      // Now withdrawal should work
      const balanceBefore = await getUserBaseAssets(baseAssetToken, user1);
      await withdrawFromPool(poolToken, user1, withdrawAmount);
      const balanceAfter = await getUserBaseAssets(baseAssetToken, user1);

      expect(BigInt(balanceAfter.toString()) - BigInt(balanceBefore.toString())).to.equal(withdrawAmount);
    });

    it("should handle fee changes for future operations", async () => {
      const { poolToken, baseAssetToken, user1, deployer } = fixture;

      const depositAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);

      // Deposit with no fees
      await fundUserWithTokens(baseAssetToken, user1, depositAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, poolToken.address, depositAmount);
      await depositToPool(poolToken, user1, depositAmount);

      // Withdraw with no fees
      const withdrawAmount1 = parseUnits("200", fixture.baseAssetInfo.decimals);
      const balance1 = await getUserBaseAssets(baseAssetToken, user1);
      await withdrawFromPool(poolToken, user1, withdrawAmount1);
      const balance2 = await getUserBaseAssets(baseAssetToken, user1);

      expect(BigInt(balance2.toString()) - BigInt(balance1.toString())).to.equal(withdrawAmount1); // No fee

      // Change fee to 2%
      await poolToken.connect(deployer).setWithdrawalFeeBps(200);

      // Subsequent withdrawals should have fees
      const withdrawAmount2 = parseUnits("200", fixture.baseAssetInfo.decimals);
      await withdrawFromPool(poolToken, user1, withdrawAmount2);
      const balance3 = await getUserBaseAssets(baseAssetToken, user1);

      const actualReceived = BigInt(balance3.toString()) - BigInt(balance2.toString());
      const expectedWithFee = withdrawAmount2 * 98n / 100n; // 2% fee

      expect(actualReceived).to.equal(expectedWithFee);
    });

    it("should handle adapter updates for new LP tokens", async () => {
      const { router, collateralVault, deployer, baseAssetToken, otherAssetToken } = fixture;

      // Deploy second Curve pool
      const MockCurveFactory = await ethers.getContractFactory("MockCurveStableSwapNG");
      const newCurvePool = await MockCurveFactory.deploy(
        "New Pool",
        "NEW",
        [await baseAssetToken.getAddress(), await otherAssetToken.getAddress()],
        4000000
      );

      // Deploy adapter for new pool
      const CurveLPAdapterFactory = await ethers.getContractFactory("CurveLPAdapter");
      const newAdapter = await CurveLPAdapterFactory.deploy(
        await newCurvePool.getAddress(),
        await baseAssetToken.getAddress(),
        await collateralVault.getAddress()
      );

      // Add new adapter to both router and collateral vault
      await router.connect(deployer).addLPAdapter(await newCurvePool.getAddress(), await newAdapter.getAddress());
      await collateralVault.connect(deployer).addLPAdapter(await newCurvePool.getAddress(), await newAdapter.getAddress());

      // Verify adapters were added
      expect(await router.lpAdapters(await newCurvePool.getAddress())).to.equal(await newAdapter.getAddress());
      expect(await collateralVault.adapterForLP(await newCurvePool.getAddress())).to.equal(await newAdapter.getAddress());

      // Change default deposit LP to new pool
      await router.connect(deployer).setDefaultDepositLP(await newCurvePool.getAddress());

      expect(await router.defaultDepositLP()).to.equal(await newCurvePool.getAddress());

      // Future deposits would now go to the new pool
      // (actual deposit test would require more setup)
    });
  });
}); 