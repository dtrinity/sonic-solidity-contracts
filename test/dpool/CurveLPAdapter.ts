import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, ZeroAddress } from "ethers";

import {
  DPUSDCFixture,
  DPoolFixtureResult,
  fundUserWithTokens,
  approveToken,
} from "./fixture";

describe("CurveLPAdapter", () => {
  let fixture: DPoolFixtureResult;

  beforeEach(async () => {
    fixture = await DPUSDCFixture();
  });

  describe("Constructor & Initialization", () => {
    it("should deploy with correct parameters", async () => {
      const { curveLPAdapter, curvePool, baseAssetToken, collateralVault } = fixture;

      expect(await curveLPAdapter.curvePool()).to.equal(curvePool.address);
      expect(await curveLPAdapter.lpToken()).to.equal(curvePool.address);
      expect(await curveLPAdapter.baseAsset()).to.equal(baseAssetToken.address);
      expect(await curveLPAdapter.collateralVault()).to.equal(collateralVault.address);
    });

    it("should determine correct asset indices", async () => {
      const { curveLPAdapter } = fixture;

      const baseAssetIndex = await curveLPAdapter.baseAssetIndex();
      const otherAssetIndex = await curveLPAdapter.otherAssetIndex();

      // Based on fixture config, USDC should be first token (index 0)
      expect(baseAssetIndex).to.equal(0);
      expect(otherAssetIndex).to.equal(1);
    });

    it("should revert constructor with zero addresses", async () => {
      const CurveLPAdapterFactory = await ethers.getContractFactory("CurveLPAdapter");
      
      // Zero curve pool
      await expect(
        CurveLPAdapterFactory.deploy(
          ZeroAddress,
          fixture.baseAssetToken.address,
          fixture.collateralVault.address
        )
      ).to.be.revertedWithCustomError(CurveLPAdapterFactory, "ZeroAddress");

      // Zero base asset
      await expect(
        CurveLPAdapterFactory.deploy(
          fixture.curvePool.address,
          ZeroAddress,
          fixture.collateralVault.address
        )
      ).to.be.revertedWithCustomError(CurveLPAdapterFactory, "ZeroAddress");

      // Zero collateral vault
      await expect(
        CurveLPAdapterFactory.deploy(
          fixture.curvePool.address,
          fixture.baseAssetToken.address,
          ZeroAddress
        )
      ).to.be.revertedWithCustomError(CurveLPAdapterFactory, "ZeroAddress");
    });

    it("should revert when base asset not in pool", async () => {
      const CurveLPAdapterFactory = await ethers.getContractFactory("CurveLPAdapter");
      
      // Try to deploy with base asset that's not in the pool
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const wrongAsset = await MockERC20Factory.deploy("Wrong", "WRONG", 18, 1000000);

      await expect(
        CurveLPAdapterFactory.deploy(
          fixture.curvePool.address,
          await wrongAsset.getAddress(),
          fixture.collateralVault.address
        )
      ).to.be.revertedWithCustomError(CurveLPAdapterFactory, "UnderlyingAssetNotInPool");
    });
  });

  describe("Convert To LP", () => {
    beforeEach(async () => {
      // Fund adapter with base assets for testing
      await fundUserWithTokens(
        fixture.baseAssetToken,
        fixture.curveLPAdapter,
        parseUnits("10000", fixture.baseAssetInfo.decimals),
        fixture.deployer
      );
    });

    it("should convert base asset to LP tokens correctly", async () => {
      const { curveLPAdapter, baseAssetToken, curvePool, collateralVault, user1 } = fixture;

      const convertAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      // Fund user with base asset
      await fundUserWithTokens(baseAssetToken, user1, convertAmount, fixture.deployer);
      
      // Approve adapter to spend user's tokens
      await approveToken(baseAssetToken, user1, curveLPAdapter.address, convertAmount);

      // Get initial balances
      const vaultLPBalanceBefore = await curvePool.balanceOf(collateralVault.address);
      const userBaseBalanceBefore = await baseAssetToken.balanceOf(user1.address);

      // Convert to LP
      const [lpTokenAddress, lpAmount] = await curveLPAdapter.connect(user1).convertToLP.staticCall(
        convertAmount,
        0
      );

      await curveLPAdapter.connect(user1).convertToLP(convertAmount, 0);

      // Check results
      expect(lpTokenAddress).to.equal(curvePool.address);
      expect(lpAmount).to.be.gt(0);

      const vaultLPBalanceAfter = await curvePool.balanceOf(collateralVault.address);
      const userBaseBalanceAfter = await baseAssetToken.balanceOf(user1.address);

      expect(BigInt(vaultLPBalanceAfter.toString()) - BigInt(vaultLPBalanceBefore.toString())).to.equal(lpAmount);
      expect(BigInt(userBaseBalanceBefore.toString()) - BigInt(userBaseBalanceAfter.toString())).to.equal(convertAmount);
    });

    it("should respect minimum LP amount", async () => {
      const { curveLPAdapter, baseAssetToken, user1 } = fixture;

      const convertAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      const unrealisticMinLP = parseUnits("1000000", 18); // Very high minimum
      
      await fundUserWithTokens(baseAssetToken, user1, convertAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, curveLPAdapter.address, convertAmount);

      // Should revert due to slippage (min LP amount too high)
      await expect(
        curveLPAdapter.connect(user1).convertToLP(convertAmount, unrealisticMinLP)
      ).to.be.reverted; // Curve pool will revert on insufficient output
    });

    it("should handle zero amount conversion", async () => {
      const { curveLPAdapter, user1 } = fixture;

      // Converting zero should not revert but should return zero LP
      const [lpTokenAddress, lpAmount] = await curveLPAdapter.connect(user1).convertToLP.staticCall(0, 0);
      
      expect(lpTokenAddress).to.equal(fixture.curvePool.address);
      expect(lpAmount).to.equal(0);
    });

    it("should handle small amounts correctly", async () => {
      const { curveLPAdapter, baseAssetToken, user1 } = fixture;

      const smallAmount = 1n; // 1 wei
      
      await fundUserWithTokens(baseAssetToken, user1, smallAmount, fixture.deployer);
      await approveToken(baseAssetToken, user1, curveLPAdapter.address, smallAmount);

      const [lpTokenAddress, lpAmount] = await curveLPAdapter.connect(user1).convertToLP.staticCall(
        smallAmount,
        0
      );

      expect(lpTokenAddress).to.equal(fixture.curvePool.address);
      // LP amount might be 0 for very small amounts due to rounding
      expect(lpAmount).to.be.gte(0);
    });
  });

  describe("Convert From LP", () => {
    beforeEach(async () => {
      // Setup: Add some liquidity to the pool first
      const setupAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);
      await fundUserWithTokens(fixture.baseAssetToken, fixture.deployer, setupAmount, fixture.deployer);
      await fundUserWithTokens(fixture.otherAssetToken, fixture.deployer, setupAmount, fixture.deployer);
      
      await approveToken(fixture.baseAssetToken, fixture.deployer, fixture.curvePool.address, setupAmount);
      await approveToken(fixture.otherAssetToken, fixture.deployer, fixture.curvePool.address, setupAmount);
      
      await fixture.curvePool.connect(fixture.deployer).add_liquidity([setupAmount, setupAmount], 0);
    });

    it("should convert LP tokens to base asset correctly", async () => {
      const { curveLPAdapter, baseAssetToken, curvePool, user1 } = fixture;

      const lpAmount = parseUnits("50", 18); // 50 LP tokens
      
      // Give user some LP tokens
      await curvePool.connect(fixture.deployer).mint(user1.address, lpAmount);
      
      // Approve adapter to spend user's LP tokens
      await approveToken(curvePool, user1, curveLPAdapter.address, lpAmount);

      // Get initial balances
      const userLPBalanceBefore = await curvePool.balanceOf(user1.address);
      const userBaseBalanceBefore = await baseAssetToken.balanceOf(user1.address);

      // Convert from LP
      const baseAmountReceived = await curveLPAdapter.connect(user1).convertFromLP.staticCall(
        lpAmount,
        0
      );

      await curveLPAdapter.connect(user1).convertFromLP(lpAmount, 0);

      // Check results
      expect(baseAmountReceived).to.be.gt(0);

      const userLPBalanceAfter = await curvePool.balanceOf(user1.address);
      const userBaseBalanceAfter = await baseAssetToken.balanceOf(user1.address);

      expect(BigInt(userLPBalanceBefore.toString()) - BigInt(userLPBalanceAfter.toString())).to.equal(lpAmount);
      expect(BigInt(userBaseBalanceAfter.toString()) - BigInt(userBaseBalanceBefore.toString())).to.equal(baseAmountReceived);
    });

    it("should respect minimum base asset amount", async () => {
      const { curveLPAdapter, curvePool, user1 } = fixture;

      const lpAmount = parseUnits("50", 18);
      const unrealisticMinBase = parseUnits("1000000", fixture.baseAssetInfo.decimals);
      
      await curvePool.connect(fixture.deployer).mint(user1.address, lpAmount);
      await approveToken(curvePool, user1, curveLPAdapter.address, lpAmount);

      // Should revert due to insufficient output
      await expect(
        curveLPAdapter.connect(user1).convertFromLP(lpAmount, unrealisticMinBase)
      ).to.be.revertedWithCustomError(curveLPAdapter, "InsufficientAssetReceived");
    });

    it("should handle zero LP amount conversion", async () => {
      const { curveLPAdapter, user1 } = fixture;

      // Converting zero LP should return zero base asset
      const baseAmountReceived = await curveLPAdapter.connect(user1).convertFromLP.staticCall(0, 0);
      expect(baseAmountReceived).to.equal(0);
    });
  });

  describe("Preview Functions", () => {
    beforeEach(async () => {
      // Setup pool with some initial liquidity
      const setupAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);
      await fundUserWithTokens(fixture.baseAssetToken, fixture.deployer, setupAmount, fixture.deployer);
      await fundUserWithTokens(fixture.otherAssetToken, fixture.deployer, setupAmount, fixture.deployer);
      
      await approveToken(fixture.baseAssetToken, fixture.deployer, fixture.curvePool.address, setupAmount);
      await approveToken(fixture.otherAssetToken, fixture.deployer, fixture.curvePool.address, setupAmount);
      
      await fixture.curvePool.connect(fixture.deployer).add_liquidity([setupAmount, setupAmount], 0);
    });

    it("should preview convert to LP correctly", async () => {
      const { curveLPAdapter } = fixture;

      const baseAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      const [lpTokenAddress, previewLPAmount] = await curveLPAdapter.previewConvertToLP(baseAmount);
      
      expect(lpTokenAddress).to.equal(fixture.curvePool.address);
      expect(previewLPAmount).to.be.gt(0);
    });

    it("should preview convert from LP correctly", async () => {
      const { curveLPAdapter } = fixture;

      const lpAmount = parseUnits("100", 18);
      
      const previewBaseAmount = await curveLPAdapter.previewConvertFromLP(lpAmount);
      
      expect(previewBaseAmount).to.be.gt(0);
    });

    it("should preview zero amounts correctly", async () => {
      const { curveLPAdapter } = fixture;

      // Preview zero amounts
      const [lpTokenAddress, previewLPAmount] = await curveLPAdapter.previewConvertToLP(0);
      const previewBaseAmount = await curveLPAdapter.previewConvertFromLP(0);
      
      expect(lpTokenAddress).to.equal(fixture.curvePool.address);
      expect(previewLPAmount).to.equal(0);
      expect(previewBaseAmount).to.equal(0);
    });
  });

  describe("LP Value Calculation", () => {
    beforeEach(async () => {
      // Setup pool with initial liquidity
      const setupAmount = parseUnits("1000", fixture.baseAssetInfo.decimals);
      await fundUserWithTokens(fixture.baseAssetToken, fixture.deployer, setupAmount, fixture.deployer);
      await fundUserWithTokens(fixture.otherAssetToken, fixture.deployer, setupAmount, fixture.deployer);
      
      await approveToken(fixture.baseAssetToken, fixture.deployer, fixture.curvePool.address, setupAmount);
      await approveToken(fixture.otherAssetToken, fixture.deployer, fixture.curvePool.address, setupAmount);
      
      await fixture.curvePool.connect(fixture.deployer).add_liquidity([setupAmount, setupAmount], 0);
    });

    it("should calculate LP value in base asset correctly", async () => {
      const { curveLPAdapter, curvePool } = fixture;

      const lpAmount = parseUnits("100", 18);
      
      const value = await curveLPAdapter.lpValueInBaseAsset(curvePool.address, lpAmount);
      
      expect(value).to.be.gt(0);
    });

    it("should return zero value for zero LP amount", async () => {
      const { curveLPAdapter, curvePool } = fixture;

      const value = await curveLPAdapter.lpValueInBaseAsset(curvePool.address, 0);
      
      expect(value).to.equal(0);
    });

    it("should calculate proportional values correctly", async () => {
      const { curveLPAdapter, curvePool } = fixture;

      const lpAmount1 = parseUnits("100", 18);
      const lpAmount2 = parseUnits("200", 18);
      
      const value1 = await curveLPAdapter.lpValueInBaseAsset(curvePool.address, lpAmount1);
      const value2 = await curveLPAdapter.lpValueInBaseAsset(curvePool.address, lpAmount2);
      
      // Value should be roughly proportional (within small tolerance)
      expect(value2).to.be.closeTo(BigInt(value1.toString()) * 2n, BigInt(value1.toString()) / 10n); // Within 10% tolerance
    });
  });
}); 