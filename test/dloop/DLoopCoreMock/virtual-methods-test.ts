import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { deployDLoopMockFixture, testSetup } from "./fixture";

describe("DLoopCoreMock Virtual Methods Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let user1: string;

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    user1 = fixture.user1.address;
  });

  describe("I. Pool Operations", function () {
    describe("Supply To Pool", function () {
      it("Should supply tokens to pool using testSupplyToPoolImplementation", async function () {
        const amount = ethers.parseEther("100");

        await expect(
          dloopMock.testSupplyToPoolImplementation(
            await collateralToken.getAddress(),
            amount,
            user1,
          ),
        ).to.not.be.reverted;

        // Check that collateral was set correctly
        expect(
          await dloopMock.getMockCollateral(
            user1,
            await collateralToken.getAddress(),
          ),
        ).to.equal(amount);
      });
    });

    describe("Borrow From Pool", function () {
      it("Should borrow tokens from pool using testBorrowFromPoolImplementation", async function () {
        const amount = ethers.parseEther("100");

        await expect(
          dloopMock.testBorrowFromPoolImplementation(
            await debtToken.getAddress(),
            amount,
            user1,
          ),
        ).to.not.be.reverted;

        // Check that debt was set correctly
        expect(
          await dloopMock.getMockDebt(user1, await debtToken.getAddress()),
        ).to.equal(amount);
      });
    });
  });

  describe("II. Pool Operations - Error Cases", function () {
    describe("Repay Debt To Pool", function () {
      it("Should repay debt to pool using testRepayDebtToPoolImplementation", async function () {
        const borrowAmount = ethers.parseEther("100");
        const repayAmount = ethers.parseEther("50");

        // First borrow to create debt
        await dloopMock.testBorrowFromPoolImplementation(
          await debtToken.getAddress(),
          borrowAmount,
          user1,
        );

        // Then repay part of it
        await expect(
          dloopMock.testRepayDebtToPoolImplementation(
            await debtToken.getAddress(),
            repayAmount,
            user1,
          ),
        ).to.not.be.reverted;

        // Check that debt was reduced correctly
        expect(
          await dloopMock.getMockDebt(user1, await debtToken.getAddress()),
        ).to.equal(borrowAmount - repayAmount);
      });

      it("Should fail when user has insufficient balance to repay", async function () {
        // User only has 10000 tokens, try to repay more
        const largeAmount = ethers.parseEther("50000");

        await expect(
          dloopMock.testRepayDebtToPoolImplementation(
            await debtToken.getAddress(),
            largeAmount,
            user1,
          ),
        ).to.be.revertedWith("Mock: not enough balance to repay");
      });
    });

    describe("Withdraw From Pool", function () {
      it("Should withdraw tokens from pool using testWithdrawFromPoolImplementation", async function () {
        const supplyAmount = ethers.parseEther("100");
        const withdrawAmount = ethers.parseEther("50");

        // First supply to create collateral
        await dloopMock.testSupplyToPoolImplementation(
          await collateralToken.getAddress(),
          supplyAmount,
          user1,
        );

        // Then withdraw part of it
        await expect(
          dloopMock.testWithdrawFromPoolImplementation(
            await collateralToken.getAddress(),
            withdrawAmount,
            user1,
          ),
        ).to.not.be.reverted;

        // Check that collateral was reduced correctly
        expect(
          await dloopMock.getMockCollateral(
            user1,
            await collateralToken.getAddress(),
          ),
        ).to.equal(supplyAmount - withdrawAmount);
      });

      it("Should fail when pool has insufficient balance to withdraw", async function () {
        // Try to withdraw more than pool has
        const largeAmount = ethers.parseEther("2000000");

        await expect(
          dloopMock.testWithdrawFromPoolImplementation(
            await collateralToken.getAddress(),
            largeAmount,
            user1,
          ),
        ).to.be.revertedWith("Mock: not enough tokens in pool to withdraw");
      });
    });

    describe("Error Conditions", function () {
      it("Should fail when getting price for asset without price set", async function () {
        // Deploy a new token without setting price
        const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
        const newToken = await MockERC20.deploy("New Token", "NEW", 18);

        await expect(
          dloopMock.getAssetPriceFromOracle(await newToken.getAddress()),
        ).to.be.revertedWithCustomError(dloopMock, "MockPriceNotSet");
      });

      it("Should fail when pool has insufficient balance to borrow", async function () {
        const largeAmount = ethers.parseEther("2000000"); // More than pool has

        await expect(
          dloopMock.testBorrowFromPoolImplementation(
            await debtToken.getAddress(),
            largeAmount,
            user1,
          ),
        ).to.be.revertedWith("Mock: not enough tokens in pool to borrow");
      });

      it("Should fail when user has insufficient balance to supply", async function () {
        const largeAmount = ethers.parseEther("50000"); // More than user has

        await expect(
          dloopMock.testSupplyToPoolImplementation(
            await collateralToken.getAddress(),
            largeAmount,
            user1,
          ),
        ).to.be.revertedWithCustomError(dloopMock, "NotEnoughBalanceToSupply");
      });
    });
  });

  describe("III. Total Collateral and Debt Calculation", function () {
    it("Should calculate total collateral and debt correctly", async function () {
      const collateralAmount = ethers.parseEther("100");
      const debtAmount = ethers.parseEther("50");

      // Set up collateral and debt
      await dloopMock.setMockCollateral(
        user1,
        await collateralToken.getAddress(),
        collateralAmount,
      );
      await dloopMock.setMockDebt(
        user1,
        await debtToken.getAddress(),
        debtAmount,
      );

      // Both tokens have default price of 1.0 (100000000 in 8 decimals)
      const [totalCollateralBase, totalDebtBase] =
        await dloopMock.getTotalCollateralAndDebtOfUserInBase(user1);

      // Expected: 100 * 1.0 = 100 (in base currency with 8 decimals)
      expect(totalCollateralBase).to.equal(100n * 10n ** 8n);
      // Expected: 50 * 1.0 = 50 (in base currency with 8 decimals)
      expect(totalDebtBase).to.equal(50n * 10n ** 8n);
    });

    it("Should handle different token prices", async function () {
      const collateralAmount = ethers.parseEther("100");
      const debtAmount = ethers.parseEther("50");

      // Set different prices
      const collateralPrice = 200000000; // 2.0 in 8 decimals
      const debtPrice = 150000000; // 1.5 in 8 decimals

      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        collateralPrice,
      );
      await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

      // Set up collateral and debt
      await dloopMock.setMockCollateral(
        user1,
        await collateralToken.getAddress(),
        collateralAmount,
      );
      await dloopMock.setMockDebt(
        user1,
        await debtToken.getAddress(),
        debtAmount,
      );

      const [totalCollateralBase, totalDebtBase] =
        await dloopMock.getTotalCollateralAndDebtOfUserInBase(user1);

      // Expected: 100 * 2.0 = 200 (in base currency with 8 decimals)
      expect(totalCollateralBase).to.equal(200n * 10n ** 8n);
      // Expected: 50 * 1.5 = 75 (in base currency with 8 decimals)
      expect(totalDebtBase).to.equal(75n * 10n ** 8n);
    });

    it("Should handle no collateral or debt", async function () {
      const [totalCollateralBase, totalDebtBase] =
        await dloopMock.getTotalCollateralAndDebtOfUserInBase(user1);

      expect(totalCollateralBase).to.equal(0);
      expect(totalDebtBase).to.equal(0);
    });

    it("Should handle multiple tokens for the same user", async function () {
      // Set up multiple collateral and debt tokens
      const collateral1Amount = ethers.parseEther("100");
      const collateral2Amount = ethers.parseEther("50");
      const debt1Amount = ethers.parseEther("30");
      const debt2Amount = ethers.parseEther("20");

      // Use both tokens as collateral and debt
      await dloopMock.setMockCollateral(
        user1,
        await collateralToken.getAddress(),
        collateral1Amount,
      );
      await dloopMock.setMockCollateral(
        user1,
        await debtToken.getAddress(),
        collateral2Amount,
      );
      await dloopMock.setMockDebt(
        user1,
        await collateralToken.getAddress(),
        debt1Amount,
      );
      await dloopMock.setMockDebt(
        user1,
        await debtToken.getAddress(),
        debt2Amount,
      );

      const [totalCollateralBase, totalDebtBase] =
        await dloopMock.getTotalCollateralAndDebtOfUserInBase(user1);

      // Expected collateral: (100 + 50) * 1.0 = 150
      expect(totalCollateralBase).to.equal(150n * 10n ** 8n);
      // Expected debt: (30 + 20) * 1.0 = 50
      expect(totalDebtBase).to.equal(50n * 10n ** 8n);
    });
  });

  describe("IV. Integration Tests", function () {
    it("Should handle complete supply and borrow flow", async function () {
      const supplyAmount = ethers.parseEther("200");
      const borrowAmount = ethers.parseEther("100");

      // Supply collateral
      await dloopMock.testSupplyToPoolImplementation(
        await collateralToken.getAddress(),
        supplyAmount,
        user1,
      );

      // Borrow debt
      await dloopMock.testBorrowFromPoolImplementation(
        await debtToken.getAddress(),
        borrowAmount,
        user1,
      );

      // Check final state
      expect(
        await dloopMock.getMockCollateral(
          user1,
          await collateralToken.getAddress(),
        ),
      ).to.equal(supplyAmount);
      expect(
        await dloopMock.getMockDebt(user1, await debtToken.getAddress()),
      ).to.equal(borrowAmount);

      // Check total calculations
      const [totalCollateralBase, totalDebtBase] =
        await dloopMock.getTotalCollateralAndDebtOfUserInBase(user1);
      expect(totalCollateralBase).to.equal(200n * 10n ** 8n);
      expect(totalDebtBase).to.equal(100n * 10n ** 8n);
    });

    it("Should handle complete repay and withdraw flow", async function () {
      const supplyAmount = ethers.parseEther("200");
      const borrowAmount = ethers.parseEther("100");
      const repayAmount = ethers.parseEther("60");
      const withdrawAmount = ethers.parseEther("80");

      // Setup initial position
      await dloopMock.testSupplyToPoolImplementation(
        await collateralToken.getAddress(),
        supplyAmount,
        user1,
      );
      await dloopMock.testBorrowFromPoolImplementation(
        await debtToken.getAddress(),
        borrowAmount,
        user1,
      );

      // Repay part of debt
      await dloopMock.testRepayDebtToPoolImplementation(
        await debtToken.getAddress(),
        repayAmount,
        user1,
      );

      // Withdraw part of collateral
      await dloopMock.testWithdrawFromPoolImplementation(
        await collateralToken.getAddress(),
        withdrawAmount,
        user1,
      );

      // Check final state
      expect(
        await dloopMock.getMockCollateral(
          user1,
          await collateralToken.getAddress(),
        ),
      ).to.equal(supplyAmount - withdrawAmount);
      expect(
        await dloopMock.getMockDebt(user1, await debtToken.getAddress()),
      ).to.equal(borrowAmount - repayAmount);

      // Check total calculations
      const [totalCollateralBase, totalDebtBase] =
        await dloopMock.getTotalCollateralAndDebtOfUserInBase(user1);
      expect(totalCollateralBase).to.equal(120n * 10n ** 8n); // (200-80) * 1.0
      expect(totalDebtBase).to.equal(40n * 10n ** 8n); // (100-60) * 1.0
    });
  });
});
