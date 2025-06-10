import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import {
  deployDLoopMockFixture,
  LOWER_BOUND_BPS,
  MAX_SUBSIDY_BPS,
  TARGET_LEVERAGE_BPS,
  testSetup,
  UPPER_BOUND_BPS,
} from "./fixture";

describe("DLoopCoreMock Rebalance Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    accounts = fixture.accounts;
  });

  describe("I. Basic Increase Leverage Functionality", function () {
    it("Should increase leverage from below target to target", async function () {
      const user = accounts[1];
      const userAddress = user.address;

      // Set initial prices and make first deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8), // $1 price
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8), // $1 price
      );

      // Initial deposit
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), userAddress);

      // Verify initial leverage (allow small tolerance due to precision)
      const initialLeverage = await dloopMock.getCurrentLeverageBps();
      expect(initialLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000); // 0.1% tolerance

      // Create imbalance by increasing collateral price (reduces leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8), // $1.2 price
      );

      // Verify leverage is now below target
      const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterPriceChange).to.be.lt(TARGET_LEVERAGE_BPS);

      // Get user balances before increase leverage
      const userDebtBalanceBefore = await debtToken.balanceOf(userAddress);

      // Get expected quote for increase leverage
      const [, direction] =
        await dloopMock.getAmountToReachTargetLeverage(false);
      expect(direction).to.equal(1); // Should be increase leverage

      // Perform increase leverage
      await dloopMock
        .connect(user)
        .increaseLeverage(ethers.parseEther("10"), 0);

      // Verify user received debt tokens
      const userDebtBalanceAfter = await debtToken.balanceOf(userAddress);
      const debtReceived = userDebtBalanceAfter - userDebtBalanceBefore;
      expect(debtReceived).to.be.gt(0);

      // Verify leverage increased towards target
      const finalLeverage = await dloopMock.getCurrentLeverageBps();
      expect(finalLeverage).to.be.gt(leverageAfterPriceChange);
      expect(finalLeverage).to.be.lte(TARGET_LEVERAGE_BPS);
    });

    it("Should handle multiple increase leverage operations", async function () {
      const user = accounts[1];

      // Setup initial state
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create imbalance
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.15", 8),
      );

      const leverageBefore = await dloopMock.getCurrentLeverageBps();
      expect(leverageBefore).to.be.lt(TARGET_LEVERAGE_BPS);

      // First increase
      await dloopMock.connect(user).increaseLeverage(ethers.parseEther("5"), 0);
      const leverageAfterFirst = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterFirst).to.be.gt(leverageBefore);

      // Second increase (if still below target)
      if ((await dloopMock.getCurrentLeverageBps()) < TARGET_LEVERAGE_BPS) {
        await dloopMock
          .connect(user)
          .increaseLeverage(ethers.parseEther("3"), 0);
        const leverageAfterSecond = await dloopMock.getCurrentLeverageBps();
        expect(leverageAfterSecond).to.be.gte(leverageAfterFirst);
      }
    });
  });

  describe("II. Basic Decrease Leverage Functionality", function () {
    it("Should decrease leverage from above target to target", async function () {
      const user = accounts[1];
      const userAddress = user.address;

      // Set initial prices and make first deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8), // $1 price
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8), // $1 price
      );

      // Initial deposit
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), userAddress);

      // Verify initial leverage
      const initialLeverage = await dloopMock.getCurrentLeverageBps();
      expect(initialLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000);

      // Create imbalance by decreasing collateral price moderately (increases leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.9", 8), // $0.9 price (10% decrease)
      );

      // Verify leverage is now above target
      const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterPriceChange).to.be.gt(TARGET_LEVERAGE_BPS);

      // Get user balances before decrease leverage
      const userCollateralBalanceBefore =
        await collateralToken.balanceOf(userAddress);

      // Get expected quote for decrease leverage
      const [, direction] =
        await dloopMock.getAmountToReachTargetLeverage(false);
      expect(direction).to.equal(-1); // Should be decrease leverage

      // Fix imbalance with decrease leverage - use moderate amount
      await dloopMock.connect(user).decreaseLeverage(ethers.parseEther("8"), 0);

      // Verify user received collateral tokens
      const userCollateralBalanceAfter =
        await collateralToken.balanceOf(userAddress);
      const collateralReceived =
        userCollateralBalanceAfter - userCollateralBalanceBefore;
      expect(collateralReceived).to.be.gt(0);

      // Verify leverage decreased towards target
      const finalLeverage = await dloopMock.getCurrentLeverageBps();
      expect(finalLeverage).to.be.lt(leverageAfterPriceChange);
      expect(finalLeverage).to.be.gte(TARGET_LEVERAGE_BPS);
    });

    it("Should handle multiple decrease leverage operations", async function () {
      const user = accounts[1];

      // Setup initial state
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create moderate imbalance
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.92", 8),
      );

      const leverageBefore = await dloopMock.getCurrentLeverageBps();
      expect(leverageBefore).to.be.gt(TARGET_LEVERAGE_BPS);

      // First decrease
      await dloopMock.connect(user).decreaseLeverage(ethers.parseEther("5"), 0);
      const leverageAfterFirst = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterFirst).to.be.lt(leverageBefore);

      // Second decrease (if still above target)
      if ((await dloopMock.getCurrentLeverageBps()) > TARGET_LEVERAGE_BPS) {
        await dloopMock
          .connect(user)
          .decreaseLeverage(ethers.parseEther("3"), 0);
        const leverageAfterSecond = await dloopMock.getCurrentLeverageBps();
        expect(leverageAfterSecond).to.be.lte(leverageAfterFirst);
      }
    });
  });

  describe("III. Rebalance with Subsidies", function () {
    it("Should provide subsidy when increasing leverage far from target", async function () {
      const user = accounts[1];

      // Set initial prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create large imbalance (very low leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.8", 8),
      );

      const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterPriceChange).to.be.lt(TARGET_LEVERAGE_BPS);

      // Get current subsidy
      const subsidyBps = await dloopMock.getCurrentSubsidyBps();
      expect(subsidyBps).to.be.gt(0);
      expect(subsidyBps).to.be.lte(MAX_SUBSIDY_BPS);

      // Get balances before
      const userDebtBefore = await debtToken.balanceOf(user.address);

      // Increase leverage
      const collateralToSupply = ethers.parseEther("15");
      await dloopMock.connect(user).increaseLeverage(collateralToSupply, 0);

      // Verify user received more debt than collateral supplied (due to subsidy)
      const userDebtAfter = await debtToken.balanceOf(user.address);
      const debtReceived = userDebtAfter - userDebtBefore;

      // Should receive at least the collateral amount plus some subsidy
      expect(debtReceived).to.be.gt(collateralToSupply);
    });

    it("Should provide subsidy when decreasing leverage far from target", async function () {
      const user = accounts[1];

      // Set initial prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create moderate imbalance (high leverage but not extreme)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.85", 8),
      );

      const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterPriceChange).to.be.gt(TARGET_LEVERAGE_BPS);

      // Get current subsidy
      const subsidyBps = await dloopMock.getCurrentSubsidyBps();
      expect(subsidyBps).to.be.gt(0);
      expect(subsidyBps).to.be.lte(MAX_SUBSIDY_BPS);

      // Get balances before
      const userCollateralBefore = await collateralToken.balanceOf(
        user.address,
      );

      // Decrease leverage
      const debtToRepay = ethers.parseEther("10");
      await dloopMock.connect(user).decreaseLeverage(debtToRepay, 0);

      // Verify user received more collateral than debt repaid (due to subsidy)
      const userCollateralAfter = await collateralToken.balanceOf(user.address);
      const collateralReceived = userCollateralAfter - userCollateralBefore;

      // Should receive at least the debt amount plus some subsidy
      expect(collateralReceived).to.be.gt(debtToRepay);
    });

    it("Should cap subsidy at maximum subsidy rate", async function () {
      const user = accounts[1];

      // Set initial prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create extreme imbalance
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("3", 8),
      );

      // Get current subsidy - should be capped at max
      const subsidyBps = await dloopMock.getCurrentSubsidyBps();
      expect(subsidyBps).to.equal(MAX_SUBSIDY_BPS);
    });
  });

  describe("IV. Error Cases", function () {
    it("Should revert when trying to increase leverage above target", async function () {
      const user = accounts[1];

      // Set up vault at target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create a slight imbalance that puts leverage above target
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.98", 8),
      );

      // Verify leverage is now above target
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.be.gt(TARGET_LEVERAGE_BPS);

      // Try to increase leverage when already above target - should revert with LeverageExceedsTarget
      await expect(
        dloopMock.connect(user).increaseLeverage(ethers.parseEther("10"), 0),
      ).to.be.revertedWithCustomError(dloopMock, "LeverageExceedsTarget");
    });

    it("Should revert when trying to decrease leverage below target", async function () {
      const user = accounts[1];

      // Set up vault at target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Verify at target leverage
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000);

      // Try to decrease leverage when already at target
      await expect(
        dloopMock.connect(user).decreaseLeverage(ethers.parseEther("10"), 0),
      ).to.be.revertedWithCustomError(dloopMock, "LeverageBelowTarget");
    });

    it("Should revert when increase leverage amount is too large", async function () {
      const user = accounts[1];

      // Set up vault below target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create imbalance (low leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.5", 8),
      );

      // Try to supply too much collateral (would exceed target leverage)
      await expect(
        dloopMock.connect(user).increaseLeverage(ethers.parseEther("500"), 0),
      ).to.be.revertedWithCustomError(dloopMock, "IncreaseLeverageOutOfRange");
    });

    it("Should revert when decrease leverage amount is too large", async function () {
      const user = accounts[1];

      // Set up vault above target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create very mild imbalance (high leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.95", 8),
      );

      // Try to repay too much debt (would go below target leverage) - use much smaller amount
      await expect(
        dloopMock.connect(user).decreaseLeverage(ethers.parseEther("20"), 0),
      ).to.be.revertedWithCustomError(dloopMock, "DecreaseLeverageOutOfRange");
    });

    it("Should revert when slippage protection fails on increase leverage", async function () {
      const user = accounts[1];

      // Set up vault below target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create imbalance (low leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.3", 8),
      );

      // Try to increase leverage but set minimum received too high
      await expect(
        dloopMock.connect(user).increaseLeverage(
          ethers.parseEther("10"),
          ethers.parseEther("1000"), // Unreasonably high minimum
        ),
      ).to.be.revertedWithCustomError(
        dloopMock,
        "RebalanceReceiveLessThanMinAmount",
      );
    });

    it("Should revert when slippage protection fails on decrease leverage", async function () {
      const user = accounts[1];

      // Set up vault above target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create imbalance (high leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.9", 8),
      );

      // Try to decrease leverage but set minimum received too high
      await expect(
        dloopMock.connect(user).decreaseLeverage(
          ethers.parseEther("10"),
          ethers.parseEther("1000"), // Unreasonably high minimum
        ),
      ).to.be.revertedWithCustomError(
        dloopMock,
        "RebalanceReceiveLessThanMinAmount",
      );
    });
  });

  describe("V. Multiple Users Rebalancing", function () {
    it("Should handle multiple users increasing leverage independently", async function () {
      const user1 = accounts[1];
      const user2 = accounts[2];

      // Set up initial state
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );

      // Both users make deposits
      await dloopMock
        .connect(user1)
        .deposit(ethers.parseEther("100"), user1.address);
      await dloopMock
        .connect(user2)
        .deposit(ethers.parseEther("50"), user2.address);

      // Create imbalance (low leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.3", 8),
      );

      const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterPriceChange).to.be.lt(TARGET_LEVERAGE_BPS);

      // Both users increase leverage
      const user1DebtBefore = await debtToken.balanceOf(user1.address);
      const user2DebtBefore = await debtToken.balanceOf(user2.address);

      await dloopMock
        .connect(user1)
        .increaseLeverage(ethers.parseEther("10"), 0);
      await dloopMock
        .connect(user2)
        .increaseLeverage(ethers.parseEther("5"), 0);

      // Verify both users received debt tokens
      const user1DebtAfter = await debtToken.balanceOf(user1.address);
      const user2DebtAfter = await debtToken.balanceOf(user2.address);

      expect(user1DebtAfter).to.be.gt(user1DebtBefore);
      expect(user2DebtAfter).to.be.gt(user2DebtBefore);

      // Verify leverage moved towards target
      const finalLeverage = await dloopMock.getCurrentLeverageBps();
      expect(finalLeverage).to.be.gt(leverageAfterPriceChange);
      expect(finalLeverage).to.be.lte(TARGET_LEVERAGE_BPS);
    });

    it("Should handle multiple users decreasing leverage independently", async function () {
      const user1 = accounts[1];
      const user2 = accounts[2];

      // Set up initial state
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );

      // Both users make deposits
      await dloopMock
        .connect(user1)
        .deposit(ethers.parseEther("100"), user1.address);
      await dloopMock
        .connect(user2)
        .deposit(ethers.parseEther("50"), user2.address);

      // Create imbalance (high leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.9", 8),
      );

      const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterPriceChange).to.be.gt(TARGET_LEVERAGE_BPS);

      // Both users decrease leverage
      const user1CollateralBefore = await collateralToken.balanceOf(
        user1.address,
      );
      const user2CollateralBefore = await collateralToken.balanceOf(
        user2.address,
      );

      await dloopMock
        .connect(user1)
        .decreaseLeverage(ethers.parseEther("5"), 0);
      await dloopMock
        .connect(user2)
        .decreaseLeverage(ethers.parseEther("3"), 0);

      // Verify both users received collateral tokens
      const user1CollateralAfter = await collateralToken.balanceOf(
        user1.address,
      );
      const user2CollateralAfter = await collateralToken.balanceOf(
        user2.address,
      );

      expect(user1CollateralAfter).to.be.gt(user1CollateralBefore);
      expect(user2CollateralAfter).to.be.gt(user2CollateralBefore);

      // Verify leverage moved towards target
      const finalLeverage = await dloopMock.getCurrentLeverageBps();
      expect(finalLeverage).to.be.lt(leverageAfterPriceChange);
      expect(finalLeverage).to.be.gte(TARGET_LEVERAGE_BPS);
    });
  });

  describe("VI. Rebalance with Vault Token Balance", function () {
    it("Should use vault collateral balance for increase leverage when available", async function () {
      const user = accounts[1];

      // Set up vault below target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Add a substantial amount of collateral directly to vault to ensure adequate balance
      await collateralToken.mint(
        await dloopMock.getAddress(),
        ethers.parseEther("50"),
      );

      // Create moderate imbalance (low leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );

      // Get quote with vault balance consideration
      const [tokenAmountWithVault] =
        await dloopMock.getAmountToReachTargetLeverage(true);
      const [tokenAmountWithoutVault] =
        await dloopMock.getAmountToReachTargetLeverage(false);

      // Should require less additional collateral when using vault balance
      expect(tokenAmountWithVault).to.be.lte(tokenAmountWithoutVault);

      // Perform increase leverage with 0 additional (using only vault balance)
      const userDebtBefore = await debtToken.balanceOf(user.address);
      await dloopMock.connect(user).increaseLeverage(0, 0);

      // Verify user received debt tokens despite providing no additional collateral
      const userDebtAfter = await debtToken.balanceOf(user.address);
      expect(userDebtAfter).to.be.gt(userDebtBefore);
    });

    it("Should use vault debt balance for decrease leverage when available", async function () {
      const user = accounts[1];

      // Set up vault above target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Add a substantial amount of debt directly to vault to ensure adequate balance
      await debtToken.mint(
        await dloopMock.getAddress(),
        ethers.parseEther("30"),
      );

      // Create moderate imbalance (high leverage)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.95", 8),
      );

      // Get quote with vault balance consideration
      const [tokenAmountWithVault] =
        await dloopMock.getAmountToReachTargetLeverage(true);
      const [tokenAmountWithoutVault] =
        await dloopMock.getAmountToReachTargetLeverage(false);

      // Should require less additional debt when using vault balance
      expect(tokenAmountWithVault).to.be.lte(tokenAmountWithoutVault);

      // Perform decrease leverage with 0 additional (using only vault balance)
      const userCollateralBefore = await collateralToken.balanceOf(
        user.address,
      );
      await dloopMock.connect(user).decreaseLeverage(0, 0);

      // Verify user received collateral tokens despite providing no additional debt
      const userCollateralAfter = await collateralToken.balanceOf(user.address);
      expect(userCollateralAfter).to.be.gt(userCollateralBefore);
    });
  });

  describe("VII. Integration with Deposit/Withdraw", function () {
    it("Should prevent deposits when leverage is too imbalanced", async function () {
      const user = accounts[1];

      // Set up vault and create moderate imbalance
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create imbalance that exceeds upper bound (leverage too high)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.7", 8), // Significant price drop to exceed upper bound
      );

      // Verify vault is imbalanced and leverage exceeds upper bound
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.be.gt(UPPER_BOUND_BPS);
      expect(await dloopMock.isTooImbalanced()).to.be.true;
      expect(await dloopMock.maxDeposit(user.address)).to.equal(0);

      // Attempt deposit should fail due to imbalance
      await expect(
        dloopMock.connect(user).deposit(ethers.parseEther("10"), user.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxDeposit");
    });

    it("Should maintain proper leverage bounds after rebalancing", async function () {
      const user = accounts[1];

      // Set up initial state
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1", 8),
      );
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Create multiple moderate imbalances and rebalance
      const scenarios = [
        {
          collateralPrice: ethers.parseUnits("1.15", 8), // Low leverage
          operation: "increase",
          amount: ethers.parseEther("5"),
        },
        {
          collateralPrice: ethers.parseUnits("0.95", 8), // High leverage
          operation: "decrease",
          amount: ethers.parseEther("4"),
        },
        {
          collateralPrice: ethers.parseUnits("1.1", 8), // Low leverage again
          operation: "increase",
          amount: ethers.parseEther("3"),
        },
      ];

      for (const scenario of scenarios) {
        // Create imbalance
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          scenario.collateralPrice,
        );

        const leverageBefore = await dloopMock.getCurrentLeverageBps();

        // Perform rebalancing operation
        if (scenario.operation === "increase") {
          if (leverageBefore < TARGET_LEVERAGE_BPS) {
            await dloopMock.connect(user).increaseLeverage(scenario.amount, 0);
          }
        } else {
          if (leverageBefore > TARGET_LEVERAGE_BPS) {
            await dloopMock.connect(user).decreaseLeverage(scenario.amount, 0);
          }
        }

        // Verify leverage is within bounds
        const leverageAfter = await dloopMock.getCurrentLeverageBps();
        expect(leverageAfter).to.be.gte(LOWER_BOUND_BPS);
        expect(leverageAfter).to.be.lte(UPPER_BOUND_BPS);
      }
    });
  });
});
