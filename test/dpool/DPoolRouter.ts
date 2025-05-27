import { expect } from "chai";
import { ethers } from "hardhat";
import { parseUnits, ZeroAddress } from "ethers";

import {
  DPUSDCFixture,
  DPoolFixtureResult,
  fundUserWithTokens,
} from "./fixture";

describe("DPoolRouter", () => {
  let fixture: DPoolFixtureResult;

  beforeEach(async () => {
    fixture = await DPUSDCFixture();
  });

  describe("Constructor & Initialization", () => {
    it("should deploy with correct parameters", async () => {
      const { router, poolToken, collateralVault, baseAssetToken } = fixture;

      expect(await router.poolToken()).to.equal(poolToken.address);
      expect(await router.collateralVault()).to.equal(collateralVault.address);
      expect(await router.baseAsset()).to.equal(baseAssetToken.address);
      expect(await router.maxSlippageBps()).to.equal(20_000); // 2% initial from constructor
    });

    it("should set correct roles during initialization", async () => {
      const { router, deployer, poolToken } = fixture;

      const DEFAULT_ADMIN_ROLE = await router.DEFAULT_ADMIN_ROLE();
      const DPOOL_TOKEN_ROLE = await router.DPOOL_TOKEN_ROLE();

      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.true;
      expect(await router.hasRole(DPOOL_TOKEN_ROLE, poolToken.address)).to.be.true;
    });

    it("should revert constructor with zero addresses", async () => {
      const DPoolRouterFactory = await ethers.getContractFactory("DPoolRouter");
      
      // Zero pool token
      await expect(
        DPoolRouterFactory.deploy(ZeroAddress, fixture.collateralVault.address)
      ).to.be.revertedWithCustomError(DPoolRouterFactory, "ZeroAddress");

      // Zero collateral vault
      await expect(
        DPoolRouterFactory.deploy(fixture.poolToken.address, ZeroAddress)
      ).to.be.revertedWithCustomError(DPoolRouterFactory, "ZeroAddress");
    });
  });

  describe("LP Adapter Management", () => {
    it("should add LP adapter correctly", async () => {
      const { router, curveLPAdapter, curvePool, deployer } = fixture;

      await expect(
        router.connect(deployer).addLPAdapter(curvePool.address, curveLPAdapter.address)
      ).to.emit(router, "LPAdapterAdded")
        .withArgs(curvePool.address, curveLPAdapter.address);

      expect(await router.lpAdapters(curvePool.address)).to.equal(curveLPAdapter.address);
    });

    it("should validate adapter configuration when adding", async () => {
      const { router, curvePool, deployer } = fixture;

      // Try to add adapter that doesn't match LP token
      await expect(
        router.connect(deployer).addLPAdapter(
          fixture.baseAssetToken.address, // Wrong LP token
          fixture.curveLPAdapter.address
        )
      ).to.be.revertedWithCustomError(router, "AdapterMismatch");
    });

    it("should prevent adding duplicate adapters", async () => {
      const { router, curveLPAdapter, curvePool, deployer } = fixture;

      // Add adapter first time
      await router.connect(deployer).addLPAdapter(curvePool.address, curveLPAdapter.address);

      // Try to add same adapter again
      await expect(
        router.connect(deployer).addLPAdapter(curvePool.address, curveLPAdapter.address)
      ).to.be.revertedWithCustomError(router, "LPTokenAlreadySupported");
    });

    it("should remove LP adapter correctly", async () => {
      const { router, curveLPAdapter, curvePool, deployer } = fixture;

      // Add adapter first
      await router.connect(deployer).addLPAdapter(curvePool.address, curveLPAdapter.address);

      // Remove adapter
      await expect(
        router.connect(deployer).removeLPAdapter(curvePool.address)
      ).to.emit(router, "LPAdapterRemoved")
        .withArgs(curvePool.address);

      expect(await router.lpAdapters(curvePool.address)).to.equal(ZeroAddress);
    });

    it("should clear default deposit LP when removing adapter", async () => {
      const { router, curveLPAdapter, curvePool, deployer } = fixture;

      // Add adapter and set as default
      await router.connect(deployer).addLPAdapter(curvePool.address, curveLPAdapter.address);
      await router.connect(deployer).setDefaultDepositLP(curvePool.address);

      expect(await router.defaultDepositLP()).to.equal(curvePool.address);

      // Remove adapter
      await router.connect(deployer).removeLPAdapter(curvePool.address);

      expect(await router.defaultDepositLP()).to.equal(ZeroAddress);
    });

    it("should prevent removing non-existent adapter", async () => {
      const { router, deployer } = fixture;

      await expect(
        router.connect(deployer).removeLPAdapter(fixture.baseAssetToken.address)
      ).to.be.revertedWithCustomError(router, "AdapterNotFound");
    });

    it("should prevent adding adapter with zero addresses", async () => {
      const { router, curveLPAdapter, curvePool, deployer } = fixture;

      // Zero LP token
      await expect(
        router.connect(deployer).addLPAdapter(ZeroAddress, curveLPAdapter.address)
      ).to.be.revertedWithCustomError(router, "ZeroAddress");

      // Zero adapter
      await expect(
        router.connect(deployer).addLPAdapter(curvePool.address, ZeroAddress)
      ).to.be.revertedWithCustomError(router, "ZeroAddress");
    });

    it("should prevent non-admin from managing adapters", async () => {
      const { router, curveLPAdapter, curvePool, user1 } = fixture;

      await expect(
        router.connect(user1).addLPAdapter(curvePool.address, curveLPAdapter.address)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");

      await expect(
        router.connect(user1).removeLPAdapter(curvePool.address)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Default Deposit LP Management", () => {
    beforeEach(async () => {
      // Add adapter
      await fixture.router.connect(fixture.deployer).addLPAdapter(
        fixture.curvePool.address,
        fixture.curveLPAdapter.address
      );
    });

    it("should set default deposit LP correctly", async () => {
      const { router, curvePool, deployer } = fixture;

      await expect(
        router.connect(deployer).setDefaultDepositLP(curvePool.address)
      ).to.emit(router, "DefaultDepositLPUpdated")
        .withArgs(ZeroAddress, curvePool.address);

      expect(await router.defaultDepositLP()).to.equal(curvePool.address);
    });

    it("should prevent setting non-existent LP as default", async () => {
      const { router, deployer } = fixture;

      await expect(
        router.connect(deployer).setDefaultDepositLP(fixture.baseAssetToken.address)
      ).to.be.revertedWithCustomError(router, "AdapterNotFound");
    });

    it("should prevent non-admin from setting default", async () => {
      const { router, curvePool, user1 } = fixture;

      await expect(
        router.connect(user1).setDefaultDepositLP(curvePool.address)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Slippage Management", () => {
    it("should set max slippage correctly", async () => {
      const { router, deployer } = fixture;

      const newMaxSlippage = 50_000; // 5%

      await expect(
        router.connect(deployer).setMaxSlippageBps(newMaxSlippage)
      ).to.emit(router, "MaxSlippageUpdated")
        .withArgs(20_000, newMaxSlippage);

      expect(await router.maxSlippageBps()).to.equal(newMaxSlippage);
    });

    it("should prevent setting slippage above maximum", async () => {
      const { router, deployer } = fixture;

      const tooHighSlippage = 100_001; // Over 10%

      await expect(
        router.connect(deployer).setMaxSlippageBps(tooHighSlippage)
      ).to.be.revertedWithCustomError(router, "InvalidSlippage");
    });

    it("should prevent non-admin from setting slippage", async () => {
      const { router, user1 } = fixture;

      await expect(
        router.connect(user1).setMaxSlippageBps(30_000)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Deposit Routing", () => {
    beforeEach(async () => {
      // Setup adapter and default LP
      await fixture.router.connect(fixture.deployer).addLPAdapter(
        fixture.curvePool.address,
        fixture.curveLPAdapter.address
      );
      await fixture.router.connect(fixture.deployer).setDefaultDepositLP(
        fixture.curvePool.address
      );
    });

    it("should handle deposit routing correctly", async () => {
      const { router, poolToken, baseAssetToken } = fixture;

      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      // Fund pool token with base asset
      await fundUserWithTokens(baseAssetToken, { address: poolToken.address }, depositAmount, fixture.deployer);
      
      // Approve router to spend from pool token
      await baseAssetToken.connect(fixture.deployer).transfer(poolToken.address, depositAmount);
      
      // Mock the deposit call from pool token
      await expect(
        router.connect(poolToken.address).deposit(depositAmount, fixture.user1.address, 0)
      ).to.emit(router, "Deposit");
    });

    it("should revert deposit when no default LP set", async () => {
      const { router, poolToken } = fixture;

      // Remove default LP
      await router.connect(fixture.deployer).removeLPAdapter(fixture.curvePool.address);

      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);

      await expect(
        router.connect(poolToken.address).deposit(depositAmount, fixture.user1.address, 0)
      ).to.be.revertedWithCustomError(router, "AdapterNotFound");
    });

    it("should revert deposit when adapter not found", async () => {
      const { router, poolToken, deployer } = fixture;

      // Remove adapter but leave default set (shouldn't happen in practice)
      await router.connect(deployer).removeLPAdapter(fixture.curvePool.address);
      
      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);

      await expect(
        router.connect(poolToken.address).deposit(depositAmount, fixture.user1.address, 0)
      ).to.be.revertedWithCustomError(router, "AdapterNotFound");
    });

    it("should prevent non-pool-token from calling deposit", async () => {
      const { router, user1 } = fixture;

      const depositAmount = parseUnits("100", fixture.baseAssetInfo.decimals);

      await expect(
        router.connect(user1).deposit(depositAmount, user1.address, 0)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Withdrawal Routing", () => {
    beforeEach(async () => {
      // Setup adapter and default LP
      await fixture.router.connect(fixture.deployer).addLPAdapter(
        fixture.curvePool.address,
        fixture.curveLPAdapter.address
      );
      await fixture.router.connect(fixture.deployer).setDefaultDepositLP(
        fixture.curvePool.address
      );

      // Add some LP tokens to collateral vault for testing
      const lpAmount = parseUnits("100", 18); // Curve LP tokens typically have 18 decimals
      await fixture.curvePool.connect(fixture.deployer).mint(fixture.collateralVault.address, lpAmount);
    });

    it("should handle withdrawal routing correctly", async () => {
      const { router, poolToken } = fixture;

      const withdrawAmount = parseUnits("50", fixture.baseAssetInfo.decimals);
      const maxSlippage = 10_000; // 1%

      await expect(
        router.connect(poolToken.address).withdraw(
          withdrawAmount,
          fixture.user1.address,
          fixture.user1.address,
          maxSlippage
        )
      ).to.emit(router, "Withdraw");
    });

    it("should respect slippage limits", async () => {
      const { router, poolToken } = fixture;

      const withdrawAmount = parseUnits("50", fixture.baseAssetInfo.decimals);
      const tooHighSlippage = 25_000; // 2.5% (over the 2% max)

      await expect(
        router.connect(poolToken.address).withdraw(
          withdrawAmount,
          fixture.user1.address,
          fixture.user1.address,
          tooHighSlippage
        )
      ).to.be.revertedWithCustomError(router, "InvalidSlippage");
    });

    it("should revert withdrawal when no default LP set", async () => {
      const { router, poolToken, deployer } = fixture;

      // Remove default LP
      await router.connect(deployer).removeLPAdapter(fixture.curvePool.address);

      const withdrawAmount = parseUnits("50", fixture.baseAssetInfo.decimals);

      await expect(
        router.connect(poolToken.address).withdraw(
          withdrawAmount,
          fixture.user1.address,
          fixture.user1.address,
          5_000
        )
      ).to.be.revertedWithCustomError(router, "AdapterNotFound");
    });

    it("should prevent non-pool-token from calling withdraw", async () => {
      const { router, user1 } = fixture;

      const withdrawAmount = parseUnits("50", fixture.baseAssetInfo.decimals);

      await expect(
        router.connect(user1).withdraw(
          withdrawAmount,
          user1.address,
          user1.address,
          5_000
        )
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Internal Functions & Edge Cases", () => {
    beforeEach(async () => {
      // Setup adapter
      await fixture.router.connect(fixture.deployer).addLPAdapter(
        fixture.curvePool.address,
        fixture.curveLPAdapter.address
      );
    });

    it("should validate adapter configuration correctly", async () => {
      const { router, deployer, curvePool, baseAssetToken, collateralVault } = fixture;

      // Try to add an adapter with mismatched base asset
      const CurveLPAdapterFactory = await ethers.getContractFactory("CurveLPAdapter");
      
      // This should fail during deployment or validation
      await expect(
        router.connect(deployer).addLPAdapter(curvePool.address, baseAssetToken.address)
      ).to.be.reverted; // Will revert because baseAssetToken doesn't implement adapter interface
    });

    it("should handle LP requirement calculations with slippage", async () => {
      const { router, curveLPAdapter } = fixture;

      // This tests the internal _calculateRequiredLPTokens function indirectly
      // through preview functions on the adapter
      const baseAmount = parseUnits("100", fixture.baseAssetInfo.decimals);
      
      const [lpToken, previewLP] = await curveLPAdapter.previewConvertToLP(baseAmount);
      expect(lpToken).to.equal(fixture.curvePool.address);
      expect(previewLP).to.be.gt(0);
    });

    it("should handle zero amounts correctly", async () => {
      const { curveLPAdapter } = fixture;

      const [lpToken, previewLP] = await curveLPAdapter.previewConvertToLP(0);
      expect(lpToken).to.equal(fixture.curvePool.address);
      expect(previewLP).to.equal(0);

      const previewBase = await curveLPAdapter.previewConvertFromLP(0);
      expect(previewBase).to.equal(0);
    });

    it("should maintain correct constants", async () => {
      const { router } = fixture;

      expect(await router.MAX_SLIPPAGE_BPS()).to.equal(100_000); // 10%
    });
  });

  describe("Access Control Edge Cases", () => {
    it("should properly handle role management", async () => {
      const { router, deployer, user1 } = fixture;

      const DEFAULT_ADMIN_ROLE = await router.DEFAULT_ADMIN_ROLE();
      const DPOOL_TOKEN_ROLE = await router.DPOOL_TOKEN_ROLE();

      // Admin can grant/revoke roles
      await router.connect(deployer).grantRole(DEFAULT_ADMIN_ROLE, user1.address);
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.true;

      // New admin can manage adapters
      await router.connect(user1).setMaxSlippageBps(30_000);
      expect(await router.maxSlippageBps()).to.equal(30_000);

      // Revoke role
      await router.connect(deployer).revokeRole(DEFAULT_ADMIN_ROLE, user1.address);
      expect(await router.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).to.be.false;
    });

    it("should prevent unauthorized access to admin functions", async () => {
      const { router, user1, curvePool, curveLPAdapter } = fixture;

      // All admin functions should be protected
      await expect(
        router.connect(user1).addLPAdapter(curvePool.address, curveLPAdapter.address)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");

      await expect(
        router.connect(user1).removeLPAdapter(curvePool.address)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");

      await expect(
        router.connect(user1).setDefaultDepositLP(curvePool.address)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");

      await expect(
        router.connect(user1).setMaxSlippageBps(30_000)
      ).to.be.revertedWithCustomError(router, "AccessControlUnauthorizedAccount");
    });
  });
}); 