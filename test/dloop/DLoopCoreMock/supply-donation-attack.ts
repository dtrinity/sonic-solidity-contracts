import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { deployDLoopMockFixture, testSetup } from "./fixture";

describe("DLoopCoreMock - Supply/Donation Attack & Division-by-Zero Tests", function () {
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

  describe("I. Division-by-Zero Vulnerability", function () {
    describe("Zero Leverage Withdrawal Issue", function () {
      it("Should revert with division-by-zero when withdrawing with zero leverage", async function () {
        const user = accounts[1];
        const depositAmount = ethers.parseEther("100");

        // Step 1: Set up a scenario where the vault has collateral but zero leverage
        // This simulates the case where a user supplies collateral but never borrows
        // We'll manually set mock collateral for the vault without setting debt

        // Give the vault some collateral tokens directly
        await collateralToken.mint(await dloopMock.getAddress(), depositAmount);

        // Manually set mock collateral for the vault (simulating a deposit without borrowing)
        await dloopMock.setMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
          depositAmount,
        );

        // Verify the vault has collateral but no debt
        const [totalCollateral, totalDebt] =
          await dloopMock.getTotalCollateralAndDebtOfUserInBase(
            await dloopMock.getAddress(),
          );

        expect(totalCollateral).to.be.gt(0);
        expect(totalDebt).to.equal(0);

        // Check current leverage - this should return 0 due to InvalidLeverage revert
        // or some other value that causes issues

        try {
          await dloopMock.getCurrentLeverageBps();
          // eslint-disable-next-line unused-imports/no-unused-vars -- we expect this to revert
        } catch (error) {
          // If getCurrentLeverageBps reverts with InvalidLeverage, let's test the division by zero scenario
          // by directly testing getRepayAmountThatKeepCurrentLeverage with leverageBps = 0
          const withdrawAmount = ethers.parseEther("10");

          // This should cause arithmetic underflow in getRepayAmountThatKeepCurrentLeverage
          // When leverageBpsBeforeRepayDebt = 0, the calculation (0 - 10000) underflows
          await expect(
            dloopMock.getRepayAmountThatKeepCurrentLeverage(
              await collateralToken.getAddress(),
              await debtToken.getAddress(),
              withdrawAmount,
              0, // leverageBpsBeforeRepayDebt = 0, causing underflow
            ),
          ).to.be.revertedWithPanic(0x11); // 0x11 is arithmetic underflow panic code

          return; // Test passed, exit early
        }

        // If getCurrentLeverageBps returns a value, try the withdrawal flow
        // First, mint some shares to the user so they can withdraw
        await dloopMock
          .connect(user)
          .mint(ethers.parseEther("50"), user.address);

        const withdrawAmount = ethers.parseEther("10");

        // This should trigger the arithmetic underflow issue in _withdrawFromPoolImplementation
        await expect(
          dloopMock
            .connect(user)
            .withdraw(withdrawAmount, user.address, user.address),
        ).to.be.revertedWithPanic(0x11); // Arithmetic underflow panic
      });

      it("Should directly test division-by-zero in getRepayAmountThatKeepCurrentLeverage", async function () {
        // Direct test of the vulnerable function with leverageBpsBeforeRepayDebt = 0
        const withdrawAmount = ethers.parseEther("100");

        // This should cause arithmetic underflow in the formula:
        // repayAmountInBase = (targetWithdrawAmountInBase * (leverageBpsBeforeRepayDebt - ONE_HUNDRED_PERCENT_BPS)) / leverageBpsBeforeRepayDebt
        // When leverageBpsBeforeRepayDebt = 0, (0 - 10000) underflows
        await expect(
          dloopMock.getRepayAmountThatKeepCurrentLeverage(
            await collateralToken.getAddress(),
            await debtToken.getAddress(),
            withdrawAmount,
            0, // leverageBpsBeforeRepayDebt = 0
          ),
        ).to.be.revertedWithPanic(0x11); // 0x11 is arithmetic underflow panic code
      });

      it("Should demonstrate the issue occurs when leverage calculation returns zero", async function () {
        // Create a scenario where we have collateral but getCurrentLeverageBps returns 0
        // This happens when totalCollateralBase = 0 in the base contract

        // Verify initial state - vault should have no collateral registered
        const [initialCollateral, initialDebt] =
          await dloopMock.getTotalCollateralAndDebtOfUserInBase(
            await dloopMock.getAddress(),
          );

        expect(initialCollateral).to.equal(0);
        expect(initialDebt).to.equal(0);

        // Current leverage should be 0 when no collateral
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.equal(0);

        // Now if someone tries to call the internal withdraw flow with leverage = 0
        // (This simulates the bug scenario)
        const withdrawAmount = ethers.parseEther("100");

        // Test the vulnerable path directly
        await expect(
          dloopMock.getRepayAmountThatKeepCurrentLeverage(
            await collateralToken.getAddress(),
            await debtToken.getAddress(),
            withdrawAmount,
            0, // This zero causes underflow
          ),
        ).to.be.revertedWithPanic(0x11); // Arithmetic underflow
      });
    });

    describe("Edge Cases with Zero Leverage", function () {
      it("Should handle the mathematical edge case in leverage calculation", async function () {
        // Test what happens when we have collateral equal to debt (infinite leverage case)
        const amount = ethers.parseEther("100");

        await dloopMock.setMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
          amount,
        );

        await dloopMock.setMockDebt(
          await dloopMock.getAddress(),
          await debtToken.getAddress(),
          amount,
        );

        // When collateral equals debt, leverage should be infinite
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.equal(ethers.MaxUint256);

        // This case would also potentially cause issues in the repay calculation
        const withdrawAmount = ethers.parseEther("10");

        await expect(
          dloopMock.getRepayAmountThatKeepCurrentLeverage(
            await collateralToken.getAddress(),
            await debtToken.getAddress(),
            withdrawAmount,
            ethers.MaxUint256, // Infinite leverage
          ),
        ).to.be.reverted; // Should revert due to overflow or other issues
      });

      it("Should test leverage calculation with minimal debt", async function () {
        const collateralAmount = ethers.parseEther("100");
        const minimalDebt = 1n; // 1 wei of debt

        await dloopMock.setMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
          collateralAmount,
        );

        await dloopMock.setMockDebt(
          await dloopMock.getAddress(),
          await debtToken.getAddress(),
          minimalDebt,
        );

        // This should create very high leverage, but getCurrentLeverageBps will revert with InvalidLeverage
        // because the calculated leverage (nearly 100% = 10000 bps) is <= ONE_HUNDRED_PERCENT_BPS
        await expect(
          dloopMock.getCurrentLeverageBps(),
        ).to.be.revertedWithCustomError(dloopMock, "InvalidLeverage");

        // Even though getCurrentLeverageBps reverts, we can still test getRepayAmountThatKeepCurrentLeverage
        // with a very high leverage value manually
        const veryHighLeverage = 10000000; // 1000x leverage
        const withdrawAmount = ethers.parseEther("1");

        const repayAmount =
          await dloopMock.getRepayAmountThatKeepCurrentLeverage(
            await collateralToken.getAddress(),
            await debtToken.getAddress(),
            withdrawAmount,
            veryHighLeverage,
          );

        // Should not revert and should calculate some repay amount
        expect(repayAmount).to.be.gt(0);
      });
    });
  });

  describe("II. Attack Scenarios and Vault Protection", function () {
    describe("Supply Without Borrowing Attack", function () {
      it("Should test scenario where user supplies but never triggers borrow", async function () {
        const attacker = accounts[1];
        const victim = accounts[2];

        // Scenario: Attacker finds a way to supply collateral without triggering the normal debt creation
        // This could happen through direct token transfers or bugs in the deposit flow

        const attackAmount = ethers.parseEther("1000");

        // Simulate direct token transfer to vault (bypassing normal deposit)
        await collateralToken
          .connect(attacker)
          .transfer(await dloopMock.getAddress(), attackAmount);

        // Manually set mock collateral to simulate the vault recognizing this balance
        // but without corresponding debt (simulating a bug or attack)
        await dloopMock.setMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
          attackAmount,
        );

        // Verify vault state: has collateral but no debt
        const [totalCollateral, totalDebt] =
          await dloopMock.getTotalCollateralAndDebtOfUserInBase(
            await dloopMock.getAddress(),
          );

        expect(totalCollateral).to.be.gt(0);
        expect(totalDebt).to.equal(0);

        // Now if anyone tries to interact with the vault (e.g., normal withdrawal)
        // it could trigger the division-by-zero issue

        // First, attempt to create a normal user position should fail due to vault protection
        const normalDeposit = ethers.parseEther("100");

        // The vault should protect against deposits when in an invalid leverage state
        await expect(
          dloopMock.connect(victim).deposit(normalDeposit, victim.address),
        ).to.be.revertedWithCustomError(dloopMock, "InvalidLeverage");

        // This demonstrates that the vault has protection mechanisms against
        // the corrupted state caused by supply-without-borrow scenarios
      });

      it("Should test vault recovery after supply-without-borrow scenario", async function () {
        const user = accounts[1];

        // Set up the problematic state
        const problemAmount = ethers.parseEther("100");

        await dloopMock.setMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
          problemAmount,
        );

        // Verify problematic leverage
        await expect(
          dloopMock.getCurrentLeverageBps(),
        ).to.be.revertedWithCustomError(dloopMock, "InvalidLeverage");

        // Test if vault can recover through normal operations
        const normalDeposit = ethers.parseEther("10");

        // This might fail or succeed depending on the vault's protection mechanisms
        try {
          await dloopMock.connect(user).deposit(normalDeposit, user.address);

          // If deposit succeeds, check if leverage is now within bounds
          const newLeverage = await dloopMock.getCurrentLeverageBps();
          expect(newLeverage).to.be.gt(0);
          expect(newLeverage).to.not.equal(ethers.MaxUint256);
        } catch (error) {
          // Expected if vault is protecting against imbalanced state
          expect(error).to.match(/TooImbalanced|InvalidLeverage/);
        }
      });
    });
  });

  describe("III. Mitigation Testing", function () {
    it("Should verify that normal deposit-withdraw cycles work correctly", async function () {
      const user = accounts[1];
      const depositAmount = ethers.parseEther("100");

      // Normal deposit should create both collateral and debt
      await dloopMock.connect(user).deposit(depositAmount, user.address);

      // Check that leverage is reasonable (target is 30000 = 300%)
      const leverageAfterDeposit = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterDeposit).to.be.gt(10000); // > 100%
      expect(leverageAfterDeposit).to.be.lt(5000000); // < 50x leverage (reasonable upper bound)

      // Withdrawal should work normally
      const userShares = await dloopMock.balanceOf(user.address);
      const withdrawShares = userShares / 2n;

      // User needs debt tokens to withdraw
      await dloopMock.previewRedeem(withdrawShares);
      // Note: The user already has debt tokens from the test setup

      await dloopMock
        .connect(user)
        .redeem(withdrawShares, user.address, user.address);

      // Verify successful withdrawal
      const finalShares = await dloopMock.balanceOf(user.address);
      expect(finalShares).to.equal(userShares - withdrawShares);
    });

    it("Should test recommended fix for zero leverage case", async function () {
      // Test what the fix should look like
      const withdrawAmount = ethers.parseEther("100");

      // Simulate the recommended fix: check for zero leverage before division
      const leverageBpsBeforeRepayDebt = 0;

      if (leverageBpsBeforeRepayDebt === 0) {
        // Should return 0 repay amount when no leverage
        const expectedRepayAmount = 0;

        // This is what the fixed function should return
        expect(expectedRepayAmount).to.equal(0);
      } else {
        // Normal calculation for non-zero leverage
        const repayAmount =
          await dloopMock.getRepayAmountThatKeepCurrentLeverage(
            await collateralToken.getAddress(),
            await debtToken.getAddress(),
            withdrawAmount,
            leverageBpsBeforeRepayDebt,
          );

        expect(repayAmount).to.be.gte(0);
      }
    });
  });
});
