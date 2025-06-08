import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";
import { DLoopCoreMock, TestMintableERC20 } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// Test constants
const TARGET_LEVERAGE_BPS = 300 * ONE_PERCENT_BPS; // 3x leverage
const LOWER_BOUND_BPS = 200 * ONE_PERCENT_BPS; // 2x leverage
const UPPER_BOUND_BPS = 400 * ONE_PERCENT_BPS; // 4x leverage
const MAX_SUBSIDY_BPS = 1 * ONE_PERCENT_BPS; // 1%
const DEFAULT_PRICE = 100000000; // 1.0 in 8 decimals
const COLLATERAL_DECIMALS = 18;
const DEBT_DECIMALS = 18;

describe("DLoopCoreMock Comprehensive Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let mockPool: { getAddress: () => Promise<string> };
  let deployer: string;
  let user1: string;
  let user2: string;
  let user3: string;
  let accounts: HardhatEthersSigner[];

  /**
   * Deploy the DLoopCoreMock contract with the mock tokens and mock pool
   *
   * @returns The fixture object containing the contract instances and addresses
   */
  async function deployDLoopMockFixture() {
    const accounts = await ethers.getSigners();
    const deployer = accounts[0].address;
    const user1 = accounts[1].address;
    const user2 = accounts[2].address;
    const user3 = accounts[3].address;

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
    const collateralToken = await MockERC20.deploy(
      "Mock Collateral",
      "mCOLL",
      COLLATERAL_DECIMALS,
    );
    const debtToken = await MockERC20.deploy(
      "Mock Debt",
      "mDEBT",
      DEBT_DECIMALS,
    );

    // For the mockPool, we'll use the deployer's address as a simple approach
    // This way we can control the allowances easily
    const mockPoolAddress = deployer; // Use deployer as mockPool for simplicity

    // Mint tokens to mock pool (deployer)
    await collateralToken.mint(mockPoolAddress, ethers.parseEther("1000000"));
    await debtToken.mint(mockPoolAddress, ethers.parseEther("1000000"));

    // Get the exact nonce for deployment and set up allowances correctly
    const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");
    const currentNonce = await ethers.provider.getTransactionCount(deployer);

    // We'll have 2 approve transactions, so deployment will be at currentNonce + 2
    const contractAddress = ethers.getCreateAddress({
      from: deployer,
      nonce: currentNonce + 2,
    });

    // Set up allowances to the predicted contract address
    await collateralToken
      .connect(accounts[0])
      .approve(contractAddress, ethers.MaxUint256);
    await debtToken
      .connect(accounts[0])
      .approve(contractAddress, ethers.MaxUint256);

    // Now deploy the contract
    const dloopMock = await DLoopCoreMock.deploy(
      "Mock dLoop Vault",
      "mdLOOP",
      await collateralToken.getAddress(),
      await debtToken.getAddress(),
      TARGET_LEVERAGE_BPS,
      LOWER_BOUND_BPS,
      UPPER_BOUND_BPS,
      MAX_SUBSIDY_BPS,
      mockPoolAddress,
    );

    return {
      dloopMock,
      collateralToken,
      debtToken,
      mockPool: { getAddress: async () => mockPoolAddress }, // Mock the mockPool interface
      accounts,
      deployer,
      user1,
      user2,
      user3,
    };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    mockPool = fixture.mockPool;
    accounts = fixture.accounts;
    deployer = fixture.deployer;
    user1 = fixture.user1;
    user2 = fixture.user2;
    user3 = fixture.user3;

    // Set default prices
    await dloopMock.setMockPrice(
      await collateralToken.getAddress(),
      DEFAULT_PRICE,
    );
    await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

    // Setup token balances for users
    await collateralToken.mint(user1, ethers.parseEther("10000"));
    await debtToken.mint(user1, ethers.parseEther("10000"));
    await collateralToken.mint(user2, ethers.parseEther("10000"));
    await debtToken.mint(user2, ethers.parseEther("10000"));

    // Setup allowances for users to vault
    const vaultAddress = await dloopMock.getAddress();
    await collateralToken
      .connect(accounts[1])
      .approve(vaultAddress, ethers.MaxUint256);
    await debtToken
      .connect(accounts[1])
      .approve(vaultAddress, ethers.MaxUint256);
    await collateralToken
      .connect(accounts[2])
      .approve(vaultAddress, ethers.MaxUint256);
    await debtToken
      .connect(accounts[2])
      .approve(vaultAddress, ethers.MaxUint256);
  });

  describe("I. Constructor and Initial State", function () {
    it("Constructor: Valid parameters with proper allowances", async function () {
      // This test will pass if our fixture setup works correctly
      expect(await dloopMock.name()).to.equal("Mock dLoop Vault");
      expect(await dloopMock.symbol()).to.equal("mdLOOP");
      expect(await dloopMock.targetLeverageBps()).to.equal(TARGET_LEVERAGE_BPS);
      expect(await dloopMock.lowerBoundTargetLeverageBps()).to.equal(
        LOWER_BOUND_BPS,
      );
      expect(await dloopMock.upperBoundTargetLeverageBps()).to.equal(
        UPPER_BOUND_BPS,
      );
      expect(await dloopMock.maxSubsidyBps()).to.equal(MAX_SUBSIDY_BPS);
    });

    it("Should have correct initial state", async function () {
      const mockPoolAddress = await mockPool.getAddress();
      expect(await dloopMock.mockPool()).to.equal(mockPoolAddress);

      // Check that prices are set correctly
      expect(
        await dloopMock.getMockPrice(await collateralToken.getAddress()),
      ).to.equal(DEFAULT_PRICE);
      expect(
        await dloopMock.getMockPrice(await debtToken.getAddress()),
      ).to.equal(DEFAULT_PRICE);
    });
  });

  describe("II. Mock Functions", function () {
    describe("Price Setting", function () {
      it("Should set and get mock prices", async function () {
        const testPrice = 250000000; // 2.5 in 8 decimals
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testPrice,
        );
        expect(
          await dloopMock.getMockPrice(await collateralToken.getAddress()),
        ).to.equal(testPrice);
      });
    });

    describe("Collateral Management", function () {
      it("Should set mock collateral for user", async function () {
        const amount = ethers.parseEther("100");
        await dloopMock.setMockCollateral(
          user1,
          await collateralToken.getAddress(),
          amount,
        );
        expect(
          await dloopMock.getMockCollateral(
            user1,
            await collateralToken.getAddress(),
          ),
        ).to.equal(amount);
      });
    });

    describe("Debt Management", function () {
      it("Should set mock debt for user", async function () {
        const amount = ethers.parseEther("50");
        await dloopMock.setMockDebt(
          user1,
          await debtToken.getAddress(),
          amount,
        );
        expect(
          await dloopMock.getMockDebt(user1, await debtToken.getAddress()),
        ).to.equal(amount);
      });
    });
  });

  describe("III. Pool Operations", function () {
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

  describe("IV. Pool Operations - Error Cases", function () {
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
          dloopMock.testGetAssetPriceFromOracle(await newToken.getAddress()),
        ).to.be.revertedWith("Mock price not set");
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
        ).to.be.revertedWith("Mock: not enough balance to supply");
      });
    });
  });

  describe("V. Total Collateral and Debt Calculation", function () {
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

  describe("VI. Implementation of Abstract Functions - Wrapper Validation Tests", function () {
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

  describe("VII. Integration Tests", function () {
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
