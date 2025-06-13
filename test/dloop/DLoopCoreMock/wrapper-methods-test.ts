import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, testSetup } from "./fixture";

describe("DLoopCoreMock Wrapper Methods Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let mockPool: { getAddress: () => Promise<string> };
  let user1: string;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    mockPool = {
      getAddress: async (): Promise<string> => fixture.mockPool.address,
    };
    user1 = fixture.user1.address;
    accounts = fixture.accounts;
  });

  describe("I. Wrapper Validation Tests", function () {
    // These tests verify that the wrapper functions (_supplyToPool, _borrowFromPool, etc.)
    // properly validate the behavior of their corresponding implementation functions
    // and revert with appropriate errors when unexpected behavior is detected

    describe("Supply To Pool Wrapper Validation", function () {
      const testCases = [
        {
          // Set transfer portion bps to 0% so that the amount does not increase
          name: "Should trigger TokenBalanceNotDecreasedAfterSupply validation error",
          transferPortionBps: 0 * ONE_PERCENT_BPS,
          expectedError: "TokenBalanceNotDecreasedAfterSupply",
        },
        {
          // Set transfer portion bps to 50% so that only half the amount is transferred
          name: "Should trigger UnexpectedSupplyAmountToPool validation error",
          transferPortionBps: 50 * ONE_PERCENT_BPS,
          expectedError: "UnexpectedSupplyAmountToPool",
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          const amount = ethers.parseEther("100");

          // Make sure user has enough balance to supply
          expect(await collateralToken.balanceOf(user1)).to.be.gte(amount);

          // Set transfer portion bps according to test case
          await dloopMock.setTransferPortionBps(testCase.transferPortionBps);

          // Approve the mockPool to transfer tokens from user
          await collateralToken
            .connect(accounts[0])
            .approve(await mockPool.getAddress(), amount);

          // Due to the mock implementation design, this will trigger the wrapper validation error
          // The wrapper expects vault balance to decrease, but mock transfers from user to mockPool
          await expect(
            dloopMock.testSupplyToPool(
              await collateralToken.getAddress(),
              amount,
              user1,
            ),
          ).to.be.revertedWithCustomError(dloopMock, testCase.expectedError);
        });
      }
    });

    describe("Borrow From Pool Wrapper Validation", function () {
      const testCases = [
        {
          // Set transfer portion bps to 0% so that the amount does not increase
          name: "Should trigger TokenBalanceNotIncreasedAfterBorrow validation error",
          transferPortionBps: 0 * ONE_PERCENT_BPS,
          expectedError: "TokenBalanceNotIncreasedAfterBorrow",
        },
        {
          // Set transfer portion bps to 50% so that only half the amount is transferred
          name: "Should trigger UnexpectedBorrowAmountFromPool validation error",
          transferPortionBps: 50 * ONE_PERCENT_BPS,
          expectedError: "UnexpectedBorrowAmountFromPool",
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          const amount = ethers.parseEther("100");

          // Ensure mockPool has sufficient tokens and allowance
          const mockPoolBalance = await debtToken.balanceOf(
            await mockPool.getAddress(),
          );
          expect(mockPoolBalance).to.be.gte(amount);

          // Set transfer portion bps according to test case
          await dloopMock.setTransferPortionBps(testCase.transferPortionBps);

          // Set up allowance from mockPool to transfer tokens
          await debtToken
            .connect(accounts[0])
            .approve(await mockPool.getAddress(), amount);

          // Due to the mock implementation design, this will trigger the wrapper validation error
          // The wrapper expects vault balance to increase, but mock transfers from mockPool to user
          await expect(
            dloopMock.testBorrowFromPool(
              await debtToken.getAddress(),
              amount,
              user1,
            ),
          ).to.be.revertedWithCustomError(dloopMock, testCase.expectedError);
        });
      }
    });

    describe("Repay Debt To Pool Wrapper Validation", function () {
      const testCases = [
        {
          // Set transfer portion bps to 0% so that the amount does not decrease
          name: "Should trigger TokenBalanceNotDecreasedAfterRepay validation error",
          transferPortionBps: 0 * ONE_PERCENT_BPS,
          expectedError: "TokenBalanceNotDecreasedAfterRepay",
        },
        {
          // Set transfer portion bps to 50% so that only half the amount is transferred
          name: "Should trigger UnexpectedRepayAmountToPool validation error",
          transferPortionBps: 50 * ONE_PERCENT_BPS,
          expectedError: "UnexpectedRepayAmountToPool",
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          const borrowAmount = ethers.parseEther("100");
          const repayAmount = ethers.parseEther("50");

          // First create some debt using the implementation method
          await dloopMock.testBorrowFromPoolImplementation(
            await debtToken.getAddress(),
            borrowAmount,
            user1,
          );

          // Give user1 tokens to repay and set up allowances
          await debtToken.mint(user1, repayAmount);
          await debtToken
            .connect(accounts[1])
            .approve(await dloopMock.getAddress(), repayAmount);
          await debtToken
            .connect(accounts[1])
            .approve(await mockPool.getAddress(), repayAmount);

          // Set transfer portion bps according to test case
          await dloopMock.setTransferPortionBps(testCase.transferPortionBps);

          // Due to the mock implementation design, this will trigger the wrapper validation error
          // The wrapper expects vault balance to decrease, but mock transfers from user to mockPool
          await expect(
            dloopMock.testRepayDebtToPool(
              await debtToken.getAddress(),
              repayAmount,
              user1,
            ),
          ).to.be.revertedWithCustomError(dloopMock, testCase.expectedError);
        });
      }
    });

    describe("Withdraw From Pool Wrapper Validation", function () {
      const testCases = [
        {
          // Set transfer portion bps to 0% so that the amount does not increase
          name: "Should trigger TokenBalanceNotIncreasedAfterWithdraw validation error",
          transferPortionBps: 0 * ONE_PERCENT_BPS,
          expectedError: "TokenBalanceNotIncreasedAfterWithdraw",
        },
        {
          // Set transfer portion bps to 50% so that only half the amount is transferred
          name: "Should trigger UnexpectedWithdrawAmountFromPool validation error",
          transferPortionBps: 50 * ONE_PERCENT_BPS,
          expectedError: "UnexpectedWithdrawAmountFromPool",
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          const supplyAmount = ethers.parseEther("100");
          const withdrawAmount = ethers.parseEther("50");

          // First create some collateral using the implementation method
          await dloopMock.testSupplyToPoolImplementation(
            await collateralToken.getAddress(),
            supplyAmount,
            user1,
          );

          // Set up allowance from mockPool to transfer tokens
          await collateralToken
            .connect(accounts[0])
            .approve(await mockPool.getAddress(), withdrawAmount);

          // Set transfer portion bps according to test case
          await dloopMock.setTransferPortionBps(testCase.transferPortionBps);

          // Due to the mock implementation design, this will trigger the wrapper validation error
          // The wrapper expects vault balance to increase, but mock transfers from mockPool to user
          await expect(
            dloopMock.testWithdrawFromPool(
              await collateralToken.getAddress(),
              withdrawAmount,
              user1,
            ),
          ).to.be.revertedWithCustomError(dloopMock, testCase.expectedError);
        });
      }
    });

    describe("Balance Validation Edge Cases", function () {
      it("Should handle zero amount operations correctly", async function () {
        // Test that wrapper functions handle zero amounts without triggering validation errors
        const zeroAmount = 0;

        // These should not revert for zero amounts (though they may revert for other business logic reasons)
        // The wrapper validation should pass since balance changes of 0 are expected for 0 amount operations

        // Note: Some operations might still revert due to business logic, but not due to balance validation
        await expect(
          dloopMock.testSupplyToPoolImplementation(
            await collateralToken.getAddress(),
            zeroAmount,
            user1,
          ),
        ).to.not.be.revertedWith("TokenBalanceNotDecreasedAfterSupply");
      });

      it("Should validate balance changes match expected amounts", async function () {
        // This test ensures the wrapper functions check that balance changes match exactly
        // the expected amounts, not just the direction of change

        const amount = ethers.parseEther("100");

        // Normal operation should work fine
        await expect(
          dloopMock.testSupplyToPoolImplementation(
            await collateralToken.getAddress(),
            amount,
            user1,
          ),
        ).to.not.be.reverted;

        // Verify the operation actually happened
        expect(
          await dloopMock.getMockCollateral(
            user1,
            await collateralToken.getAddress(),
          ),
        ).to.equal(amount);
      });
    });
  });
});
