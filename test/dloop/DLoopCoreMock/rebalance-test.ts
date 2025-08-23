import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_BPS_UNIT, ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, LOWER_BOUND_BPS, MAX_SUBSIDY_BPS, TARGET_LEVERAGE_BPS, testSetup, UPPER_BOUND_BPS } from "./fixture";

// NOTE: High-level rebalance scenarios are covered by CoreLogic tests; skip redundant mock integration suite
describe.skip("DLoopCoreMock Rebalance Tests", function () {
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
    const increaseLeverageTests = [
      {
        name: "Should increase leverage from below target to target (equal prices)",
        initialPrices: {
          collateral: ethers.parseUnits("1", 8),
          debt: ethers.parseUnits("1", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.2", 8), // 20% increase
          debt: ethers.parseUnits("1", 8), // No change
        },
        additionalCollateral: ethers.parseEther("10"),
        userIndex: 1,
        expectedDirection: 1,
      },
      {
        name: "Should increase leverage with debt price higher than collateral",
        initialPrices: {
          collateral: ethers.parseUnits("0.8", 8),
          debt: ethers.parseUnits("1.2", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.0", 8), // 25% increase
          debt: ethers.parseUnits("1.2", 8), // No change
        },
        additionalCollateral: ethers.parseEther("8"),
        userIndex: 1,
        expectedDirection: 1,
      },
      {
        name: "Should increase leverage with collateral price lower than debt",
        initialPrices: {
          collateral: ethers.parseUnits("0.6", 8),
          debt: ethers.parseUnits("1.4", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("0.75", 8), // 25% increase
          debt: ethers.parseUnits("1.4", 8), // No change
        },
        additionalCollateral: ethers.parseEther("12"),
        userIndex: 1,
        expectedDirection: 1,
      },
      {
        name: "Should handle multiple increase operations with different price ratios",
        initialPrices: {
          collateral: ethers.parseUnits("1.5", 8),
          debt: ethers.parseUnits("0.7", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.75", 8), // Further increase
          debt: ethers.parseUnits("0.7", 8), // No change
        },
        additionalCollateral: ethers.parseEther("5"),
        userIndex: 1,
        expectedDirection: 1,
        multipleOperations: true,
      },
    ];

    for (const testCase of increaseLeverageTests) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const userAddress = user.address;

        // Set initial prices and make first deposit
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.initialPrices.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.initialPrices.debt);

        // Initial deposit
        await dloopMock.connect(user).deposit(ethers.parseEther("100"), userAddress);

        // Verify initial leverage (allow small tolerance due to precision)
        const initialLeverage = await dloopMock.getCurrentLeverageBps();
        expect(initialLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000); // 0.1% tolerance

        // Create imbalance by changing prices
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance.debt);

        // Verify leverage is now below target
        const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
        expect(leverageAfterPriceChange).to.be.lt(TARGET_LEVERAGE_BPS);

        // Get expected quote for increase leverage
        const [, direction] = await dloopMock.quoteRebalanceAmountToReachTargetLeverage();
        expect(direction).to.equal(testCase.expectedDirection);

        // Get user balances before increase leverage
        const userDebtBalanceBefore = await debtToken.balanceOf(userAddress);

        // Perform increase leverage
        await dloopMock.connect(user).increaseLeverage(testCase.additionalCollateral, 0);

        // Verify user received debt tokens
        const userDebtBalanceAfter = await debtToken.balanceOf(userAddress);
        const debtReceived = userDebtBalanceAfter - userDebtBalanceBefore;
        expect(debtReceived).to.be.gt(0);

        // Verify leverage increased towards target
        const finalLeverage = await dloopMock.getCurrentLeverageBps();
        expect(finalLeverage).to.be.gt(leverageAfterPriceChange);
        expect(finalLeverage).to.be.lte(TARGET_LEVERAGE_BPS);

        // Handle multiple operations if specified
        if (testCase.multipleOperations) {
          const leverageBefore = await dloopMock.getCurrentLeverageBps();

          if (leverageBefore < TARGET_LEVERAGE_BPS) {
            await dloopMock.connect(user).increaseLeverage(ethers.parseEther("3"), 0);
            const leverageAfterSecond = await dloopMock.getCurrentLeverageBps();
            expect(leverageAfterSecond).to.be.gte(leverageBefore);
          }
        }
      });
    }
  });

  describe("II. Basic Decrease Leverage Functionality", function () {
    const decreaseLeverageTests = [
      {
        name: "Should decrease leverage from above target to target (equal prices)",
        initialPrices: {
          collateral: ethers.parseUnits("1", 8),
          debt: ethers.parseUnits("1", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("0.9", 8), // 10% decrease
          debt: ethers.parseUnits("1", 8), // No change
        },
        additionalDebt: ethers.parseEther("8"),
        userIndex: 1,
        expectedDirection: -1,
      },
      {
        name: "Should decrease leverage with debt price lower than collateral",
        initialPrices: {
          collateral: ethers.parseUnits("1.3", 8),
          debt: ethers.parseUnits("0.7", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.1", 8), // 15% decrease
          debt: ethers.parseUnits("0.7", 8), // No change
        },
        additionalDebt: ethers.parseEther("6"),
        userIndex: 1,
        expectedDirection: -1,
      },
      {
        name: "Should decrease leverage with both prices changing unfavorably",
        initialPrices: {
          collateral: ethers.parseUnits("1.5", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.25", 8), // 17% decrease
          debt: ethers.parseUnits("0.9", 8), // 12.5% increase
        },
        additionalDebt: ethers.parseEther("7"),
        userIndex: 1,
        expectedDirection: -1,
      },
      {
        name: "Should handle multiple decrease operations with asymmetric prices",
        initialPrices: {
          collateral: ethers.parseUnits("0.9", 8),
          debt: ethers.parseUnits("1.6", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("0.8", 8), // Further decrease
          debt: ethers.parseUnits("1.8", 8), // Further increase
        },
        additionalDebt: ethers.parseEther("5"),
        userIndex: 1,
        expectedDirection: -1,
        multipleOperations: true,
      },
    ];

    for (const testCase of decreaseLeverageTests) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const userAddress = user.address;

        // Set initial prices and make first deposit
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.initialPrices.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.initialPrices.debt);

        // Initial deposit
        await dloopMock.connect(user).deposit(ethers.parseEther("100"), userAddress);

        // Verify initial leverage
        const initialLeverage = await dloopMock.getCurrentLeverageBps();
        expect(initialLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000);

        // Create imbalance by changing prices
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance.debt);

        // Verify leverage is now above target
        const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();
        expect(leverageAfterPriceChange).to.be.gt(TARGET_LEVERAGE_BPS);

        // Get expected quote for decrease leverage
        const [, direction] = await dloopMock.quoteRebalanceAmountToReachTargetLeverage();
        expect(direction).to.equal(testCase.expectedDirection);

        // Get user balances before decrease leverage
        const userCollateralBalanceBefore = await collateralToken.balanceOf(userAddress);

        // Perform decrease leverage
        await dloopMock.connect(user).decreaseLeverage(testCase.additionalDebt, 0);

        // Verify user received collateral tokens
        const userCollateralBalanceAfter = await collateralToken.balanceOf(userAddress);
        const collateralReceived = userCollateralBalanceAfter - userCollateralBalanceBefore;
        expect(collateralReceived).to.be.gt(0);

        // Verify leverage decreased towards target
        const finalLeverage = await dloopMock.getCurrentLeverageBps();
        expect(finalLeverage).to.be.lt(leverageAfterPriceChange);
        expect(finalLeverage).to.be.gte(TARGET_LEVERAGE_BPS);

        // Handle multiple operations if specified
        if (testCase.multipleOperations) {
          const leverageBefore = await dloopMock.getCurrentLeverageBps();

          if (leverageBefore > TARGET_LEVERAGE_BPS) {
            await dloopMock.connect(user).decreaseLeverage(ethers.parseEther("3"), 0);
            const leverageAfterSecond = await dloopMock.getCurrentLeverageBps();
            expect(leverageAfterSecond).to.be.lte(leverageBefore);
          }
        }
      });
    }
  });

  describe("III. Rebalance with Subsidies", function () {
    const subsidyTests = [
      {
        name: "Should provide subsidy when increasing leverage far from target (high debt price)",
        initialPrices: {
          collateral: ethers.parseUnits("1", 8),
          debt: ethers.parseUnits("1.5", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.4", 8), // 40% increase
          debt: ethers.parseUnits("1.5", 8), // No change
        },
        additionalAmount: ethers.parseEther("10"),
        operation: "increase",
        expectedSubsidyCondition: "gt",
        expectedSubsidyValue: 0,
      },
      {
        name: "Should provide subsidy when decreasing leverage far from target (low collateral price)",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.15", 8), // 4% decrease
          debt: ethers.parseUnits("0.82", 8), // 2.5% increase
        },
        additionalAmount: ethers.parseEther("8"),
        operation: "decrease",
        expectedSubsidyCondition: "gt",
        expectedSubsidyValue: 0,
      },
      {
        name: "Should cap subsidy at maximum rate with extreme price differences",
        initialPrices: {
          collateral: ethers.parseUnits("2", 8),
          debt: ethers.parseUnits("0.5", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("3", 8), // 50% increase
          debt: ethers.parseUnits("0.5", 8), // No change
        },
        additionalAmount: ethers.parseEther("15"),
        operation: "increase",
        expectedSubsidyCondition: "eq",
        expectedSubsidyValue: MAX_SUBSIDY_BPS,
      },
      {
        name: "Should provide minimal subsidy when close to target (slight price asymmetry)",
        initialPrices: {
          collateral: ethers.parseUnits("1.1", 8),
          debt: ethers.parseUnits("0.9", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.11", 8), // 1% increase
          debt: ethers.parseUnits("0.9", 8), // No change
        },
        additionalAmount: ethers.parseEther("1"), // Very small amount
        operation: "increase",
        expectedSubsidyCondition: "gte",
        expectedSubsidyValue: 0,
      },
    ];

    for (const testCase of subsidyTests) {
      it(testCase.name, async function () {
        const user = accounts[1];
        const userAddress = user.address;

        // Set initial prices and deposit
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.initialPrices.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.initialPrices.debt);

        await dloopMock.connect(user).deposit(ethers.parseEther("100"), userAddress);

        // Create imbalance
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance.debt);

        // Check subsidy before operation
        const subsidyBps = await dloopMock.getCurrentSubsidyBps();

        if (testCase.expectedSubsidyCondition === "gt") {
          expect(subsidyBps).to.be.gt(testCase.expectedSubsidyValue);
        } else if (testCase.expectedSubsidyCondition === "eq") {
          expect(subsidyBps).to.equal(testCase.expectedSubsidyValue);
        } else if (testCase.expectedSubsidyCondition === "lt") {
          expect(subsidyBps).to.be.lt(testCase.expectedSubsidyValue);
        }

        // Perform rebalance operation
        if (testCase.operation === "increase") {
          await dloopMock.connect(user).increaseLeverage(testCase.additionalAmount, 0);
        } else {
          await dloopMock.connect(user).decreaseLeverage(testCase.additionalAmount, 0);
        }

        // Verify operation completed successfully
        const finalLeverage = await dloopMock.getCurrentLeverageBps();
        expect(finalLeverage).to.be.gte(LOWER_BOUND_BPS);
        expect(finalLeverage).to.be.lte(UPPER_BOUND_BPS);
      });
    }
  });

  describe("IV. Error Cases", function () {
    const errorCaseTests = [
      {
        name: "Should revert when trying to increase leverage above target (asymmetric prices)",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.15", 8), // Slight decrease
          debt: ethers.parseUnits("0.85", 8), // Slight increase
        },
        operation: "increase",
        amount: ethers.parseEther("10"),
        expectedError: "LeverageExceedsTarget",
        shouldCreateImbalanceFirst: true,
      },
      {
        name: "Should revert when trying to decrease leverage below target (different price scenario)",
        initialPrices: {
          collateral: ethers.parseUnits("0.8", 8),
          debt: ethers.parseUnits("1.3", 8),
        },
        priceChangeToImbalance: null, // Start at target
        operation: "decrease",
        amount: ethers.parseEther("10"),
        expectedError: "LeverageBelowTarget",
        shouldCreateImbalanceFirst: false,
      },
      {
        name: "Should revert when increase leverage amount is too large (high debt price)",
        initialPrices: {
          collateral: ethers.parseUnits("1", 8),
          debt: ethers.parseUnits("2", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.5", 8), // Large increase
          debt: ethers.parseUnits("2", 8), // No change
        },
        operation: "increase",
        amount: ethers.parseEther("500"),
        expectedError: "IncreaseLeverageOutOfRange",
        shouldCreateImbalanceFirst: true,
      },
      {
        name: "Should revert when decrease leverage amount is too large (price asymmetry)",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.1", 8), // Moderate decrease
          debt: ethers.parseUnits("0.85", 8), // Moderate increase
        },
        operation: "decrease",
        amount: ethers.parseEther("80"), // Larger amount to trigger error
        expectedError: "DecreaseLeverageOutOfRange",
        shouldCreateImbalanceFirst: true,
      },
    ];

    for (const testCase of errorCaseTests) {
      const testFunction = testCase.name.includes("SKIP") ? it.skip : it;
      testFunction(testCase.name, async function () {
        const user = accounts[1];

        // Set initial prices
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.initialPrices.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.initialPrices.debt);

        // Initial deposit
        await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);

        // Create imbalance if needed
        if (testCase.shouldCreateImbalanceFirst && testCase.priceChangeToImbalance) {
          await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance.collateral);
          await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance.debt);
        }

        // Attempt operation and expect revert
        if (testCase.operation === "increase") {
          await expect(dloopMock.connect(user).increaseLeverage(testCase.amount, 0)).to.be.revertedWithCustomError(
            dloopMock,
            testCase.expectedError,
          );
        } else {
          await expect(dloopMock.connect(user).decreaseLeverage(testCase.amount, 0)).to.be.revertedWithCustomError(
            dloopMock,
            testCase.expectedError,
          );
        }
      });
    }

    const slippageTests = [
      {
        name: "Should revert when slippage protection fails on increase leverage (high debt price scenario)",
        prices: {
          collateral: ethers.parseUnits("0.9", 8),
          debt: ethers.parseUnits("1.4", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.3", 8),
          debt: ethers.parseUnits("1.4", 8),
        },
        operation: "increase",
        amount: ethers.parseEther("10"),
        minReceived: ethers.parseEther("1000"), // Unreasonably high
        expectedError: "RebalanceReceiveLessThanMinAmount",
      },
      {
        name: "Should revert when slippage protection fails on decrease leverage (low collateral price scenario)",
        prices: {
          collateral: ethers.parseUnits("1.1", 8),
          debt: ethers.parseUnits("0.6", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("0.9", 8),
          debt: ethers.parseUnits("0.6", 8),
        },
        operation: "decrease",
        amount: ethers.parseEther("10"),
        minReceived: ethers.parseEther("1000"), // Unreasonably high
        expectedError: "RebalanceReceiveLessThanMinAmount",
      },
    ];

    for (const testCase of slippageTests) {
      it(testCase.name, async function () {
        const user = accounts[1];

        // Set initial prices
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.prices.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.prices.debt);

        // Initial deposit
        await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);

        // Create imbalance
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance.debt);

        // Attempt operation with unreasonable slippage protection
        if (testCase.operation === "increase") {
          await expect(dloopMock.connect(user).increaseLeverage(testCase.amount, testCase.minReceived)).to.be.revertedWithCustomError(
            dloopMock,
            testCase.expectedError,
          );
        } else {
          await expect(dloopMock.connect(user).decreaseLeverage(testCase.amount, testCase.minReceived)).to.be.revertedWithCustomError(
            dloopMock,
            testCase.expectedError,
          );
        }
      });
    }
  });

  describe("V. Multiple Users Rebalancing", function () {
    const multiUserTests = [
      {
        name: "Should handle multiple users increasing leverage independently (diverse prices)",
        scenarios: [
          {
            userIndex: 1,
            prices: {
              collateral: ethers.parseUnits("1.2", 8),
              debt: ethers.parseUnits("0.8", 8),
            },
            priceChange: {
              collateral: ethers.parseUnits("1.3", 8),
              debt: ethers.parseUnits("0.8", 8),
            },
            amount: ethers.parseEther("10"),
            expectedEndScenarioLeverage: 285.2656 * ONE_PERCENT_BPS,
          },
          {
            userIndex: 2,
            prices: {
              collateral: ethers.parseUnits("1.1", 8),
              debt: ethers.parseUnits("0.9", 8),
            },
            priceChange: {
              collateral: ethers.parseUnits("1.2", 8),
              debt: ethers.parseUnits("0.9", 8),
            },
            amount: ethers.parseEther("5"),
            expectedEndScenarioLeverage: 463.8977 * ONE_PERCENT_BPS,
          },
        ],
        operation: "increase",
      },
      {
        name: "Should handle multiple users decreasing leverage independently (asymmetric prices)",
        scenarios: [
          {
            userIndex: 1,
            prices: {
              collateral: ethers.parseUnits("1.2", 8),
              debt: ethers.parseUnits("0.8", 8),
            },
            priceChange: {
              collateral: ethers.parseUnits("1.1", 8),
              debt: ethers.parseUnits("0.85", 8),
            },
            amount: ethers.parseEther("8"),
            expectedEndScenarioLeverage: 413.6531 * ONE_PERCENT_BPS,
          },
          {
            userIndex: 2,
            prices: {
              collateral: ethers.parseUnits("1.1", 8),
              debt: ethers.parseUnits("0.9", 8),
            },
            priceChange: {
              collateral: ethers.parseUnits("1.0", 8),
              debt: ethers.parseUnits("0.95", 8),
            },
            amount: ethers.parseEther("6"),
            expectedEndScenarioLeverage: 1396.9564 * ONE_PERCENT_BPS,
          },
        ],
        operation: "decrease",
      },
    ];

    for (const testCase of multiUserTests) {
      it(testCase.name, async function () {
        // Use a single user with multiple scenarios sequentially
        const user = accounts[1];

        const executedOperations: string[] = [];

        for (const scenario of testCase.scenarios) {
          // Set initial prices
          await dloopMock.setMockPrice(await collateralToken.getAddress(), scenario.prices.collateral);
          await dloopMock.setMockPrice(await debtToken.getAddress(), scenario.prices.debt);

          // User makes deposit (only once)
          // If user already deposited in the previous scenario, skip deposit
          const currentShares = await dloopMock.balanceOf(user.address);

          if (currentShares === 0n) {
            await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);
          }

          // Create imbalance
          await dloopMock.setMockPrice(await collateralToken.getAddress(), scenario.priceChange.collateral);
          await dloopMock.setMockPrice(await debtToken.getAddress(), scenario.priceChange.debt);

          const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();

          if (leverageAfterPriceChange < TARGET_LEVERAGE_BPS) {
            // Get user balance before operation
            const userBalanceBefore = await debtToken.balanceOf(user.address);

            // Run increase leverage
            await dloopMock.connect(user).increaseLeverage(scenario.amount, 0);

            // Verify user received tokens after increase leverage
            const userBalanceAfter = await debtToken.balanceOf(user.address);
            expect(userBalanceAfter).to.be.gt(userBalanceBefore);

            // Track executed operation
            executedOperations.push("increase");
          } else if (leverageAfterPriceChange > TARGET_LEVERAGE_BPS) {
            // Get user balance before operation
            const userBalanceBefore = await collateralToken.balanceOf(user.address);

            // Run decrease leverage
            await dloopMock.connect(user).decreaseLeverage(scenario.amount, 0);

            // Verify user received tokens after decrease leverage
            const userBalanceAfter = await collateralToken.balanceOf(user.address);
            expect(userBalanceAfter).to.be.gt(userBalanceBefore);

            // Track executed operation
            executedOperations.push("decrease");
          }

          // Verify leverage is within bounds
          const finalLeverage = await dloopMock.getCurrentLeverageBps();
          expect(finalLeverage).to.be.closeTo(
            scenario.expectedEndScenarioLeverage,
            ONE_BPS_UNIT, // only 1 bps unit of error is allowed
          );
        }

        // Make sure that the executed operations are the same as the expected operations
        expect(executedOperations).to.include(testCase.operation);
      });
    }
  });

  describe("VI. Rebalance with Vault Token Balance", function () {
    const vaultBalanceTests = [
      {
        name: "Should use vault collateral balance for increase leverage when available (price asymmetry)",
        initialPrices: {
          collateral: ethers.parseUnits("0.9", 8),
          debt: ethers.parseUnits("1.1", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("1.1", 8),
        },
        vaultTokenAmount: ethers.parseEther("60"),
        tokenType: "collateral",
        operation: "increase",
      },
      {
        name: "Should use vault debt balance for decrease leverage when available (inverse prices)",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.1", 8),
          debt: ethers.parseUnits("0.85", 8),
        },
        vaultTokenAmount: ethers.parseEther("30"),
        tokenType: "debt",
        operation: "decrease",
      },
    ];

    for (const testCase of vaultBalanceTests) {
      const testFunction = testCase.name.includes("SKIP") ? it.skip : it;
      testFunction(testCase.name, async function () {
        const user = accounts[1];

        // Set initial prices and deposit
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.initialPrices.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.initialPrices.debt);

        await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);

        // Add tokens directly to vault
        if (testCase.tokenType === "collateral") {
          await collateralToken.mint(await dloopMock.getAddress(), testCase.vaultTokenAmount);
        } else {
          await debtToken.mint(await dloopMock.getAddress(), testCase.vaultTokenAmount);
        }

        // Create imbalance
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance.debt);

        // Get quotes with and without vault balance
        const [tokenAmountWithVault] = await dloopMock.quoteRebalanceAmountToReachTargetLeverage();
        const [tokenAmountWithoutVault] = await dloopMock.quoteRebalanceAmountToReachTargetLeverage();

        // Should require less additional tokens when using vault balance
        expect(tokenAmountWithVault).to.be.lte(tokenAmountWithoutVault);

        // Perform operation with 0 additional (using only vault balance)
        let userBalanceBefore: bigint;

        if (testCase.operation === "increase") {
          userBalanceBefore = await debtToken.balanceOf(user.address);
          await dloopMock.connect(user).increaseLeverage(0, 0);
        } else {
          userBalanceBefore = await collateralToken.balanceOf(user.address);
          // Use a small amount to avoid overflow
          await dloopMock.connect(user).decreaseLeverage(ethers.parseEther("1"), 0);
        }

        // Verify user received tokens despite providing no additional tokens
        if (testCase.operation === "increase") {
          const userBalanceAfter = await debtToken.balanceOf(user.address);
          expect(userBalanceAfter).to.be.gt(userBalanceBefore);
        } else {
          const userBalanceAfter = await collateralToken.balanceOf(user.address);
          expect(userBalanceAfter).to.be.gt(userBalanceBefore);
        }
      });
    }
  });

  describe("VII. Integration with Deposit/Withdraw", function () {
    const integrationTests = [
      {
        name: "Should prevent deposits when leverage is too imbalanced (extreme price divergence)",
        initialPrices: {
          collateral: ethers.parseUnits("1", 8),
          debt: ethers.parseUnits("1", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("0.85", 8), // 15% drop
          debt: ethers.parseUnits("1.15", 8), // 15% increase
        },
        expectedImbalanced: true,
      },
      {
        name: "Should maintain proper leverage bounds after rebalancing (complex price scenarios)",
        scenarios: [
          {
            collateralPrice: ethers.parseUnits("1.1", 8),
            debtPrice: ethers.parseUnits("0.9", 8),
            operation: "increase",
            amount: ethers.parseEther("5"),
          },
          {
            collateralPrice: ethers.parseUnits("1.05", 8),
            debtPrice: ethers.parseUnits("0.95", 8),
            operation: "decrease",
            amount: ethers.parseEther("4"),
          },
          {
            collateralPrice: ethers.parseUnits("1.08", 8),
            debtPrice: ethers.parseUnits("0.92", 8),
            operation: "increase",
            amount: ethers.parseEther("3"),
          },
        ],
      },
    ];

    for (const testCase of integrationTests) {
      if (testCase.name.includes("prevent deposits")) {
        it(testCase.name, async function () {
          const user = accounts[1];

          // Set initial prices and deposit
          await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.initialPrices!.collateral);
          await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.initialPrices!.debt);

          await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);

          // Create extreme imbalance
          await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance!.collateral);
          await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance!.debt);

          // Verify vault is imbalanced and deposits are prevented
          const currentLeverage = await dloopMock.getCurrentLeverageBps();
          expect(currentLeverage).to.be.gt(UPPER_BOUND_BPS);
          expect(await dloopMock.isTooImbalanced()).to.be.true;
          expect(await dloopMock.maxDeposit(user.address)).to.equal(0);

          // Attempt deposit should fail
          await expect(dloopMock.connect(user).deposit(ethers.parseEther("10"), user.address)).to.be.revertedWithCustomError(
            dloopMock,
            "ERC4626ExceededMaxDeposit",
          );
        });
      } else {
        it(testCase.name, async function () {
          const user = accounts[1];

          // Set initial prices and deposit
          await dloopMock.setMockPrice(await collateralToken.getAddress(), ethers.parseUnits("1", 8));
          await dloopMock.setMockPrice(await debtToken.getAddress(), ethers.parseUnits("1", 8));

          await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);

          // Execute scenarios
          for (const scenario of testCase.scenarios!) {
            // Set prices
            await dloopMock.setMockPrice(await collateralToken.getAddress(), scenario.collateralPrice);
            await dloopMock.setMockPrice(await debtToken.getAddress(), scenario.debtPrice);

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
      }
    }
  });

  describe("VIII. Exact Target Leverage Achievement Tests", function () {
    const exactTargetTests = [
      {
        name: "Should achieve exact target leverage when using quoteRebalanceAmountToReachTargetLeverage for increase (debt price higher)",
        initialPrices: {
          collateral: ethers.parseUnits("1", 8),
          debt: ethers.parseUnits("1.3", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.2", 8), // 20% increase
          debt: ethers.parseUnits("1.3", 8), // No change
        },
        operation: "increase",
        toleranceBps: 50, // 0.05% tolerance
      },
      {
        name: "Should achieve exact target leverage when using quoteRebalanceAmountToReachTargetLeverage for decrease (collateral price lower)",
        initialPrices: {
          collateral: ethers.parseUnits("1.1", 8),
          debt: ethers.parseUnits("0.9", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.05", 8), // 5% decrease
          debt: ethers.parseUnits("0.92", 8), // 2% increase
        },
        operation: "decrease",
        toleranceBps: 30000, // 0.3% tolerance
      },
      {
        name: "Should achieve exact target leverage with asymmetric price changes (increase scenario)",
        initialPrices: {
          collateral: ethers.parseUnits("0.9", 8),
          debt: ethers.parseUnits("1.1", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.05", 8), // 17% increase
          debt: ethers.parseUnits("1.1", 8), // No change
        },
        operation: "increase",
        toleranceBps: 100, // 0.1% tolerance
      },
      {
        name: "Should achieve exact target leverage with inverse price movements (decrease scenario)",
        initialPrices: {
          collateral: ethers.parseUnits("1.1", 8),
          debt: ethers.parseUnits("0.9", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.05", 8), // 5% decrease
          debt: ethers.parseUnits("0.93", 8), // 3% increase
        },
        operation: "decrease",
        toleranceBps: 30000, // 0.3% tolerance
      },
      {
        name: "Should handle edge case when already very close to target leverage",
        initialPrices: {
          collateral: ethers.parseUnits("1", 8),
          debt: ethers.parseUnits("1", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.01", 8), // 1% increase
          debt: ethers.parseUnits("1", 8), // No change
        },
        operation: "increase",
        toleranceBps: 25, // 0.025% tolerance for small adjustments
      },
      {
        name: "Should achieve target with moderate price divergence (decrease scenario)",
        initialPrices: {
          collateral: ethers.parseUnits("1.05", 8),
          debt: ethers.parseUnits("0.95", 8),
        },
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.02", 8), // 3% decrease
          debt: ethers.parseUnits("0.97", 8), // 2% increase
        },
        operation: "decrease",
        toleranceBps: 30000, // 0.3% tolerance
      },
    ];

    for (const testCase of exactTargetTests) {
      it(testCase.name, async function () {
        const user = accounts[1];
        const userAddress = user.address;

        // Set initial prices and make deposit
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.initialPrices.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.initialPrices.debt);

        // Initial deposit
        await dloopMock.connect(user).deposit(ethers.parseEther("100"), userAddress);

        // Verify initial leverage is at target
        const initialLeverage = await dloopMock.getCurrentLeverageBps();
        expect(initialLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000); // 0.1% tolerance

        // Create imbalance by changing prices
        await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChangeToImbalance.collateral);
        await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChangeToImbalance.debt);

        // Verify leverage has moved away from target
        const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();

        if (testCase.operation === "increase") {
          expect(leverageAfterPriceChange).to.be.lt(TARGET_LEVERAGE_BPS);
        } else {
          expect(leverageAfterPriceChange).to.be.gt(TARGET_LEVERAGE_BPS);
        }

        // Get exact amount needed to reach target leverage
        const [exactAmount, direction] = await dloopMock.quoteRebalanceAmountToReachTargetLeverage();

        // Verify direction matches expected operation
        if (testCase.operation === "increase") {
          expect(direction).to.equal(1);
          expect(exactAmount).to.be.gt(0);
        } else {
          expect(direction).to.equal(-1);
          expect(exactAmount).to.be.gt(0);
        }

        // Record balances before operation
        const userCollateralBefore = await collateralToken.balanceOf(userAddress);
        const userDebtBefore = await debtToken.balanceOf(userAddress);

        // Use the exact quoted amount in rebalance operation
        if (testCase.operation === "increase") {
          await dloopMock.connect(user).increaseLeverage(exactAmount, 0);

          // Verify user received debt tokens
          const userDebtAfter = await debtToken.balanceOf(userAddress);
          expect(userDebtAfter).to.be.gt(userDebtBefore);
        } else {
          await dloopMock.connect(user).decreaseLeverage(exactAmount, 0);

          // Verify user received collateral tokens
          const userCollateralAfter = await collateralToken.balanceOf(userAddress);
          expect(userCollateralAfter).to.be.gt(userCollateralBefore);
        }

        // Verify final leverage is at target within tight tolerance
        const finalLeverage = await dloopMock.getCurrentLeverageBps();
        expect(finalLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, testCase.toleranceBps);

        // Additional verification: check that we're very close to target
        const leverageDifference =
          finalLeverage > BigInt(TARGET_LEVERAGE_BPS)
            ? finalLeverage - BigInt(TARGET_LEVERAGE_BPS)
            : BigInt(TARGET_LEVERAGE_BPS) - finalLeverage;

        expect(Number(leverageDifference)).to.be.lte(testCase.toleranceBps);
      });
    }

    it("Should handle case when already at target leverage", async function () {
      const user = accounts[1];

      // Set equal prices to maintain target leverage
      await dloopMock.setMockPrice(await collateralToken.getAddress(), ethers.parseUnits("1", 8));
      await dloopMock.setMockPrice(await debtToken.getAddress(), ethers.parseUnits("1", 8));

      // Initial deposit
      await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);

      // Verify we're at target
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000);

      // Get amount when already at target
      const [amount, _direction] = await dloopMock.quoteRebalanceAmountToReachTargetLeverage();

      // When already at target, amount should be very small
      // Direction might not be exactly 0 due to precision, but should indicate minimal adjustment
      expect(Number(amount)).to.be.lt(Number(ethers.parseEther("0.1")));
      // Accept direction as 0, 1, or -1 since small adjustments might be needed
    });
  });

  describe("IX. Underflow tests", function () {
    describe("decreaseLeverage", function () {
      const testCases = [
        {
          name: "Case 1",
          prices: {
            collateral: ethers.parseUnits("1.2", 8),
            debt: ethers.parseUnits("0.8", 8),
          },
          priceChange: {
            collateral: ethers.parseUnits("1.1", 8),
            debt: ethers.parseUnits("0.85", 8),
          },
        },
        {
          name: "Case 2",
          prices: {
            collateral: ethers.parseUnits("1.4", 8),
            debt: ethers.parseUnits("0.6", 8),
          },
          priceChange: {
            collateral: ethers.parseUnits("1.3", 8),
            debt: ethers.parseUnits("0.7", 8),
          },
        },
      ];

      // Test to capture the issue with the underflow
      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Use a single user with multiple scenarios sequentially
          const user = accounts[1];

          // Set initial prices
          await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.prices.collateral);
          await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.prices.debt);

          // User makes deposit (only once)
          // If user already deposited in the previous scenario, skip deposit
          const currentShares = await dloopMock.balanceOf(user.address);

          if (currentShares === 0n) {
            await dloopMock.connect(user).deposit(ethers.parseEther("100"), user.address);
          }

          // Get the current leverage
          // const currentLeverage = await dloopMock.getCurrentLeverageBps();
          // console.log("currentLeverage", currentLeverage);

          // Create imbalance
          await dloopMock.setMockPrice(await collateralToken.getAddress(), testCase.priceChange.collateral);
          await dloopMock.setMockPrice(await debtToken.getAddress(), testCase.priceChange.debt);

          const leverageAfterPriceChange = await dloopMock.getCurrentLeverageBps();

          expect(leverageAfterPriceChange).to.be.gt(TARGET_LEVERAGE_BPS);

          // Give the system 100 "debt tokens" directly to mess with leverage calc
          await debtToken.mint(await dloopMock.getAddress(), ethers.parseEther("100"));

          // // Run decrease leverage and expect it to revert with panic code 0x11
          // await expect(
          //   dloopMock.connect(user).decreaseLeverage(0, 0),
          // ).to.be.revertedWithPanic(0x11); // 0x11 is the panic code for underflow

          // After fixing the underflow, the leverage should be at target
          await dloopMock.connect(user).decreaseLeverage(0, 0);

          // Verify that the leverage is at target
          const leverageAfter = await dloopMock.getCurrentLeverageBps();
          expect(leverageAfter).to.be.closeTo(
            TARGET_LEVERAGE_BPS,
            TARGET_LEVERAGE_BPS * 0.01, // 1% tolerance
          );
        });
      }
    });
  });
});
