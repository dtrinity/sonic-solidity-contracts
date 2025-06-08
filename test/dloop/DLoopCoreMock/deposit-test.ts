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

describe("DLoopCoreMock Deposit Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let mockPool: { getAddress: () => Promise<string> };
  // let deployer: string;
  let user1: string;
  let user2: string;
  let user3: string;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    mockPool = {
      getAddress: async (): Promise<string> => fixture.mockPool.address,
    };
    // deployer = fixture.deployer;
    user1 = fixture.user1.address;
    user2 = fixture.user2.address;
    user3 = fixture.user3.address;
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
          expectedLeverage: 300 * ONE_PERCENT_BPS, // 300% = TARGET_LEVERAGE_BPS
        },
        {
          description: "Deposit after collateral price increase",
          amount: ethers.parseEther("80"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.8"),
          expectedLeverage: 276.923 * ONE_PERCENT_BPS, // ~277% leverage after price change
        },
        {
          description: "Deposit with further collateral price increase",
          amount: ethers.parseEther("60"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.8"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257% leverage
        },
        {
          description: "Deposit with debt price increase",
          amount: ethers.parseEther("40"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.9"),
          expectedLeverage: 288.889 * ONE_PERCENT_BPS, // ~289% leverage
        },
        {
          description: "Final deposit with balanced price increases",
          amount: ethers.parseEther("20"),
          collateralPrice: ethers.parseEther("1.5"),
          debtPrice: ethers.parseEther("1.0"),
          expectedLeverage: 300 * ONE_PERCENT_BPS, // Back to ~300% leverage
        },
      ];

      let totalDeposited = BigInt(0);

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

        // Make deposit if allowed
        const maxDeposit = await dloopMock.maxDeposit(targetUser.address);

        if (maxDeposit >= step.amount) {
          await dloopMock
            .connect(targetUser)
            .deposit(step.amount, targetUser.address);
          totalDeposited += step.amount;
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
          expectedLeverage: 282353, // ~282% leverage after price changes
        },
        {
          amount: ethers.parseEther("75"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.9"),
          expectedLeverage: 260870, // ~261% leverage
        },
        {
          amount: ethers.parseEther("25"),
          collateralPrice: ethers.parseEther("1.35"),
          debtPrice: ethers.parseEther("0.95"),
          expectedLeverage: 257143, // ~257% leverage
        },
      ];

      let totalDeposited = BigInt(0);

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

        // Make deposit (check if allowed first)
        const maxDeposit = await dloopMock.maxDeposit(targetUser.address);

        if (maxDeposit >= deposit.amount) {
          await dloopMock
            .connect(targetUser)
            .deposit(deposit.amount, targetUser.address);

          totalDeposited += deposit.amount;
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
          expectedLeverage: 300 * ONE_PERCENT_BPS, // 300%
        },
        {
          description: "User 2 deposit after collateral price increase",
          user: user2,
          amount: ethers.parseEther("80"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.8"),
          expectedLeverage: 276.923 * ONE_PERCENT_BPS, // ~277%
        },
        {
          description: "User 3 deposit with further price increase",
          user: user3,
          amount: ethers.parseEther("60"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.8"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257%
        },
        {
          description: "User 1 second deposit with debt price change",
          user: user1,
          amount: ethers.parseEther("30"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.9"),
          expectedLeverage: 288.889 * ONE_PERCENT_BPS, // ~289%
        },
        {
          description: "User 2 second deposit",
          user: user2,
          amount: ethers.parseEther("40"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("0.9"),
          expectedLeverage: 288.889 * ONE_PERCENT_BPS, // ~289%
        },
        {
          description: "User 3 second deposit with balanced prices",
          user: user3,
          amount: ethers.parseEther("25"),
          collateralPrice: ethers.parseEther("1.5"),
          debtPrice: ethers.parseEther("1.0"),
          expectedLeverage: 300 * ONE_PERCENT_BPS, // Back to 300%
        },
      ];

      const userBalances = new Map();

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

        // Make deposit if allowed
        const maxDeposit = await dloopMock.maxDeposit(step.user.address);

        if (maxDeposit >= step.amount) {
          await dloopMock
            .connect(step.user)
            .deposit(step.amount, step.user.address);
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
          expectedLeverage: 282.353 * ONE_PERCENT_BPS, // ~282% leverage
        },
        {
          user: user2,
          amount: ethers.parseEther("50"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.9"),
          expectedLeverage: 260.87 * ONE_PERCENT_BPS, // ~261% leverage
        },
        {
          user: user3,
          amount: ethers.parseEther("40"),
          collateralPrice: ethers.parseEther("1.35"),
          debtPrice: ethers.parseEther("0.95"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257% leverage
        },
        {
          user: user1,
          amount: ethers.parseEther("35"),
          collateralPrice: ethers.parseEther("1.4"),
          debtPrice: ethers.parseEther("1.0"),
          expectedLeverage: 280 * ONE_PERCENT_BPS, // ~280% leverage
        },
        {
          user: user2,
          amount: ethers.parseEther("25"),
          collateralPrice: ethers.parseEther("1.35"),
          debtPrice: ethers.parseEther("0.95"),
          expectedLeverage: 257.143 * ONE_PERCENT_BPS, // ~257% leverage
        },
        {
          user: user3,
          amount: ethers.parseEther("30"),
          collateralPrice: ethers.parseEther("1.3"),
          debtPrice: ethers.parseEther("0.9"),
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

        // Get user's current balance before deposit
        const userAddress = scenario.user.address;
        const balanceBefore = await dloopMock.balanceOf(userAddress);

        // Make deposit (check if allowed first)
        const maxDeposit = await dloopMock.maxDeposit(userAddress);

        if (maxDeposit >= scenario.amount) {
          await dloopMock
            .connect(scenario.user)
            .deposit(scenario.amount, userAddress);
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

      for (const [userAddress, shares] of userBalances) {
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
});
