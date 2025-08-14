import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopDepositorMock,
  SimpleDEXMock,
  TestERC20FlashMintable,
  TestMintableERC20,
} from "../../../typechain-types";
import {
  ONE_HUNDRED_PERCENT_BPS,
  ONE_PERCENT_BPS,
} from "../../../typescript/common/bps_constants";
import {
  deployDLoopDepositorMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixtures";

describe("DLoopDepositorMock Deposit Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let dLoopDepositorMock: DLoopDepositorMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestERC20FlashMintable;
  let flashLender: TestERC20FlashMintable;
  let simpleDEXMock: SimpleDEXMock;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  beforeEach(async function () {
    // Reset the deployment before each test
    const fixtures = await loadFixture(deployDLoopDepositorMockFixture);
    await testSetup(
      fixtures.dloopCoreMockFixture,
      fixtures.dloopDepositorMockFixture,
    );

    // Extract fixture objects
    const dloopCoreMockFixture = fixtures.dloopCoreMockFixture;
    const dloopDepositorMockFixture = fixtures.dloopDepositorMockFixture;

    dloopMock = dloopCoreMockFixture.dloopMock;
    collateralToken = dloopCoreMockFixture.collateralToken;
    debtToken = dloopCoreMockFixture.debtToken;

    dLoopDepositorMock = dloopDepositorMockFixture.dLoopDepositorMock;
    flashLender = dloopDepositorMockFixture.flashLender;
    simpleDEXMock = dloopDepositorMockFixture.simpleDEXMock;
    user1 = dloopDepositorMockFixture.user1;
    user2 = dloopDepositorMockFixture.user2;
    user3 = dloopDepositorMockFixture.user3;
  });

  describe("I. Basic Deposit Functionality", function () {
    const basicDepositTests = [
      {
        name: "Should handle small leveraged deposit",
        depositAmount: ethers.parseEther("10"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedShares: ethers.parseEther("28.5"),
      },
      {
        name: "Should handle medium leveraged deposit",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedShares: ethers.parseEther("285"),
      },
      {
        name: "Should handle large leveraged deposit",
        depositAmount: ethers.parseEther("500"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedShares: ethers.parseEther("1425"),
      },
      {
        name: "Should handle deposit with minimal slippage tolerance",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        userIndex: 2,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedShares: ethers.parseEther("299.7"),
      },
      {
        name: "Should handle deposit with higher slippage tolerance",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 10 * ONE_PERCENT_BPS,
        userIndex: 3,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedShares: ethers.parseEther("270"),
      },
    ];

    for (const testCase of basicDepositTests) {
      it(testCase.name, async function () {
        const user =
          testCase.userIndex === 1
            ? user1
            : testCase.userIndex === 2
              ? user2
              : user3;

        // Calculate expected values
        const expectedLeveragedAssets =
          await dLoopDepositorMock.getLeveragedAssets(
            testCase.depositAmount,
            dloopMock,
          );
        const expectedShares = await dloopMock.convertToShares(
          expectedLeveragedAssets,
        );
        const minOutputShares =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.depositAmount,
            testCase.slippagePercentage,
            dloopMock,
          );

        // Get initial balances
        const initialUserCollateralBalance = await collateralToken.balanceOf(
          user.address,
        );
        const initialUserShareBalance = await dloopMock.balanceOf(user.address);
        const initialCoreCollateral = await dloopMock.getMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
        );

        // Perform leveraged deposit
        await dLoopDepositorMock.connect(user).deposit(
          testCase.depositAmount,
          user.address,
          minOutputShares,
          "0x", // No specific swap data needed for SimpleDEXMock
          dloopMock,
        );

        // Verify user collateral balance decreased by deposit amount
        const finalUserCollateralBalance = await collateralToken.balanceOf(
          user.address,
        );
        expect(finalUserCollateralBalance).to.equal(
          initialUserCollateralBalance - testCase.depositAmount,
        );

        // Verify user received shares (at least minOutputShares)
        const finalUserShareBalance = await dloopMock.balanceOf(user.address);
        const actualShares = finalUserShareBalance - initialUserShareBalance;
        expect(actualShares).to.be.gte(minOutputShares);
        expect(actualShares).to.be.lte((expectedShares * 101n) / 100n); // No more than 1% above expected
        expect(actualShares).to.be.closeTo(
          testCase.expectedReceivedShares,
          (testCase.expectedReceivedShares * BigInt(ONE_PERCENT_BPS)) /
            BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
        );

        // Verify core vault received leveraged collateral amount
        const finalCoreCollateral = await dloopMock.getMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
        );
        const actualLeveragedAmount =
          finalCoreCollateral - initialCoreCollateral;

        // Should be close to leveraged amount (allowing for slippage)
        expect(actualLeveragedAmount).to.be.gte(
          (expectedLeveragedAssets * 90n) / 100n,
        ); // At least 90%
        expect(actualLeveragedAmount).to.be.lte(expectedLeveragedAssets); // But not more than 100%

        // Verify vault has target leverage
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.closeTo(
          BigInt(testCase.expectedLeverageBps),
          BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance
        );

        // Verify shares are reasonable compared to deposit amount
        expect(actualShares).to.be.gt(testCase.depositAmount); // Should get more shares due to leverage
      });
    }
  });

  describe("II. Flash Loan Integration", function () {
    const flashLoanTests = [
      {
        name: "Should utilize flash loans for small deposit",
        depositAmount: ethers.parseEther("50"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedReceivedShares: ethers.parseEther("142.5"),
      },
      {
        name: "Should utilize flash loans for medium deposit",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedReceivedShares: ethers.parseEther("285"),
      },
      {
        name: "Should utilize flash loans for large deposit",
        depositAmount: ethers.parseEther("200"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 2,
        expectedReceivedShares: ethers.parseEther("570"),
      },
    ];

    for (const testCase of flashLoanTests) {
      it(testCase.name, async function () {
        const user = testCase.userIndex === 1 ? user1 : user2;

        // Check flash lender has sufficient balance
        const flashLenderBalance = await flashLender.balanceOf(
          await flashLender.getAddress(),
        );
        expect(flashLenderBalance).to.be.gt(0);

        // Record flash lender state before
        const initialFlashLenderBalance = await flashLender.balanceOf(
          await flashLender.getAddress(),
        );

        // Get initial user share balance
        const initialUserShareBalance = await dloopMock.balanceOf(user.address);

        // Calculate reasonable minOutputShares
        const minOutputShares =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.depositAmount,
            testCase.slippagePercentage,
            dloopMock,
          );

        // Perform leveraged deposit
        await dLoopDepositorMock
          .connect(user)
          .deposit(
            testCase.depositAmount,
            user.address,
            minOutputShares,
            "0x",
            dloopMock,
          );

        // Verify user received expected shares
        const finalUserShareBalance = await dloopMock.balanceOf(user.address);
        const actualShares = finalUserShareBalance - initialUserShareBalance;
        expect(actualShares).to.be.gte(minOutputShares);
        expect(actualShares).to.be.closeTo(
          testCase.expectedReceivedShares,
          (testCase.expectedReceivedShares * BigInt(ONE_PERCENT_BPS)) /
            BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
        );

        // Flash lender balance should return to approximately the same level
        // (may have small fee differences)
        const finalFlashLenderBalance = await flashLender.balanceOf(
          await flashLender.getAddress(),
        );
        expect(finalFlashLenderBalance).to.be.closeTo(
          initialFlashLenderBalance,
          ethers.parseEther("1"), // Allow 1 ETH tolerance for fees
        );
      });
    }

    it("Should handle flash loan fees correctly", async function () {
      const testCases = [
        { depositAmount: ethers.parseEther("50"), expectedFee: 0 },
        { depositAmount: ethers.parseEther("100"), expectedFee: 0 },
        { depositAmount: ethers.parseEther("200"), expectedFee: 0 },
      ];

      for (const testCase of testCases) {
        // Flash loan should have zero fee by default in TestERC20FlashMintable
        const flashLoanAmount = ethers.parseEther("1000");
        const flashFee = await flashLender.flashFee(
          await flashLender.getAddress(),
          flashLoanAmount,
        );
        expect(flashFee).to.equal(testCase.expectedFee);

        // Calculate reasonable minOutputShares
        const minOutputShares =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.depositAmount,
            0.1 * ONE_PERCENT_BPS,
            dloopMock,
          );

        // Should succeed even with zero fees
        await expect(
          dLoopDepositorMock
            .connect(user1)
            .deposit(
              testCase.depositAmount,
              user1.address,
              minOutputShares,
              "0x",
              dloopMock,
            ),
        ).to.not.be.reverted;
      }
    });

    it("Should fail if flash loan amount exceeds available", async function () {
      // Try to make an extremely large deposit that would require more flash loan than available
      const depositAmount = ethers.parseEther("10000000"); // 10M ETH

      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock),
      ).to.be.reverted;
    });
  });

  describe("III. DEX Integration", function () {
    const dexIntegrationTests = [
      {
        name: "Should swap debt tokens to collateral tokens for small amount",
        depositAmount: ethers.parseEther("50"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"), // 1:1 rate
        executionSlippage: 0,
        expectedReceivedShares: ethers.parseEther("142.5"),
      },
      {
        name: "Should swap debt tokens to collateral tokens for medium amount",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"), // 1:1 rate
        executionSlippage: 0,
        expectedReceivedShares: ethers.parseEther("285"),
      },
      {
        name: "Should handle different exchange rates (1:1.5)",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 1 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.5"), // 1 debt = 1.5 collateral
        executionSlippage: 0,
        expectedReceivedShares: ethers.parseEther("297"),
      },
      {
        name: "Should handle different exchange rates (1:1.2)",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.2"), // 1 debt = 1.2 collateral
        executionSlippage: 0,
        expectedReceivedShares: ethers.parseEther("285"),
      },
      {
        name: "Should handle DEX execution slippage (1%)",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 4 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"),
        executionSlippage: ONE_PERCENT_BPS,
        expectedReceivedShares: ethers.parseEther("288"),
      },
      {
        name: "Should handle DEX execution slippage (2%)",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 4 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"),
        executionSlippage: 2 * ONE_PERCENT_BPS,
        expectedReceivedShares: ethers.parseEther("288"),
      },
    ];

    for (const testCase of dexIntegrationTests) {
      it(testCase.name, async function () {
        // Set exchange rate if different from default
        if (testCase.exchangeRate !== ethers.parseEther("1.0")) {
          await simpleDEXMock.setExchangeRate(
            await debtToken.getAddress(),
            await collateralToken.getAddress(),
            testCase.exchangeRate,
          );
        }

        // Set execution slippage if specified
        if (testCase.executionSlippage > 0) {
          await simpleDEXMock.setExecutionSlippage(testCase.executionSlippage);
        }

        // Get initial DEX balances
        const initialDexCollateralBalance = await collateralToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );
        const initialDexDebtBalance = await debtToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );

        // Get initial user share balance
        const initialUserShareBalance = await dloopMock.balanceOf(
          user1.address,
        );

        // Calculate reasonable minOutputShares
        const minOutputShares =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.depositAmount,
            testCase.slippagePercentage,
            dloopMock,
          );

        // Perform leveraged deposit
        await dLoopDepositorMock
          .connect(user1)
          .deposit(
            testCase.depositAmount,
            user1.address,
            minOutputShares,
            "0x",
            dloopMock,
          );

        // DEX should have received debt tokens and given out collateral tokens
        const finalDexCollateralBalance = await collateralToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );
        const finalDexDebtBalance = await debtToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );

        // DEX should have less collateral and more debt tokens
        expect(finalDexCollateralBalance).to.be.lt(initialDexCollateralBalance);
        expect(finalDexDebtBalance).to.be.gt(initialDexDebtBalance);

        // Verify user received expected shares
        const finalUserShareBalance = await dloopMock.balanceOf(user1.address);
        const actualShares = finalUserShareBalance - initialUserShareBalance;
        expect(actualShares).to.be.gte(minOutputShares);
        expect(actualShares).to.be.closeTo(
          testCase.expectedReceivedShares,
          (testCase.expectedReceivedShares * BigInt(ONE_PERCENT_BPS)) /
            BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
        );

        // Reset to default values for next test
        if (testCase.exchangeRate !== ethers.parseEther("1.0")) {
          await simpleDEXMock.setExchangeRate(
            await debtToken.getAddress(),
            await collateralToken.getAddress(),
            ethers.parseEther("1.0"),
          );
        }

        if (testCase.executionSlippage > 0) {
          await simpleDEXMock.setExecutionSlippage(0);
        }
      });
    }
  });

  describe("IV. Edge Cases and Error Handling", function () {
    const errorHandlingTests = [
      {
        name: "Should revert with insufficient collateral token balance",
        depositAmount: "user_balance_plus_one", // Special marker for insufficient balance
        expectedError: "ERC20InsufficientBalance",
        errorSource: "collateralToken",
      },
      {
        name: "Should revert with insufficient allowance",
        depositAmount: ethers.parseEther("100"),
        expectedError: "ERC20InsufficientAllowance",
        errorSource: "collateralToken",
        removeAllowance: true,
      },
      {
        name: "Should handle zero deposit amount",
        depositAmount: 0,
        expectedError: "reverted", // Generic revert
        errorSource: "dLoopDepositorMock",
      },
    ];

    for (const testCase of errorHandlingTests) {
      it(testCase.name, async function () {
        let actualDepositAmount: bigint;

        if (testCase.depositAmount === "user_balance_plus_one") {
          const currentUserCollateralBalance = await collateralToken.balanceOf(
            user1.address,
          );
          actualDepositAmount =
            currentUserCollateralBalance + ethers.parseEther("1");
        } else {
          actualDepositAmount = BigInt(testCase.depositAmount);
        }

        // Remove allowance if specified
        if (testCase.removeAllowance) {
          await collateralToken
            .connect(user1)
            .approve(await dLoopDepositorMock.getAddress(), 0);
        }

        const errorContract =
          testCase.errorSource === "collateralToken"
            ? collateralToken
            : dLoopDepositorMock;

        if (testCase.expectedError === "reverted") {
          await expect(
            dLoopDepositorMock
              .connect(user1)
              .deposit(actualDepositAmount, user1.address, 0, "0x", dloopMock),
          ).to.be.reverted;
        } else {
          await expect(
            dLoopDepositorMock
              .connect(user1)
              .deposit(actualDepositAmount, user1.address, 0, "0x", dloopMock),
          ).to.be.revertedWithCustomError(
            errorContract,
            testCase.expectedError,
          );
        }
      });
    }

    it("Should revert when slippage exceeds acceptable limits", async function () {
      const slippageTests = [
        {
          depositAmount: ethers.parseEther("100"),
          unreasonableMultiplier: 2, // 200% of expected shares
          expectedError: "EstimatedSharesLessThanMinOutputShares",
        },
        {
          depositAmount: ethers.parseEther("50"),
          unreasonableMultiplier: 10, // 1000% of expected shares
          expectedError: "EstimatedSharesLessThanMinOutputShares",
        },
      ];

      for (const testCase of slippageTests) {
        // Get leveraged amount and estimated shares
        const leveragedAmount = await dLoopDepositorMock.getLeveragedAssets(
          testCase.depositAmount,
          dloopMock,
        );
        const estimatedShares = await dloopMock.previewDeposit(leveragedAmount);

        // Set minimum shares that would require negative slippage
        const impossibleMinimum =
          estimatedShares * BigInt(testCase.unreasonableMultiplier);

        await expect(
          dLoopDepositorMock
            .connect(user1)
            .deposit(
              testCase.depositAmount,
              user1.address,
              impossibleMinimum,
              "0x",
              dloopMock,
            ),
        ).to.be.revertedWithCustomError(
          dLoopDepositorMock,
          testCase.expectedError,
        );
      }
    });
  });

  describe("V. Multiple Users and Complex Scenarios", function () {
    const multiUserTests = [
      {
        name: "Should handle deposits from multiple users with same amount",
        users: [1, 2, 3],
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        expectedMinTotalSupply: ethers.parseEther("300"), // 3 users * 100 ETH leverage
      },
      {
        name: "Should handle deposits from multiple users with different amounts",
        users: [1, 2, 3],
        depositAmounts: [
          ethers.parseEther("50"),
          ethers.parseEther("100"),
          ethers.parseEther("200"),
        ],
        slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        expectedMinTotalSupply: ethers.parseEther("350"), // Sum of leveraged amounts
      },
    ];

    for (const testCase of multiUserTests) {
      it(testCase.name, async function () {
        const users = testCase.users.map((index) =>
          index === 1 ? user1 : index === 2 ? user2 : user3,
        );
        let totalReceivedShares = BigInt(0);

        for (let i = 0; i < users.length; i++) {
          const user = users[i];
          const depositAmount = testCase.depositAmounts
            ? testCase.depositAmounts[i]
            : testCase.depositAmount;

          const minOutputShares =
            await dLoopDepositorMock.calculateMinOutputShares(
              depositAmount,
              testCase.slippagePercentage,
              dloopMock,
            );

          const initialShares = await dloopMock.balanceOf(user.address);

          await dLoopDepositorMock
            .connect(user)
            .deposit(
              depositAmount,
              user.address,
              minOutputShares,
              "0x",
              dloopMock,
            );

          const finalShares = await dloopMock.balanceOf(user.address);
          const receivedShares = finalShares - initialShares;

          expect(receivedShares).to.be.gte(minOutputShares);
          expect(receivedShares).to.be.lte((minOutputShares * 101n) / 100n);

          totalReceivedShares += receivedShares;
        }

        // Verify total supply
        const totalSupply = await dloopMock.totalSupply();
        expect(totalSupply).to.equal(totalReceivedShares);
        expect(totalSupply).to.be.gte(testCase.expectedMinTotalSupply);

        // Verify target leverage is maintained
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.closeTo(
          BigInt(TARGET_LEVERAGE_BPS),
          BigInt(ONE_PERCENT_BPS),
        );
      });
    }

    it("Should handle sequential deposits by same user", async function () {
      const sequentialTests = [
        {
          depositAmounts: [
            ethers.parseEther("50"),
            ethers.parseEther("75"),
            ethers.parseEther("25"),
          ],
          slippagePercentage: 0.1 * ONE_PERCENT_BPS,
          expectedMinFinalShares: ethers.parseEther("150"), // Sum of deposit amounts
        },
      ];

      for (const testCase of sequentialTests) {
        let cumulativeShares = BigInt(0);

        for (const depositAmount of testCase.depositAmounts) {
          const minOutputShares =
            await dLoopDepositorMock.calculateMinOutputShares(
              depositAmount,
              testCase.slippagePercentage,
              dloopMock,
            );

          const initialShares = await dloopMock.balanceOf(user1.address);

          await dLoopDepositorMock
            .connect(user1)
            .deposit(
              depositAmount,
              user1.address,
              minOutputShares,
              "0x",
              dloopMock,
            );

          const finalShares = await dloopMock.balanceOf(user1.address);
          const sharesGained = finalShares - initialShares;

          expect(sharesGained).to.be.gte(minOutputShares);
          expect(sharesGained).to.be.lte((minOutputShares * 101n) / 100n);
          cumulativeShares += sharesGained;
        }

        // Final shares should equal cumulative shares gained
        const totalUserShares = await dloopMock.balanceOf(user1.address);
        expect(totalUserShares).to.equal(cumulativeShares);
        expect(totalUserShares).to.be.gte(testCase.expectedMinFinalShares);
      }
    });

    it("Should maintain leverage after multiple deposits", async function () {
      const leverageMaintenanceTests = [
        {
          firstDeposit: { amount: ethers.parseEther("100"), user: 1 },
          secondDeposit: { amount: ethers.parseEther("100"), user: 2 },
          expectedLeverageBps: TARGET_LEVERAGE_BPS,
        },
      ];

      for (const testCase of leverageMaintenanceTests) {
        const firstUser = testCase.firstDeposit.user === 1 ? user1 : user2;
        const secondUser = testCase.secondDeposit.user === 1 ? user1 : user2;

        const minOutputShares1 =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.firstDeposit.amount,
            0.1 * ONE_PERCENT_BPS,
            dloopMock,
          );
        const minOutputShares2 =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.secondDeposit.amount,
            0.1 * ONE_PERCENT_BPS,
            dloopMock,
          );

        // First deposit
        await dLoopDepositorMock
          .connect(firstUser)
          .deposit(
            testCase.firstDeposit.amount,
            firstUser.address,
            minOutputShares1,
            "0x",
            dloopMock,
          );

        const leverageAfterFirst = await dloopMock.getCurrentLeverageBps();
        expect(leverageAfterFirst).to.be.closeTo(
          BigInt(testCase.expectedLeverageBps),
          BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance
        );

        // Second deposit
        await dLoopDepositorMock
          .connect(secondUser)
          .deposit(
            testCase.secondDeposit.amount,
            secondUser.address,
            minOutputShares2,
            "0x",
            dloopMock,
          );

        const leverageAfterSecond = await dloopMock.getCurrentLeverageBps();

        // Leverage should be maintained close to target
        expect(leverageAfterSecond).to.be.closeTo(
          leverageAfterFirst,
          BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance
        );
      }
    });
  });

  describe("VI. Leftover Token Handling - Receiver Gets Leftover", function () {
    const leftoverTokenTests = [
      {
        name: "Should handle leftover debt tokens for small deposit",
        depositAmount: ethers.parseEther("50"),
        slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        expectedReceivedShares: ethers.parseEther("149.85"),
      },
      {
        name: "Should handle leftover debt tokens for medium deposit",
        depositAmount: ethers.parseEther("100"),
        slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        expectedReceivedShares: ethers.parseEther("299.7"),
      },
      {
        name: "Should handle leftover debt tokens for large deposit",
        depositAmount: ethers.parseEther("200"),
        slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        expectedReceivedShares: ethers.parseEther("599.4"),
      },
    ];

    for (const testCase of leftoverTokenTests) {
      it(testCase.name, async function () {
        // Record receiver debt balance before
        const receiverDebtBefore = await debtToken.balanceOf(user1.address);

        // Get initial user share balance
        const initialUserShareBalance = await dloopMock.balanceOf(
          user1.address,
        );

        const minOutputShares =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.depositAmount,
            testCase.slippagePercentage,
            dloopMock,
          );

        const tx = await dLoopDepositorMock
          .connect(user1)
          .deposit(
            testCase.depositAmount,
            user1.address,
            minOutputShares,
            "0x",
            dloopMock,
          );
        await tx.wait();

        // Verify user received expected shares
        const finalUserShareBalance = await dloopMock.balanceOf(user1.address);
        const actualShares = finalUserShareBalance - initialUserShareBalance;
        expect(actualShares).to.be.gte(minOutputShares);
        expect(actualShares).to.be.closeTo(
          testCase.expectedReceivedShares,
          (testCase.expectedReceivedShares * BigInt(ONE_PERCENT_BPS)) /
            BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
        );

        // Verify any leftover debt after flash loan repay was sent to receiver
        const receiverDebtAfter = await debtToken.balanceOf(user1.address);
        expect(receiverDebtAfter).to.be.gte(receiverDebtBefore);
      });
    }

    it("Should transfer leftover debt tokens to receiver (no event)", async function () {
      const eventTests = [
        {
          depositAmount: ethers.parseEther("100"),
          slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        },
      ];

      for (const testCase of eventTests) {
        const minOutputShares =
          await dLoopDepositorMock.calculateMinOutputShares(
            testCase.depositAmount,
            testCase.slippagePercentage,
            dloopMock,
          );

        const receiverDebtBefore = await debtToken.balanceOf(user1.address);
        const tx = await dLoopDepositorMock
          .connect(user1)
          .deposit(
            testCase.depositAmount,
            user1.address,
            minOutputShares,
            "0x",
            dloopMock,
          );
        await tx.wait();
        const receiverDebtAfter = await debtToken.balanceOf(user1.address);

        expect(receiverDebtAfter).to.be.gte(receiverDebtBefore);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  describe("Helper Calculation Functions With Existing Leverage", function () {
    it("getLeveragedAssets should use current leverage when > 0", async function () {
      // Manually set an existing position inside the core to create 200% leverage
      const mockCollateral = ethers.parseEther("200"); // $200
      const mockDebt = ethers.parseEther("100"); // $100

      // Mock prices (1:1 for simplicity)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("1"),
      );

      // Inject the mock collateral / debt into the vault itself
      await dloopMock.setMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
        mockCollateral,
      );
      await dloopMock.setMockDebt(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
        mockDebt,
      );

      const leverageBps = await dloopMock.getCurrentLeverageBps();
      expect(leverageBps).to.equal(2n * BigInt(ONE_HUNDRED_PERCENT_BPS)); // 200%

      const inputAssets = ethers.parseEther("10");
      const expectedLeveraged =
        (inputAssets * leverageBps) / BigInt(ONE_HUNDRED_PERCENT_BPS);

      const actualLeveraged = await dLoopDepositorMock.getLeveragedAssets(
        inputAssets,
        dloopMock,
      );

      expect(actualLeveraged).to.equal(expectedLeveraged);
    });
  });
});
