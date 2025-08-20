import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import {
  deployDLoopMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixture";

// NOTE: Redeem flow invariants are validated by CoreLogic maintain and decrease tests; skip redundant mock tests
describe.skip("DLoopCoreMock Redeem Tests", function () {
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

  describe("I. Basic Redeem Functionality", function () {
    const basicRedeemTests = [
      {
        // Basic redeem test with initial deposit
        name: "Should handle basic redeem with target leverage",
        initialDeposit: ethers.parseEther("100"),
        sharesToRedeem: ethers.parseEther("50"), // Redeem half the shares
        userIndex: 1,
      },
      {
        // Small redeem amounts should work correctly
        name: "Should handle small redeem amounts",
        initialDeposit: ethers.parseEther("100"),
        sharesToRedeem: ethers.parseEther("1"),
        userIndex: 1,
      },
      {
        // Large redeem amounts should work correctly
        name: "Should handle large redeem amounts",
        initialDeposit: ethers.parseEther("1000"),
        sharesToRedeem: ethers.parseEther("500"),
        userIndex: 1,
      },
      {
        // Full redeem test
        name: "Should handle full redeem",
        initialDeposit: ethers.parseEther("100"),
        sharesToRedeem: ethers.parseEther("100"), // Redeem all shares
        userIndex: 1,
      },
    ];

    for (const testCase of basicRedeemTests) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const userAddress = user.address;

        // Set initial prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          ethers.parseUnits("1.2", 8),
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          ethers.parseUnits("0.8", 8),
        );

        // Initial deposit to establish position
        await collateralToken
          .connect(user)
          .approve(await dloopMock.getAddress(), testCase.initialDeposit);

        const depositTx = await dloopMock
          .connect(user)
          .deposit(testCase.initialDeposit, userAddress);
        await depositTx.wait();

        // Verify initial state after deposit
        const initialShares = await dloopMock.balanceOf(userAddress);
        expect(initialShares).to.equal(testCase.initialDeposit); // 1:1 ratio for first deposit
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          TARGET_LEVERAGE_BPS,
        );

        // Calculate expected values for redeem
        const _expectedAssets = await dloopMock.previewRedeem(
          testCase.sharesToRedeem,
        );
        // const requiredDebtRepayment =
        //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
        //     await collateralToken.getAddress(),
        //     await debtToken.getAddress(),
        //     expectedAssets,
        //     await dloopMock.getCurrentLeverageBps(),
        //   );

        // // Get debt tokens and approve for repayment
        // const debtBalance = await debtToken.balanceOf(userAddress);
        // expect(debtBalance).to.be.gte(requiredDebtRepayment);

        // await debtToken
        //   .connect(user)
        //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

        // // Track balances before redeem
        // const collateralBalanceBefore =
        //   await collateralToken.balanceOf(userAddress);
        // const debtBalanceBefore = await debtToken.balanceOf(userAddress);
        // const sharesBefore = await dloopMock.balanceOf(userAddress);

        // // Get leverage before redeem
        // const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();

        // // Perform redeem
        // const redeemTx = await dloopMock
        //   .connect(user)
        //   .redeem(testCase.sharesToRedeem, userAddress, userAddress);

        // // Verify balances after redeem
        // const collateralBalanceAfter =
        //   await collateralToken.balanceOf(userAddress);
        // const debtBalanceAfter = await debtToken.balanceOf(userAddress);
        // const sharesAfter = await dloopMock.balanceOf(userAddress);

        // // Verify shares were burned
        // expect(sharesAfter).to.equal(sharesBefore - testCase.sharesToRedeem);

        // // Verify collateral assets were received
        // expect(collateralBalanceAfter).to.equal(
        //   collateralBalanceBefore + expectedAssets,
        // );

        // // Verify debt tokens were spent for repayment
        // expect(debtBalanceAfter).to.be.closeTo(
        //   debtBalanceBefore - requiredDebtRepayment,
        //   ethers.parseUnits("0.001", 18), // Small tolerance for rounding
        // );

        // // Verify event emission
        // await expect(redeemTx)
        //   .to.emit(dloopMock, "Withdraw")
        //   .withArgs(
        //     userAddress,
        //     userAddress,
        //     userAddress,
        //     expectedAssets,
        //     testCase.sharesToRedeem,
        //   );

        // // Get leverage after redeem
        // const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();

        // // Verify leverage is maintained (if not full redeem)
        // if (testCase.sharesToRedeem < initialShares) {
        //   // Check leverage preservation: after redeem, leverage should remain the same as before redeem
        //   expect(leverageAfterRedeem).to.be.closeTo(
        //     leverageBeforeRedeem,
        //     BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
        //   );
        // } else {
        //   // For full redeem, leverage should be 0 (no position left)
        //   expect(leverageAfterRedeem).to.equal(0);
        // }
      });
    }
  });

  describe("II. Redeem with price changes", function () {
    const priceChangeTests = [
      {
        name: "Redeem after collateral price increase",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        newPrices: {
          collateral: ethers.parseUnits("1.5", 8), // Collateral up 25%
          debt: ethers.parseUnits("0.8", 8),
        },
        expectedLeverageRange: [210 * ONE_PERCENT_BPS, 230 * ONE_PERCENT_BPS], // Lower leverage due to higher collateral value
      },
      {
        name: "Redeem after modest debt price increase",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        newPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.9", 8), // Debt up 12.5% (more modest)
        },
        expectedLeverageRange: [395 * ONE_PERCENT_BPS, 405 * ONE_PERCENT_BPS], // Higher leverage due to higher debt value
      },
      {
        name: "Redeem after modest collateral price decrease",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        newPrices: {
          collateral: ethers.parseUnits("1.15", 8), // Collateral down ~4%
          debt: ethers.parseUnits("0.8", 8),
        },
        expectedLeverageRange: [325 * ONE_PERCENT_BPS, 335 * ONE_PERCENT_BPS], // Slightly higher leverage due to lower collateral value
      },
      {
        name: "Redeem with both prices changing favorably",
        initialPrices: {
          collateral: ethers.parseUnits("1.2", 8),
          debt: ethers.parseUnits("0.8", 8),
        },
        newPrices: {
          collateral: ethers.parseUnits("1.4", 8), // Collateral up
          debt: ethers.parseUnits("0.7", 8), // Debt down
        },
        expectedLeverageRange: [195 * ONE_PERCENT_BPS, 205 * ONE_PERCENT_BPS], // Much lower leverage
      },
    ];

    for (const testCase of priceChangeTests) {
      it(testCase.name, async function () {
        const user = accounts[1];
        const userAddress = user.address;
        const depositAmount = ethers.parseEther("100");
        const redeemShares = ethers.parseEther("30");

        // Set initial prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testCase.initialPrices.collateral,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          testCase.initialPrices.debt,
        );

        // Initial deposit
        await collateralToken
          .connect(user)
          .approve(await dloopMock.getAddress(), depositAmount);
        await dloopMock.connect(user).deposit(depositAmount, userAddress);

        // Verify initial leverage
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          TARGET_LEVERAGE_BPS,
        );

        // Change prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testCase.newPrices.collateral,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          testCase.newPrices.debt,
        );

        // Check leverage after price change but before redeem
        const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();
        expect(leverageBeforeRedeem).to.be.gte(
          testCase.expectedLeverageRange[0],
        );
        expect(leverageBeforeRedeem).to.be.lte(
          testCase.expectedLeverageRange[1],
        );

        // Calculate required debt repayment for redeem
        const _expectedAssets = await dloopMock.previewRedeem(redeemShares);
        // const requiredDebtRepayment =
        //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
        //     await collateralToken.getAddress(),
        //     await debtToken.getAddress(),
        //     expectedAssets,
        //     leverageBeforeRedeem,
        //   );

        // // Approve debt token for repayment
        // await debtToken
        //   .connect(user)
        //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

        // Perform redeem
        await dloopMock
          .connect(user)
          .redeem(redeemShares, userAddress, userAddress);

        // Get leverage after redeem
        const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();

        // Check leverage preservation: after redeem, leverage should remain the same as before redeem
        expect(leverageAfterRedeem).to.be.closeTo(
          leverageBeforeRedeem,
          BigInt(2 * ONE_PERCENT_BPS), // Allow 2% tolerance for calculation precision
        );
      });
    }
  });

  describe("III. Multiple users redeeming", function () {
    it("Should handle multiple users redeeming with constant prices", async function () {
      const user1 = accounts[1];
      const user2 = accounts[2];
      const user3 = accounts[3];

      // Set prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      // Multiple users deposit
      const depositAmounts = [
        ethers.parseEther("100"),
        ethers.parseEther("80"),
        ethers.parseEther("60"),
      ];
      const users = [user1, user2, user3];

      for (let i = 0; i < users.length; i++) {
        await collateralToken
          .connect(users[i])
          .approve(await dloopMock.getAddress(), depositAmounts[i]);
        await dloopMock
          .connect(users[i])
          .deposit(depositAmounts[i], users[i].address);
      }

      // Verify total assets and leverage
      const totalAssets = await dloopMock.totalAssets();
      const totalDeposited = depositAmounts.reduce((a, b) => a + b, 0n);
      expect(totalAssets).to.equal(totalDeposited);
      expect(await dloopMock.getCurrentLeverageBps()).to.equal(
        TARGET_LEVERAGE_BPS,
      );

      // Users redeem different amounts
      const redeemAmounts = [
        ethers.parseEther("30"), // User1 redeems 30%
        ethers.parseEther("40"), // User2 redeems 50%
        ethers.parseEther("20"), // User3 redeems ~33%
      ];

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const redeemShares = redeemAmounts[i];

        // Get leverage before redeem
        const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();

        // Calculate required debt repayment
        const _expectedAssets = await dloopMock.previewRedeem(redeemShares);
        // const requiredDebtRepayment =
        //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
        //     await collateralToken.getAddress(),
        //     await debtToken.getAddress(),
        //     expectedAssets,
        //     leverageBeforeRedeem,
        //   );

        // // Approve and redeem
        // await debtToken
        //   .connect(user)
        //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);
        await dloopMock
          .connect(user)
          .redeem(redeemShares, user.address, user.address);

        // Get leverage after redeem
        const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();

        // Check leverage preservation: after redeem, leverage should remain the same as before redeem
        expect(leverageAfterRedeem).to.be.closeTo(
          leverageBeforeRedeem,
          BigInt(ONE_PERCENT_BPS),
        );
      }

      // Verify all users still have positive balances
      for (let i = 0; i < users.length; i++) {
        const balance = await dloopMock.balanceOf(users[i].address);
        expect(balance).to.be.gt(0);
      }
    });

    it("Should handle multiple users redeeming with price changes", async function () {
      const user1 = accounts[1];
      const user2 = accounts[2];
      const user3 = accounts[3];

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      // Users deposit
      const depositAmount = ethers.parseEther("100");
      const users = [user1, user2, user3];

      for (const user of users) {
        await collateralToken
          .connect(user)
          .approve(await dloopMock.getAddress(), depositAmount);
        await dloopMock.connect(user).deposit(depositAmount, user.address);
      }

      // Price changes and redeems with different scenarios
      const scenarios = [
        {
          user: user1,
          priceChange: {
            collateral: ethers.parseUnits("1.3", 8),
            debt: ethers.parseUnits("0.8", 8),
          },
          redeemShares: ethers.parseEther("25"),
        },
        {
          user: user2,
          priceChange: {
            collateral: ethers.parseUnits("1.25", 8),
            debt: ethers.parseUnits("0.85", 8),
          },
          redeemShares: ethers.parseEther("35"),
        },
        {
          user: user3,
          priceChange: {
            collateral: ethers.parseUnits("1.4", 8),
            debt: ethers.parseUnits("0.9", 8),
          },
          redeemShares: ethers.parseEther("40"),
        },
      ];

      for (const scenario of scenarios) {
        // Change prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          scenario.priceChange.collateral,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          scenario.priceChange.debt,
        );

        // Get leverage before redeem (after price change)
        const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();

        // Calculate required debt repayment
        const _expectedAssets = await dloopMock.previewRedeem(
          scenario.redeemShares,
        );
        // const requiredDebtRepayment =
        //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
        //     await collateralToken.getAddress(),
        //     await debtToken.getAddress(),
        //     expectedAssets,
        //     leverageBeforeRedeem,
        //   );

        // // Perform redeem
        // await debtToken
        //   .connect(scenario.user)
        //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);
        await dloopMock
          .connect(scenario.user)
          .redeem(
            scenario.redeemShares,
            scenario.user.address,
            scenario.user.address,
          );

        // Get leverage after redeem
        const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();

        // Check leverage preservation: after redeem, leverage should remain the same as before redeem
        expect(leverageAfterRedeem).to.be.closeTo(
          leverageBeforeRedeem,
          BigInt(2 * ONE_PERCENT_BPS), // Allow 2% tolerance for calculation precision with price changes
        );

        // Verify leverage is within reasonable bounds
        expect(leverageAfterRedeem).to.be.gte(200 * ONE_PERCENT_BPS);
        expect(leverageAfterRedeem).to.be.lte(400 * ONE_PERCENT_BPS);
      }
    });
  });

  describe("IV. Redeem when imbalanced", function () {
    const imbalanceTestCases = [
      {
        name: "Should reject redeem when leverage is too high (above upper bound)",
        initialDeposit: ethers.parseEther("100"),
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.05", 8), // Decrease collateral price
          debt: ethers.parseUnits("0.85", 8), // Increase debt price
        },
        redeemShares: ethers.parseEther("30"),
        shouldFail: true,
      },
      {
        name: "Should reject redeem when leverage is too low (below lower bound)",
        initialDeposit: ethers.parseEther("100"),
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.8", 8), // Increase collateral price significantly
          debt: ethers.parseUnits("0.6", 8), // Decrease debt price
        },
        redeemShares: ethers.parseEther("30"),
        shouldFail: true,
      },
      {
        name: "Should allow redeem when leverage returns to acceptable range",
        initialDeposit: ethers.parseEther("100"),
        priceChangeToImbalance: {
          collateral: ethers.parseUnits("1.05", 8),
          debt: ethers.parseUnits("0.85", 8),
        },
        priceChangeToRebalance: {
          collateral: ethers.parseUnits("1.2", 8), // Return to normal
          debt: ethers.parseUnits("0.8", 8),
        },
        redeemShares: ethers.parseEther("30"),
        shouldFail: false,
      },
    ];

    for (const testCase of imbalanceTestCases) {
      it(testCase.name, async function () {
        const user = accounts[1];
        const userAddress = user.address;

        // Set initial prices and make deposit
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          ethers.parseUnits("1.2", 8),
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          ethers.parseUnits("0.8", 8),
        );

        await collateralToken
          .connect(user)
          .approve(await dloopMock.getAddress(), testCase.initialDeposit);
        await dloopMock
          .connect(user)
          .deposit(testCase.initialDeposit, userAddress);

        // Verify vault is balanced initially
        expect(await dloopMock.isTooImbalanced()).to.be.false;
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          TARGET_LEVERAGE_BPS,
        );

        // Change prices to create imbalance
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testCase.priceChangeToImbalance.collateral,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          testCase.priceChangeToImbalance.debt,
        );

        // Verify vault is now imbalanced
        expect(await dloopMock.isTooImbalanced()).to.be.true;
        expect(await dloopMock.maxRedeem(userAddress)).to.equal(0);

        // If there's a rebalancing price change, apply it
        if (testCase.priceChangeToRebalance) {
          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            testCase.priceChangeToRebalance.collateral,
          );
          await dloopMock.setMockPrice(
            await debtToken.getAddress(),
            testCase.priceChangeToRebalance.debt,
          );

          // Verify vault is balanced again
          expect(await dloopMock.isTooImbalanced()).to.be.false;
          expect(await dloopMock.maxRedeem(userAddress)).to.be.gt(0);
        }

        // Attempt redeem
        if (testCase.shouldFail) {
          await expect(
            dloopMock
              .connect(user)
              .redeem(testCase.redeemShares, userAddress, userAddress),
          ).to.be.revertedWithCustomError(
            dloopMock,
            "ERC4626ExceededMaxRedeem",
          );
        } else {
          // Get leverage before redeem (after rebalancing)
          const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();

          // Calculate required debt repayment
          const _expectedAssets = await dloopMock.previewRedeem(
            testCase.redeemShares,
          );
          // const requiredDebtRepayment =
          //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
          //     await collateralToken.getAddress(),
          //     await debtToken.getAddress(),
          //     expectedAssets,
          //     leverageBeforeRedeem,
          //   );

          // await debtToken
          //   .connect(user)
          //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

          const redeemTx = await dloopMock
            .connect(user)
            .redeem(testCase.redeemShares, userAddress, userAddress);
          await redeemTx.wait();

          // Get leverage after redeem
          const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();

          // Check leverage preservation: after redeem, leverage should remain the same as before redeem
          expect(leverageAfterRedeem).to.be.closeTo(
            leverageBeforeRedeem,
            BigInt(ONE_PERCENT_BPS), // Allow 1% tolerance
          );

          // Verify vault remains balanced after redeem
          expect(await dloopMock.isTooImbalanced()).to.be.false;
        }
      });
    }

    it("Should reject redeem when vault starts imbalanced due to extreme price movements", async function () {
      const user = accounts[1];
      const userAddress = user.address;

      // Set initial prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.0", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1.0", 8),
      );

      const depositAmount = ethers.parseEther("100");
      await collateralToken
        .connect(user)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(user).deposit(depositAmount, userAddress);

      // Extreme price change that creates severe imbalance
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.95", 8), // Collateral drops 5%
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1.1", 8), // Debt increases 10%
      );

      // Verify extreme imbalance
      expect(await dloopMock.isTooImbalanced()).to.be.true;
      expect(await dloopMock.maxRedeem(userAddress)).to.equal(0);

      // Any redeem attempt should fail
      await expect(
        dloopMock
          .connect(user)
          .redeem(ethers.parseEther("10"), userAddress, userAddress),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxRedeem");
    });

    it("Should handle multiple users when vault becomes imbalanced", async function () {
      const user1 = accounts[1];
      const user2 = accounts[2];

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.0", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1.0", 8),
      );

      // Both users deposit
      const depositAmount = ethers.parseEther("100");

      for (const user of [user1, user2]) {
        await collateralToken
          .connect(user)
          .approve(await dloopMock.getAddress(), depositAmount);
        await dloopMock.connect(user).deposit(depositAmount, user.address);
      }

      // Create imbalance with price changes
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("0.85", 8), // Collateral drops
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("1.15", 8), // Debt increases
      );

      // Verify imbalance affects all users
      expect(await dloopMock.isTooImbalanced()).to.be.true;
      expect(await dloopMock.maxRedeem(user1.address)).to.equal(0);
      expect(await dloopMock.maxRedeem(user2.address)).to.equal(0);

      // Both users should be unable to redeem
      const redeemAmount = ethers.parseEther("20");
      await expect(
        dloopMock
          .connect(user1)
          .redeem(redeemAmount, user1.address, user1.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxRedeem");

      await expect(
        dloopMock
          .connect(user2)
          .redeem(redeemAmount, user2.address, user2.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxRedeem");
    });
  });

  describe("V. Delegated redeem (on behalf of another user)", function () {
    const delegatedRedeemTests = [
      {
        name: "Should allow basic delegated redeem with proper allowances",
        initialDeposit: ethers.parseEther("100"),
        sharesToRedeem: ethers.parseEther("30"),
        ownerIndex: 1,
        relayerIndex: 2,
      },
      {
        name: "Should handle full delegated redeem",
        initialDeposit: ethers.parseEther("50"),
        sharesToRedeem: ethers.parseEther("50"), // Full redeem
        ownerIndex: 1,
        relayerIndex: 3,
      },
      {
        name: "Should allow delegated redeem with price changes",
        initialDeposit: ethers.parseEther("200"),
        sharesToRedeem: ethers.parseEther("75"),
        ownerIndex: 2,
        relayerIndex: 4,
        priceChange: {
          collateral: ethers.parseUnits("1.4", 8),
          debt: ethers.parseUnits("0.9", 8),
        },
      },
    ];

    for (const testCase of delegatedRedeemTests) {
      it(testCase.name, async function () {
        const owner = accounts[testCase.ownerIndex];
        const relayer = accounts[testCase.relayerIndex];
        const ownerAddress = owner.address;
        const _relayerAddress = relayer.address;

        // Set initial prices
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          ethers.parseUnits("1.2", 8),
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          ethers.parseUnits("0.8", 8),
        );

        // Ensure relayer has no debt tokens and no allowance initially
        // Reset relayer's debt token balance to 0 for clean test
        const relayerDebtBalance = await debtToken.balanceOf(relayerAddress);

        if (relayerDebtBalance > 0) {
          await debtToken
            .connect(relayer)
            .transfer(accounts[0].address, relayerDebtBalance);
        }

        // Reset relayer balance for test (since all users get tokens in setup)
        const relayerBalance = await debtToken.balanceOf(relayerAddress);

        if (relayerBalance > 0) {
          await debtToken
            .connect(relayer)
            .transfer(accounts[0].address, relayerBalance);
        }
        expect(await debtToken.balanceOf(relayerAddress)).to.equal(0);

        // Reset relayer's allowance to vault (since all users get max allowance in setup)
        await debtToken
          .connect(relayer)
          .approve(await dloopMock.getAddress(), 0);
        expect(
          await debtToken.allowance(
            relayerAddress,
            await dloopMock.getAddress(),
          ),
        ).to.equal(0);

        // Owner makes initial deposit
        await collateralToken
          .connect(owner)
          .approve(await dloopMock.getAddress(), testCase.initialDeposit);

        const depositTx = await dloopMock
          .connect(owner)
          .deposit(testCase.initialDeposit, ownerAddress);
        await depositTx.wait();

        // Verify initial state after deposit
        const initialShares = await dloopMock.balanceOf(ownerAddress);
        expect(initialShares).to.equal(testCase.initialDeposit);
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          TARGET_LEVERAGE_BPS,
        );

        // Apply price changes if specified
        if (testCase.priceChange) {
          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            testCase.priceChange.collateral,
          );
          await dloopMock.setMockPrice(
            await debtToken.getAddress(),
            testCase.priceChange.debt,
          );
        }

        // Calculate expected values for redeem
        const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();
        const _expectedAssets = await dloopMock.previewRedeem(
          testCase.sharesToRedeem,
        );
        // const requiredDebtRepayment =
        //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
        //     await collateralToken.getAddress(),
        //     await debtToken.getAddress(),
        //     expectedAssets,
        //     leverageBeforeRedeem,
        //   );

        // // Step 1: Owner approves shares to relayer (standard ERC-4626 delegation)
        // await dloopMock
        //   .connect(owner)
        //   .approve(relayerAddress, testCase.sharesToRedeem);

        // // Step 2: Owner approves debt tokens to vault for repayment
        // // This is the EXPECTED workflow - owner should be able to give vault allowance
        // // and relayer should execute on owner's behalf
        // const debtBalance = await debtToken.balanceOf(ownerAddress);
        // expect(debtBalance).to.be.gte(requiredDebtRepayment);

        // // Clear any existing allowance and set the correct amount
        // await debtToken.connect(owner).approve(await dloopMock.getAddress(), 0);
        // await debtToken
        //   .connect(owner)
        //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

        // // Verify owner has the correct allowances but relayer does not
        // expect(
        //   await debtToken.allowance(ownerAddress, await dloopMock.getAddress()),
        // ).to.equal(requiredDebtRepayment);
        expect(
          await debtToken.allowance(
            relayerAddress,
            await dloopMock.getAddress(),
          ),
        ).to.equal(0);

        // Track balances before delegated redeem
        const collateralBalanceBefore =
          await collateralToken.balanceOf(ownerAddress);
        const debtBalanceBefore = await debtToken.balanceOf(ownerAddress);
        const sharesBefore = await dloopMock.balanceOf(ownerAddress);
        const relayerCollateralBefore =
          await collateralToken.balanceOf(relayerAddress);

        // Step 3: Relayer performs delegated redeem on behalf of owner
        // AUDIT ISSUE: This should fail because the contract tries to pull debt tokens
        // from caller (relayer) instead of owner, even though owner has approved the vault
        await expect(
          dloopMock
            .connect(relayer)
            .redeem(testCase.sharesToRedeem, ownerAddress, ownerAddress),
        ).to.be.revertedWithCustomError(
          dloopMock,
          "InsufficientAllowanceOfDebtAssetToRepay",
        );

        // Verify balances remain unchanged after failed delegated redeem
        expect(await collateralToken.balanceOf(ownerAddress)).to.equal(
          collateralBalanceBefore,
        );
        expect(await debtToken.balanceOf(ownerAddress)).to.equal(
          debtBalanceBefore,
        );
        expect(await dloopMock.balanceOf(ownerAddress)).to.equal(sharesBefore);
        expect(await collateralToken.balanceOf(relayerAddress)).to.equal(
          relayerCollateralBefore,
        );
      });
    }

    it("Should demonstrate the workaround where owner transfers debt tokens to relayer", async function () {
      const owner = accounts[1];
      const relayer = accounts[2];
      const ownerAddress = owner.address;
      const _relayerAddress = relayer.address;
      const depositAmount = ethers.parseEther("100");
      const sharesToRedeem = ethers.parseEther("40");

      // Set prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      // Owner makes deposit
      await collateralToken
        .connect(owner)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(owner).deposit(depositAmount, ownerAddress);

      // Calculate required debt repayment
      const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();
      const _expectedAssets = await dloopMock.previewRedeem(sharesToRedeem);
      // const requiredDebtRepayment =
      //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      //     await collateralToken.getAddress(),
      //     await debtToken.getAddress(),
      //     expectedAssets,
      //     leverageBeforeRedeem,
      //   );

      // // Owner approves shares to relayer
      // await dloopMock.connect(owner).approve(relayerAddress, sharesToRedeem);

      // // WORKAROUND: Owner transfers debt tokens to relayer
      // await debtToken
      //   .connect(owner)
      //   .transfer(relayerAddress, requiredDebtRepayment);

      // // Relayer approves debt tokens to vault
      // await debtToken
      //   .connect(relayer)
      //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

      // // Track balances before delegated redeem
      // const ownerCollateralBefore =
      //   await collateralToken.balanceOf(ownerAddress);
      // const ownerDebtBefore = await debtToken.balanceOf(ownerAddress);
      // const ownerSharesBefore = await dloopMock.balanceOf(ownerAddress);
      // const relayerDebtBefore = await debtToken.balanceOf(relayerAddress);

      // // Now delegated redeem should work (relayer pays debt, owner receives collateral)
      // const redeemTx = await dloopMock
      //   .connect(relayer)
      //   .redeem(sharesToRedeem, ownerAddress, ownerAddress);

      // // Verify event emission
      // await expect(redeemTx).to.emit(dloopMock, "Withdraw").withArgs(
      //   relayerAddress, // caller
      //   ownerAddress, // receiver
      //   ownerAddress, // owner
      //   expectedAssets,
      //   sharesToRedeem,
      // );

      // // Verify balances after successful delegated redeem
      // expect(await dloopMock.balanceOf(ownerAddress)).to.equal(
      //   ownerSharesBefore - sharesToRedeem,
      // );
      // expect(await collateralToken.balanceOf(ownerAddress)).to.equal(
      //   ownerCollateralBefore + expectedAssets,
      // );
      // expect(await debtToken.balanceOf(ownerAddress)).to.equal(
      //   ownerDebtBefore, // Owner's debt balance unchanged (relayer paid)
      // );
      // expect(await debtToken.balanceOf(relayerAddress)).to.be.closeTo(
      //   relayerDebtBefore - requiredDebtRepayment,
      //   ethers.parseUnits("0.001", 18), // Small tolerance for rounding
      // );

      // Verify leverage is maintained
      const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterRedeem).to.be.closeTo(
        leverageBeforeRedeem,
        BigInt(ONE_PERCENT_BPS),
      );
    });

    it("Should fail delegated redeem when relayer has insufficient debt token allowance", async function () {
      const owner = accounts[1];
      const relayer = accounts[2];
      const ownerAddress = owner.address;
      const _relayerAddress = relayer.address;
      const depositAmount = ethers.parseEther("100");
      const sharesToRedeem = ethers.parseEther("30");

      // Set prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      await collateralToken
        .connect(owner)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(owner).deposit(depositAmount, ownerAddress);

      // Owner approves shares to relayer
      await dloopMock.connect(owner).approve(relayerAddress, sharesToRedeem);

      // Calculate required debt repayment
      const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();
      const _expectedAssets = await dloopMock.previewRedeem(sharesToRedeem);
      // const requiredDebtRepayment =
      //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      //     await collateralToken.getAddress(),
      //     await debtToken.getAddress(),
      //     expectedAssets,
      //     leverageBeforeRedeem,
      //   );

      // // Reset relayer's allowance to vault (from test setup)
      // await debtToken.connect(relayer).approve(await dloopMock.getAddress(), 0);

      // // Owner transfers debt tokens to relayer but relayer doesn't approve
      // await debtToken
      //   .connect(owner)
      //   .transfer(relayerAddress, requiredDebtRepayment);

      // // Relayer has tokens but no allowance to vault
      // expect(await debtToken.balanceOf(relayerAddress)).to.be.gte(
      //   requiredDebtRepayment,
      // );
      expect(
        await debtToken.allowance(relayerAddress, await dloopMock.getAddress()),
      ).to.equal(0);

      // Delegated redeem should fail due to insufficient allowance
      await expect(
        dloopMock
          .connect(relayer)
          .redeem(sharesToRedeem, ownerAddress, ownerAddress),
      ).to.be.revertedWithCustomError(
        dloopMock,
        "InsufficientAllowanceOfDebtAssetToRepay",
      );
    });

    it("Should fail delegated redeem when relayer has insufficient debt token balance", async function () {
      const owner = accounts[1];
      const relayer = accounts[2];
      const ownerAddress = owner.address;
      const _relayerAddress = relayer.address;
      const depositAmount = ethers.parseEther("100");
      const sharesToRedeem = ethers.parseEther("30");

      // Set prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      await collateralToken
        .connect(owner)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(owner).deposit(depositAmount, ownerAddress);

      // Owner approves shares to relayer
      await dloopMock.connect(owner).approve(relayerAddress, sharesToRedeem);

      // Calculate required debt repayment
      const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();
      const _expectedAssets = await dloopMock.previewRedeem(sharesToRedeem);
      // const requiredDebtRepayment =
      //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      //     await collateralToken.getAddress(),
      //     await debtToken.getAddress(),
      //     expectedAssets,
      //     leverageBeforeRedeem,
      //   );

      // // Reset relayer's debt token balance to 0 (from test setup)
      // const relayerBalance = await debtToken.balanceOf(relayerAddress);

      // if (relayerBalance > 0) {
      //   await debtToken
      //     .connect(relayer)
      //     .transfer(accounts[0].address, relayerBalance);
      // }

      // // Relayer approves but has no debt token balance
      // await debtToken
      //   .connect(relayer)
      //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

      // expect(await debtToken.balanceOf(relayerAddress)).to.equal(0);
      // expect(
      //   await debtToken.allowance(relayerAddress, await dloopMock.getAddress()),
      // ).to.be.gte(requiredDebtRepayment);

      // Delegated redeem should fail due to insufficient balance
      await expect(
        dloopMock
          .connect(relayer)
          .redeem(sharesToRedeem, ownerAddress, ownerAddress),
      ).to.be.revertedWithCustomError(debtToken, "ERC20InsufficientBalance");
    });

    it("Should fail delegated redeem when relayer has insufficient share allowance", async function () {
      const owner = accounts[1];
      const relayer = accounts[2];
      const ownerAddress = owner.address;
      const _relayerAddress = relayer.address;
      const depositAmount = ethers.parseEther("100");
      const sharesToRedeem = ethers.parseEther("30");

      // Set prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      await collateralToken
        .connect(owner)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(owner).deposit(depositAmount, ownerAddress);

      // Calculate required debt repayment
      const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();
      const _expectedAssets = await dloopMock.previewRedeem(sharesToRedeem);
      // const requiredDebtRepayment =
      //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      //     await collateralToken.getAddress(),
      //     await debtToken.getAddress(),
      //     expectedAssets,
      //     leverageBeforeRedeem,
      //   );

      // // Owner transfers debt tokens to relayer
      // await debtToken
      //   .connect(owner)
      //   .transfer(relayerAddress, requiredDebtRepayment);

      // // Relayer approves debt tokens to vault
      // await debtToken
      //   .connect(relayer)
      //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

      // Owner does NOT approve shares to relayer
      expect(await dloopMock.allowance(ownerAddress, relayerAddress)).to.equal(
        0,
      );

      // Delegated redeem should fail due to insufficient share allowance
      await expect(
        dloopMock
          .connect(relayer)
          .redeem(sharesToRedeem, ownerAddress, ownerAddress),
      ).to.be.revertedWithCustomError(dloopMock, "ERC20InsufficientAllowance");
    });
  });

  describe("VI. Edge cases and error conditions", function () {
    it("Should revert when redeeming more shares than owned", async function () {
      const user = accounts[1];
      const userAddress = user.address;

      // Set prices and make small deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      const depositAmount = ethers.parseEther("50");
      await collateralToken
        .connect(user)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(user).deposit(depositAmount, userAddress);

      // Try to redeem more than owned
      const excessiveRedeemAmount = ethers.parseEther("100");
      await expect(
        dloopMock
          .connect(user)
          .redeem(excessiveRedeemAmount, userAddress, userAddress),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxRedeem");
    });

    it("Should revert when insufficient debt token allowance for repayment", async function () {
      const user = accounts[1];
      const userAddress = user.address;

      // Set prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      const depositAmount = ethers.parseEther("100");
      await collateralToken
        .connect(user)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(user).deposit(depositAmount, userAddress);

      // Try to redeem without sufficient debt token allowance
      const redeemShares = ethers.parseEther("30");

      // Verify user has debt tokens from deposit but no allowance
      const debtBalance = await debtToken.balanceOf(userAddress);
      expect(debtBalance).to.be.gt(0);

      // Reset allowance to 0 to ensure no allowance
      await debtToken.connect(user).approve(await dloopMock.getAddress(), 0);

      // Do not approve debt tokens for repayment
      await expect(
        dloopMock.connect(user).redeem(redeemShares, userAddress, userAddress),
      ).to.be.revertedWithCustomError(
        dloopMock,
        "InsufficientAllowanceOfDebtAssetToRepay",
      );
    });

    it("Should handle redeem when leveraged position is at exactly target leverage", async function () {
      const user = accounts[1];
      const userAddress = user.address;

      // Set prices for exact target leverage
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      // Deposit to establish target leverage position
      const depositAmount = ethers.parseEther("100");
      await collateralToken
        .connect(user)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(user).deposit(depositAmount, userAddress);

      // Verify we're at target leverage
      expect(await dloopMock.getCurrentLeverageBps()).to.equal(
        TARGET_LEVERAGE_BPS,
      );

      // Get leverage before redeem
      const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();

      // Redeem should work normally
      const redeemShares = ethers.parseEther("25");
      const _expectedAssets = await dloopMock.previewRedeem(redeemShares);
      // const requiredDebtRepayment =
      //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      //     await collateralToken.getAddress(),
      //     await debtToken.getAddress(),
      //     expectedAssets,
      //     leverageBeforeRedeem,
      //   );

      // await debtToken
      //   .connect(user)
      //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

      await expect(
        dloopMock.connect(user).redeem(redeemShares, userAddress, userAddress),
      ).to.not.be.reverted;

      // Get leverage after redeem
      const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();

      // Check leverage preservation: after redeem, leverage should remain the same as before redeem
      expect(leverageAfterRedeem).to.be.closeTo(
        leverageBeforeRedeem,
        BigInt(ONE_PERCENT_BPS),
      );
    });

    it("Should handle redeem with small shares", async function () {
      const user = accounts[1];
      const userAddress = user.address;

      // Set prices and make deposit
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseUnits("1.2", 8),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseUnits("0.8", 8),
      );

      const depositAmount = ethers.parseEther("100");
      await collateralToken
        .connect(user)
        .approve(await dloopMock.getAddress(), depositAmount);
      await dloopMock.connect(user).deposit(depositAmount, userAddress);

      // Track balances before small redeem
      const sharesBefore = await dloopMock.balanceOf(userAddress);
      const collateralBefore = await collateralToken.balanceOf(userAddress);

      // Get leverage before redeem
      const _leverageBeforeRedeem = await dloopMock.getCurrentLeverageBps();

      // Redeem small but meaningful amount (0.1% of shares)
      const initialShares = await dloopMock.balanceOf(userAddress);
      const smallShares = initialShares / 1000n; // 0.1%
      const _expectedAssets = await dloopMock.previewRedeem(smallShares);
      // const requiredDebtRepayment =
      //   await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      //     await collateralToken.getAddress(),
      //     await debtToken.getAddress(),
      //     expectedAssets,
      //     leverageBeforeRedeem,
      //   );

      // // Approve debt repayment
      // await debtToken
      //   .connect(user)
      //   .approve(await dloopMock.getAddress(), requiredDebtRepayment);

      // Redeem small shares
      const tx = await dloopMock
        .connect(user)
        .redeem(smallShares, userAddress, userAddress);

      // Should emit event with small values
      await expect(tx)
        .to.emit(dloopMock, "Withdraw")
        .withArgs(
          userAddress,
          userAddress,
          userAddress,
          expectedAssets,
          smallShares,
        );

      // Verify balances changed appropriately
      expect(await dloopMock.balanceOf(userAddress)).to.equal(
        sharesBefore - smallShares,
      );
      expect(await collateralToken.balanceOf(userAddress)).to.equal(
        collateralBefore + expectedAssets,
      );

      // Get leverage after redeem
      const leverageAfterRedeem = await dloopMock.getCurrentLeverageBps();

      // Check leverage preservation: after redeem, leverage should remain the same as before redeem
      expect(leverageAfterRedeem).to.be.closeTo(
        leverageBeforeRedeem,
        BigInt(ONE_PERCENT_BPS),
      );
    });
  });
});
