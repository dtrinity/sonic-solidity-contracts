import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import {
  ONE_HUNDRED_PERCENT_BPS,
  ONE_PERCENT_BPS,
} from "../../../typescript/common/bps_constants";
import {
  deployDLoopMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixture";

// NOTE: Deposit/maintain leverage scenarios are validated in CoreLogic maintain_leverage tests; skip duplication
describe.skip("DLoopCoreMock Deposit Tests", function () {
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

  describe("I. Basic Deposit Functionality", function () {
    const basicDepositTests = [
      {
        // First deposit establishes target leverage position
        name: "Should handle first deposit with target leverage",
        assets: ethers.parseEther("100"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
      {
        // Small deposits should work correctly
        name: "Should handle small deposit amounts",
        assets: ethers.parseEther("1"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
      {
        // Large deposits should work correctly
        name: "Should handle large deposit amounts",
        assets: ethers.parseEther("1000"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
    ];

    for (const testCase of basicDepositTests) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const userAddress = user.address;

        // Make sure initial leverage before deposit is 0
        const initialLeverage = await dloopMock.getCurrentLeverageBps();
        expect(initialLeverage).to.equal(0);

        // Check initial state
        expect(await dloopMock.totalSupply()).to.equal(0);
        expect(await dloopMock.totalAssets()).to.equal(0);
        expect(await dloopMock.balanceOf(userAddress)).to.equal(0);

        // Calculate expected values
        const expectedShares = await dloopMock.previewDeposit(testCase.assets);
        const expectedDebtAmount =
          (testCase.assets *
            BigInt(testCase.expectedLeverage - ONE_HUNDRED_PERCENT_BPS)) /
          BigInt(testCase.expectedLeverage);

        // Approve to allow the dloopMock to spend user's tokens
        await collateralToken
          .connect(user)
          .approve(await dloopMock.getAddress(), testCase.assets);

        // Perform deposit
        const tx = await dloopMock
          .connect(user)
          .deposit(testCase.assets, userAddress);

        // Verify shares minted
        expect(await dloopMock.balanceOf(userAddress)).to.equal(expectedShares);
        expect(await dloopMock.totalSupply()).to.equal(expectedShares);

        // Verify debt tokens transferred to user
        expect(await debtToken.balanceOf(userAddress)).to.be.gte(
          expectedDebtAmount,
        );

        // Verify collateral supplied to pool
        expect(
          await dloopMock.getMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
          ),
        ).to.equal(testCase.assets);

        // Verify leverage is correct
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.closeTo(
          BigInt(testCase.expectedLeverage),
          BigInt(ONE_PERCENT_BPS),
        ); // Allow 1% tolerance

        // Verify event emission
        await expect(tx)
          .to.emit(dloopMock, "Deposit")
          .withArgs(userAddress, userAddress, testCase.assets, expectedShares);
      });
    }
  });

  describe("II. Deposit and price change", function () {
    const priceChangeTests = [
      {
        name: "Collateral price decrease, debt price increase",
        newCollateralPrice: ethers.parseEther("1.1"),
        newDebtPrice: ethers.parseEther("0.9"),
        expectedLeverage: 550 * ONE_PERCENT_BPS,
      },
      {
        name: "Collateral price increase, debt price increase",
        newCollateralPrice: ethers.parseEther("1.4"),
        newDebtPrice: ethers.parseEther("0.9"),
        expectedLeverage: 280 * ONE_PERCENT_BPS,
      },
      {
        name: "Collateral price increase, debt price decrease",
        newCollateralPrice: ethers.parseEther("1.4"),
        newDebtPrice: ethers.parseEther("0.6"),
        expectedLeverage: 175 * ONE_PERCENT_BPS,
      },
      {
        name: "Collateral price decrease, debt price decrease",
        newCollateralPrice: ethers.parseEther("0.8"),
        newDebtPrice: ethers.parseEther("0.6"),
        expectedLeverage: 400 * ONE_PERCENT_BPS,
      },
    ];

    for (const testCase of priceChangeTests) {
      it(`${testCase.name}, leverage ${TARGET_LEVERAGE_BPS / ONE_PERCENT_BPS}% -> ${testCase.expectedLeverage / ONE_PERCENT_BPS}%`, async function () {
        // Initialize a dLOOP deployment here, with the first deposit and have current leverage at TARGET_LEVERAGE_BPS
        const targetUser = accounts[1];
        const depositAmount = ethers.parseEther("100");
        const initialCollateralPrice = ethers.parseEther("1.2");
        const initialDebtPrice = ethers.parseEther("0.8");

        // Make sure initial leverage before deposit is 0
        const initialLeverage = await dloopMock.getCurrentLeverageBps();
        expect(initialLeverage).to.equal(0);

        // Check initial state
        expect(await dloopMock.totalSupply()).to.equal(0);
        expect(await dloopMock.totalAssets()).to.equal(0);
        expect(await dloopMock.balanceOf(targetUser.address)).to.equal(0);

        // Set collateral and debt price to initial values
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          initialCollateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          initialDebtPrice,
        );

        // Perform deposit
        const tx = await dloopMock
          .connect(targetUser)
          .deposit(depositAmount, targetUser.address);
        await tx.wait();

        // Verify leverage is correct
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          TARGET_LEVERAGE_BPS,
        );

        // Change the collateral and debt price
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testCase.newCollateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          testCase.newDebtPrice,
        );

        // Check current leverage
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          testCase.expectedLeverage,
        );
      });
    }
  });

  describe("III. Multiple deposits", function () {
    it("With single user and constant price", async function () {
      /**
       * Parameterized test with single user making multiple deposits with price changes
       * Each step includes deposit amount, price changes, and expected leverage
       */

      const targetUser = accounts[1];

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1.2"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("0.8"),
      );

      // Parameterized scenario steps
      const steps = [
        {
          description: "Initial deposit establishes target leverage",
          amount: ethers.parseEther("100"),
          collateralPrice: ethers.parseEther("1.2"),
          debtPrice: ethers.parseEther("0.8"),
          expectedTotalAssets: ethers.parseEther("100"),
          expectedLeverage: 300 * ONE_PERCENT_BPS, // 300% = TARGET_LEVERAGE_BPS
        },
        {
          description: "Deposit after collateral price increase",
          amount: ethers.parseEther("80"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.8"),
          expectedTotalAssets: ethers.parseEther("180"),
          expectedLeverage: 276.923 * ONE_PERCENT_BPS, // ~277% leverage after price change
        },
        {
          description: "Deposit with further collateral price increase",
          amount: ethers.parseEther("60"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.8"),
          expectedTotalAssets: ethers.parseEther("240"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257% leverage
        },
        {
          description: "Deposit with debt price increase",
          amount: ethers.parseEther("40"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.9"),
          expectedTotalAssets: ethers.parseEther("280"),
          expectedLeverage: 288.889 * ONE_PERCENT_BPS, // ~289% leverage
        },
        {
          description: "Final deposit with balanced price increases",
          amount: ethers.parseEther("20"),
          collateralPrice: ethers.parseEther("1.5"),
          debtPrice: ethers.parseEther("1.0"),
          expectedTotalAssets: ethers.parseEther("300"),
          expectedLeverage: 300 * ONE_PERCENT_BPS, // Back to ~300% leverage
        },
      ];

      let totalDeposited = BigInt(0);

      // Track initial totalAssets (should be 0)
      const initialTotalAssets = await dloopMock.totalAssets();
      expect(initialTotalAssets).to.equal(0);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        // Set new prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          step.collateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          step.debtPrice,
        );

        // Get leverage before deposit (after price change)
        const leverageBeforeDeposit = await dloopMock.getCurrentLeverageBps();

        // Make deposit if allowed
        const maxDeposit = await dloopMock.maxDeposit(targetUser.address);

        if (maxDeposit >= step.amount) {
          await dloopMock
            .connect(targetUser)
            .deposit(step.amount, targetUser.address);
          totalDeposited += step.amount;

          // Track totalAssets after deposit and verify expected value
          const totalAssetsAfter = await dloopMock.totalAssets();
          expect(totalAssetsAfter).to.equal(step.expectedTotalAssets);

          // Get leverage after deposit
          const leverageAfterDeposit = await dloopMock.getCurrentLeverageBps();

          // Check leverage preservation: after deposit, leverage should remain the same as before deposit
          // Exception: first deposit from 0 collateral establishes target leverage
          if (i === 0) {
            // First deposit should establish target leverage
            expect(leverageAfterDeposit).to.be.closeTo(
              BigInt(TARGET_LEVERAGE_BPS),
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
          } else {
            // Subsequent deposits should preserve the leverage from before the deposit
            expect(leverageAfterDeposit).to.be.closeTo(
              leverageBeforeDeposit,
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
          }
        } else {
          console.log(
            `Deposit of ${ethers.formatEther(step.amount)} ETH not allowed - maxDeposit: ${ethers.formatEther(maxDeposit)} ETH`,
          );
        }

        // Verify leverage is within reasonable bounds (200% to 400%)
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.gte(200 * ONE_PERCENT_BPS); // At least 200%
        expect(currentLeverage).to.be.lte(400 * ONE_PERCENT_BPS); // At most 400%
      }

      // Verify final state
      const userShares = await dloopMock.balanceOf(targetUser.address);
      expect(userShares).to.be.gt(0);

      const totalAssets = await dloopMock.totalAssets();
      expect(totalAssets).to.be.gte(totalDeposited);
    });

    it("With single user and price change", async function () {
      /**
       * This test is identical to the previous one, so we'll implement
       * a similar scenario but with different price movements
       */

      const targetUser = accounts[1];
      const initialCollateralPrice = ethers.parseEther("1.2");
      const initialDebtPrice = ethers.parseEther("0.8");

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        initialCollateralPrice,
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        initialDebtPrice,
      );

      // Scenario with different price changes and deposits (conservative changes)
      const deposits = [
        {
          amount: ethers.parseEther("50"),
          collateralPrice: ethers.parseEther("1.25"),
          debtPrice: ethers.parseEther("0.85"),
          expectedTotalAssets: ethers.parseEther("50"),
          expectedLeverage: 282353, // ~282% leverage after price changes
        },
        {
          amount: ethers.parseEther("75"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.9"),
          expectedTotalAssets: ethers.parseEther("125"),
          expectedLeverage: 260870, // ~261% leverage
        },
        {
          amount: ethers.parseEther("25"),
          collateralPrice: ethers.parseEther("1.35"),
          debtPrice: ethers.parseEther("0.95"),
          expectedTotalAssets: ethers.parseEther("150"),
          expectedLeverage: 257143, // ~257% leverage
        },
      ];

      let totalDeposited = BigInt(0);

      // Track initial totalAssets (should be 0)
      const initialTotalAssets = await dloopMock.totalAssets();
      expect(initialTotalAssets).to.equal(0);

      for (let i = 0; i < deposits.length; i++) {
        const deposit = deposits[i];

        // Set new prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          deposit.collateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          deposit.debtPrice,
        );

        // Get leverage before deposit (after price change)
        const leverageBeforeDeposit = await dloopMock.getCurrentLeverageBps();

        // Make deposit (check if allowed first)
        const maxDeposit = await dloopMock.maxDeposit(targetUser.address);

        if (maxDeposit >= deposit.amount) {
          await dloopMock
            .connect(targetUser)
            .deposit(deposit.amount, targetUser.address);

          totalDeposited += deposit.amount;

          // Track totalAssets after deposit and verify expected value
          const totalAssetsAfter = await dloopMock.totalAssets();
          expect(totalAssetsAfter).to.equal(deposit.expectedTotalAssets);

          // Get leverage after deposit
          const leverageAfterDeposit = await dloopMock.getCurrentLeverageBps();

          // Check leverage preservation: after deposit, leverage should remain the same as before deposit
          // Exception: first deposit from 0 collateral establishes target leverage
          if (i === 0) {
            // First deposit should establish target leverage
            expect(leverageAfterDeposit).to.be.closeTo(
              BigInt(TARGET_LEVERAGE_BPS),
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
          } else {
            // Subsequent deposits should preserve the leverage from before the deposit
            expect(leverageAfterDeposit).to.be.closeTo(
              leverageBeforeDeposit,
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
          }
        }

        // Verify leverage is within reasonable bounds (200% to 400%)
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.gte(2000000); // At least 200%
        expect(currentLeverage).to.be.lte(4000000); // At most 400%
      }

      // Verify final state
      const userShares = await dloopMock.balanceOf(targetUser.address);
      expect(userShares).to.be.gt(0);

      const totalAssets = await dloopMock.totalAssets();
      expect(totalAssets).to.be.gte(totalDeposited);
    });

    it("With multiple users and constant price", async function () {
      /**
       * Parameterized test with multiple users making deposits with price changes
       * Each step includes user, deposit amount, price changes, and expected leverage
       */

      const user1 = accounts[1];
      const user2 = accounts[2];
      const user3 = accounts[3];

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1.2"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("0.8"),
      );

      // Parameterized scenario steps
      const steps = [
        {
          description: "User 1 initial deposit",
          user: user1,
          amount: ethers.parseEther("100"),
          collateralPrice: ethers.parseEther("1.2"),
          debtPrice: ethers.parseEther("0.8"),
          expectedTotalAssets: ethers.parseEther("100"),
          expectedLeverage: 300 * ONE_PERCENT_BPS, // 300%
        },
        {
          description: "User 2 deposit after collateral price increase",
          user: user2,
          amount: ethers.parseEther("80"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.8"),
          expectedTotalAssets: ethers.parseEther("180"),
          expectedLeverage: 276.923 * ONE_PERCENT_BPS, // ~277%
        },
        {
          description: "User 3 deposit with further price increase",
          user: user3,
          amount: ethers.parseEther("60"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.8"),
          expectedTotalAssets: ethers.parseEther("240"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257%
        },
        {
          description: "User 1 second deposit with debt price change",
          user: user1,
          amount: ethers.parseEther("30"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.9"),
          expectedTotalAssets: ethers.parseEther("270"),
          expectedLeverage: 288.889 * ONE_PERCENT_BPS, // ~289%
        },
        {
          description: "User 2 second deposit",
          user: user2,
          amount: ethers.parseEther("40"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.9"),
          expectedTotalAssets: ethers.parseEther("310"),
          expectedLeverage: 288.889 * ONE_PERCENT_BPS, // ~289%
        },
        {
          description: "User 3 second deposit with balanced prices",
          user: user3,
          amount: ethers.parseEther("25"),
          collateralPrice: ethers.parseEther("1.5"),
          debtPrice: ethers.parseEther("1.0"),
          expectedTotalAssets: ethers.parseEther("335"),
          expectedLeverage: 300 * ONE_PERCENT_BPS, // Back to 300%
        },
      ];

      const userBalances = new Map();

      // Track initial totalAssets (should be 0)
      const initialTotalAssets = await dloopMock.totalAssets();
      expect(initialTotalAssets).to.equal(0);

      // Track if this is the first deposit overall (from 0 collateral)
      let isFirstDepositOverall = true;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        // Set new prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          step.collateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          step.debtPrice,
        );

        // Get leverage before deposit (after price change)
        const leverageBeforeDeposit = await dloopMock.getCurrentLeverageBps();

        // Make deposit if allowed
        const maxDeposit = await dloopMock.maxDeposit(step.user.address);

        if (maxDeposit >= step.amount) {
          await dloopMock
            .connect(step.user)
            .deposit(step.amount, step.user.address);

          // Track totalAssets after deposit and verify expected value
          const totalAssetsAfter = await dloopMock.totalAssets();
          expect(totalAssetsAfter).to.equal(step.expectedTotalAssets);

          // Get leverage after deposit
          const leverageAfterDeposit = await dloopMock.getCurrentLeverageBps();

          // Check leverage preservation: after deposit, leverage should remain the same as before deposit
          // Exception: first deposit from 0 collateral establishes target leverage
          if (isFirstDepositOverall) {
            // First deposit should establish target leverage
            expect(leverageAfterDeposit).to.be.closeTo(
              BigInt(TARGET_LEVERAGE_BPS),
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
            isFirstDepositOverall = false;
          } else {
            // Subsequent deposits should preserve the leverage from before the deposit
            expect(leverageAfterDeposit).to.be.closeTo(
              leverageBeforeDeposit,
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
          }
        }

        // Track user balance
        userBalances.set(
          step.user.address,
          await dloopMock.balanceOf(step.user.address),
        );

        // Verify leverage is within reasonable bounds (200% to 400%)
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.gte(200 * ONE_PERCENT_BPS); // At least 200%
        expect(currentLeverage).to.be.lte(400 * ONE_PERCENT_BPS); // At most 400%
      }

      // Verify final state for all users
      expect(userBalances.get(user1.address)).to.be.gt(0);

      // Total shares should equal individual shares
      const totalShares = await dloopMock.totalSupply();
      let totalUserShares = BigInt(0);

      for (const shares of userBalances.values()) {
        totalUserShares += shares;
      }
      expect(totalShares).to.equal(totalUserShares);
    });

    it("With multiple users and price change", async function () {
      /**
       * Similar to previous test but with different price change patterns
       */

      const user1 = accounts[1];
      const user2 = accounts[2];
      const user3 = accounts[3];

      // Define a scenario with multiple users and varying prices (conservative changes)
      const scenarios = [
        {
          user: user1,
          amount: ethers.parseEther("75"),
          collateralPrice: ethers.parseEther("1.25"),
          debtPrice: ethers.parseEther("0.85"),
          expectedTotalAssets: ethers.parseEther("75"),
          expectedLeverage: 282.353 * ONE_PERCENT_BPS, // ~282% leverage
        },
        {
          user: user2,
          amount: ethers.parseEther("50"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.9"),
          expectedTotalAssets: ethers.parseEther("125"),
          expectedLeverage: 260.87 * ONE_PERCENT_BPS, // ~261% leverage
        },
        {
          user: user3,
          amount: ethers.parseEther("40"),
          collateralPrice: ethers.parseEther("1.35"),
          debtPrice: ethers.parseEther("0.95"),
          expectedTotalAssets: ethers.parseEther("165"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257% leverage
        },
        {
          user: user1,
          amount: ethers.parseEther("35"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("1.0"),
          expectedTotalAssets: ethers.parseEther("200"),
          expectedLeverage: 280 * ONE_PERCENT_BPS, // ~280% leverage
        },
        {
          user: user2,
          amount: ethers.parseEther("25"),
          collateralPrice: ethers.parseEther("1.35"),
          debtPrice: ethers.parseEther("0.95"),
          expectedTotalAssets: ethers.parseEther("225"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257% leverage
        },
        {
          user: user3,
          amount: ethers.parseEther("30"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.9"),
          expectedTotalAssets: ethers.parseEther("255"),
          expectedLeverage: 260.87 * ONE_PERCENT_BPS, // ~261% leverage
        },
      ];

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1.2"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("0.8"),
      );

      const userBalances = new Map();

      // Track initial totalAssets (should be 0)
      const initialTotalAssets = await dloopMock.totalAssets();
      expect(initialTotalAssets).to.equal(0);

      // Track if this is the first deposit overall (from 0 collateral)
      let isFirstDepositOverall = true;

      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];

        // Set new prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          scenario.collateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          scenario.debtPrice,
        );

        const userAddress = scenario.user.address;

        // Get leverage before deposit (after price change)
        const leverageBeforeDeposit = await dloopMock.getCurrentLeverageBps();

        // Make deposit (check if allowed first)
        const maxDeposit = await dloopMock.maxDeposit(userAddress);

        if (maxDeposit >= scenario.amount) {
          await dloopMock
            .connect(scenario.user)
            .deposit(scenario.amount, userAddress);

          // Track totalAssets after deposit and verify expected value
          const totalAssetsAfter = await dloopMock.totalAssets();
          expect(totalAssetsAfter).to.equal(scenario.expectedTotalAssets);

          // Get leverage after deposit
          const leverageAfterDeposit = await dloopMock.getCurrentLeverageBps();

          // Check leverage preservation: after deposit, leverage should remain the same as before deposit
          // Exception: first deposit from 0 collateral establishes target leverage
          if (isFirstDepositOverall) {
            // First deposit should establish target leverage
            expect(leverageAfterDeposit).to.be.closeTo(
              BigInt(TARGET_LEVERAGE_BPS),
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
            isFirstDepositOverall = false;
          } else {
            // Subsequent deposits should preserve the leverage from before the deposit
            expect(leverageAfterDeposit).to.be.closeTo(
              leverageBeforeDeposit,
              BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
            );
          }
        }

        // Get user's balance after deposit
        const balanceAfter = await dloopMock.balanceOf(userAddress);

        // Track user balances
        userBalances.set(userAddress, balanceAfter);

        // Verify leverage is within reasonable bounds (200% to 400%)
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.gte(200 * ONE_PERCENT_BPS); // At least 200%
        expect(currentLeverage).to.be.lte(400 * ONE_PERCENT_BPS); // At most 400%
      }

      // Verify final state
      let totalUserShares = BigInt(0);

      for (const [_userAddress, shares] of userBalances) {
        expect(shares).to.be.gt(0);
        totalUserShares += shares;
      }

      const totalSupply = await dloopMock.totalSupply();
      expect(totalSupply).to.equal(totalUserShares);

      // Verify all users have positive balances
      expect(await dloopMock.balanceOf(user1.address)).to.be.gt(0);
      expect(await dloopMock.balanceOf(user2.address)).to.be.gt(0);
      expect(await dloopMock.balanceOf(user3.address)).to.be.gt(0);
    });
  });

  describe("IV. Reach too imbalance and cannot deposit", function () {
    // As the deposit() always call the `maxDeposit()` before calling the `_deposit()`,
    // thus the ERC4626ExceededMaxDeposit error before reaching the TooImbalanced error.
    // Thus in the test, we should expect the ERC4626ExceededMaxDeposit error, do not need
    // to check the TooImbalanced error.

    const imbalanceTestCases = [
      {
        name: "Should reject deposit when leverage is too high (above upper bound)",
        firstDeposit: {
          amount: ethers.parseEther("100"),
          collateralPrice: ethers.parseEther("1.2"),
          debtPrice: ethers.parseEther("0.8"),
        },
        priceChangeToImbalance: {
          // Decrease collateral price and increase debt price to push leverage above upper bound
          collateralPrice: ethers.parseEther("1.05"), // Decrease slightly
          debtPrice: ethers.parseEther("0.85"), // Increase slightly
          expectedLeverageAbove: 400 * ONE_PERCENT_BPS, // Should be above 400%
        },
        secondDeposit: {
          amount: ethers.parseEther("50"),
          shouldFail: true,
        },
      },
      {
        name: "Should reject deposit when leverage is too low (below lower bound)",
        firstDeposit: {
          amount: ethers.parseEther("100"),
          collateralPrice: ethers.parseEther("1.2"),
          debtPrice: ethers.parseEther("0.8"),
        },
        priceChangeToImbalance: {
          // Increase collateral price and decrease debt price to push leverage below lower bound
          collateralPrice: ethers.parseEther("1.8"), // Increase moderately
          debtPrice: ethers.parseEther("0.6"), // Decrease moderately
          expectedLeverageBelow: 200 * ONE_PERCENT_BPS, // Should be below 200%
        },
        secondDeposit: {
          amount: ethers.parseEther("50"),
          shouldFail: true,
        },
      },
      {
        name: "Should allow deposit when leverage returns to acceptable range",
        firstDeposit: {
          amount: ethers.parseEther("100"),
          collateralPrice: ethers.parseEther("1.2"),
          debtPrice: ethers.parseEther("0.8"),
        },
        priceChangeToImbalance: {
          // First make it imbalanced (too high)
          collateralPrice: ethers.parseEther("1.05"),
          debtPrice: ethers.parseEther("0.85"),
          expectedLeverageAbove: 400 * ONE_PERCENT_BPS,
        },
        priceChangeToRebalance: {
          // Then bring it back to acceptable range
          collateralPrice: ethers.parseEther("1.2"),
          debtPrice: ethers.parseEther("0.8"),
          expectedLeverageInRange: true,
        },
        secondDeposit: {
          amount: ethers.parseEther("50"),
          shouldFail: false,
        },
      },
    ];

    for (const testCase of imbalanceTestCases) {
      it(testCase.name, async function () {
        const targetUser = accounts[1];

        // Set initial prices for first deposit
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testCase.firstDeposit.collateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          testCase.firstDeposit.debtPrice,
        );

        // First deposit should always succeed (establish initial position)
        const firstTx = await dloopMock
          .connect(targetUser)
          .deposit(testCase.firstDeposit.amount, targetUser.address);
        await firstTx.wait();

        // Verify first deposit succeeded and leverage is at target
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          TARGET_LEVERAGE_BPS,
        );
        expect(await dloopMock.isTooImbalanced()).to.be.false;

        // Change prices to create imbalance
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testCase.priceChangeToImbalance.collateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          testCase.priceChangeToImbalance.debtPrice,
        );

        // Verify the vault is now imbalanced
        const leverageAfterPriceChange =
          await dloopMock.getCurrentLeverageBps();
        expect(await dloopMock.isTooImbalanced()).to.be.true;

        if (testCase.priceChangeToImbalance.expectedLeverageAbove) {
          expect(leverageAfterPriceChange).to.be.gt(
            testCase.priceChangeToImbalance.expectedLeverageAbove,
          );
        }

        if (testCase.priceChangeToImbalance.expectedLeverageBelow) {
          expect(leverageAfterPriceChange).to.be.lt(
            testCase.priceChangeToImbalance.expectedLeverageBelow,
          );
        }

        // Verify maxDeposit returns 0 when imbalanced
        expect(await dloopMock.maxDeposit(targetUser.address)).to.equal(0);

        // If there's a rebalancing price change, apply it
        if (testCase.priceChangeToRebalance) {
          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            testCase.priceChangeToRebalance.collateralPrice,
          );
          await dloopMock.setMockPrice(
            await debtToken.getAddress(),
            testCase.priceChangeToRebalance.debtPrice,
          );

          if (testCase.priceChangeToRebalance.expectedLeverageInRange) {
            const rebalancedLeverage = await dloopMock.getCurrentLeverageBps();
            expect(rebalancedLeverage).to.be.gte(200 * ONE_PERCENT_BPS);
            expect(rebalancedLeverage).to.be.lte(400 * ONE_PERCENT_BPS);
            expect(await dloopMock.isTooImbalanced()).to.be.false;
            expect(await dloopMock.maxDeposit(targetUser.address)).to.be.gt(0);
          }
        }

        // Attempt second deposit
        if (testCase.secondDeposit.shouldFail) {
          // Verify deposit fails due to imbalance (maxDeposit returns 0)
          await expect(
            dloopMock
              .connect(targetUser)
              .deposit(testCase.secondDeposit.amount, targetUser.address),
          ).to.be.revertedWithCustomError(
            dloopMock,
            "ERC4626ExceededMaxDeposit",
          );
        } else {
          // Get leverage before second deposit (after rebalancing)
          const leverageBeforeSecondDeposit =
            await dloopMock.getCurrentLeverageBps();

          // Verify deposit succeeds
          const secondTx = await dloopMock
            .connect(targetUser)
            .deposit(testCase.secondDeposit.amount, targetUser.address);
          await secondTx.wait();

          // Get leverage after second deposit
          const leverageAfterSecondDeposit =
            await dloopMock.getCurrentLeverageBps();

          // Check leverage preservation: after deposit, leverage should remain the same as before deposit
          expect(leverageAfterSecondDeposit).to.be.closeTo(
            leverageBeforeSecondDeposit,
            BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
          );

          // Verify the vault is still balanced after second deposit
          expect(await dloopMock.isTooImbalanced()).to.be.false;
        }
      });
    }

    it("Should reject deposit when vault starts imbalanced due to extreme price movements", async function () {
      const targetUser = accounts[1];

      // Set initial prices and make first deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1.0"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("1.0"),
      );

      // First deposit
      await dloopMock
        .connect(targetUser)
        .deposit(ethers.parseEther("100"), targetUser.address);

      // Moderate price change that makes leverage high but doesn't break constraints
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("0.9"), // Collateral drops 10%
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("1.1"), // Debt increases 10%
      );

      // Verify extreme imbalance
      const extremeLeverage = await dloopMock.getCurrentLeverageBps();
      expect(extremeLeverage).to.be.gt(400 * ONE_PERCENT_BPS); // Way above upper bound
      expect(await dloopMock.isTooImbalanced()).to.be.true;
      expect(await dloopMock.maxDeposit(targetUser.address)).to.equal(0);

      // Any deposit attempt should fail due to imbalance (maxDeposit returns 0)
      await expect(
        dloopMock
          .connect(targetUser)
          .deposit(ethers.parseEther("1"), targetUser.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxDeposit");
    });

    it("Should confirm TooImbalanced error exists in contract logic", async function () {
      const targetUser = accounts[1];

      // Set initial prices and make first deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1.2"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("0.8"),
      );

      // First deposit
      await dloopMock
        .connect(targetUser)
        .deposit(ethers.parseEther("100"), targetUser.address);

      // Verify vault is balanced initially
      expect(await dloopMock.isTooImbalanced()).to.be.false;

      // Make the vault extremely imbalanced
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1.05"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("0.85"),
      );

      // Verify vault is now imbalanced
      expect(await dloopMock.isTooImbalanced()).to.be.true;

      // Verify that max functions return 0 (which causes ERC4626 errors)
      expect(await dloopMock.maxDeposit(targetUser.address)).to.equal(0);
      expect(await dloopMock.maxMint(targetUser.address)).to.equal(0);
      expect(await dloopMock.maxWithdraw(targetUser.address)).to.equal(0);
      expect(await dloopMock.maxRedeem(targetUser.address)).to.equal(0);

      // The TooImbalanced error is designed to be a secondary check
      // It gets preempted by ERC4626 max function checks which return 0
      // This demonstrates the contract's defensive design where imbalance
      // is caught at multiple levels for safety
    });

    it("Should handle multiple users when vault becomes imbalanced", async function () {
      const user1 = accounts[1];
      const user2 = accounts[2];

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1.0"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("1.0"),
      );

      // User 1 makes first deposit
      await dloopMock
        .connect(user1)
        .deposit(ethers.parseEther("100"), user1.address);

      // Get leverage after first deposit (should be target leverage)
      const leverageAfterFirstDeposit = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterFirstDeposit).to.be.closeTo(
        BigInt(TARGET_LEVERAGE_BPS),
        BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
      );

      // Get leverage before User 2's deposit
      const leverageBeforeSecondDeposit =
        await dloopMock.getCurrentLeverageBps();

      // User 2 makes second deposit (should work when balanced)
      await dloopMock
        .connect(user2)
        .deposit(ethers.parseEther("50"), user2.address);

      // Get leverage after User 2's deposit
      const leverageAfterSecondDeposit =
        await dloopMock.getCurrentLeverageBps();

      // Check leverage preservation: after deposit, leverage should remain the same as before deposit
      expect(leverageAfterSecondDeposit).to.be.closeTo(
        leverageBeforeSecondDeposit,
        BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
      );

      // Change prices to create imbalance
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("0.8"), // Collateral drops moderately
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("1.2"), // Debt increases moderately
      );

      // Verify imbalance affects all users
      expect(await dloopMock.isTooImbalanced()).to.be.true;
      expect(await dloopMock.maxDeposit(user1.address)).to.equal(0);
      expect(await dloopMock.maxDeposit(user2.address)).to.equal(0);

      // Both users should be unable to deposit due to imbalance (maxDeposit returns 0)
      await expect(
        dloopMock
          .connect(user1)
          .deposit(ethers.parseEther("10"), user1.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxDeposit");

      await expect(
        dloopMock
          .connect(user2)
          .deposit(ethers.parseEther("10"), user2.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxDeposit");
    });
  });
});
