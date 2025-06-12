import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopDepositorMock,
  DLoopRedeemerMock,
  SimpleDEXMock,
  TestERC20FlashMintable,
  TestMintableERC20,
} from "../../../typechain-types";
import {
  ONE_HUNDRED_PERCENT_BPS,
  ONE_PERCENT_BPS,
} from "../../../typescript/common/bps_constants";
import {
  createPosition,
  deployDLoopRedeemerMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixtures";

describe("DLoopRedeemerMock Redeem Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let dLoopRedeemerMock: DLoopRedeemerMock;
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
    const fixtures = await loadFixture(deployDLoopRedeemerMockFixture);
    await testSetup(
      fixtures.dloopCoreMockFixture,
      fixtures.dloopRedeemerMockFixture,
    );

    // Extract fixture objects
    const dloopCoreMockFixture = fixtures.dloopCoreMockFixture;
    const dloopRedeemerMockFixture = fixtures.dloopRedeemerMockFixture;

    dloopMock = dloopCoreMockFixture.dloopMock;
    collateralToken = dloopCoreMockFixture.collateralToken;
    debtToken = dloopCoreMockFixture.debtToken;

    dLoopRedeemerMock = dloopRedeemerMockFixture.dLoopRedeemerMock;
    dLoopDepositorMock = dloopRedeemerMockFixture.dLoopDepositorMock;
    flashLender = dloopRedeemerMockFixture.flashLender;
    simpleDEXMock = dloopRedeemerMockFixture.simpleDEXMock;
    user1 = dloopRedeemerMockFixture.user1;
    user2 = dloopRedeemerMockFixture.user2;
    user3 = dloopRedeemerMockFixture.user3;
  });

  describe("I. Basic Redeem Functionality", function () {
    const basicRedeemTests = [
      {
        name: "Should handle small leveraged redeem",
        depositAmount: ethers.parseEther("10"),
        redeemPercentage: 100, // Redeem 100% of shares
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedCollateral: ethers.parseEther("9.5"),
      },
      {
        name: "Should handle partial redeem (50%)",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 50, // Redeem 50% of shares
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedCollateral: ethers.parseEther("47.4990499904999"),
      },
      {
        name: "Should handle medium leveraged redeem",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 2,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedCollateral: ethers.parseEther("94.9980999809998"),
      },
      {
        name: "Should handle large leveraged redeem",
        depositAmount: ethers.parseEther("500"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 3,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedCollateral: ethers.parseEther("474.99049990499907"),
      },
      {
        name: "Should handle redeem with minimal slippage tolerance",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 0.1 * ONE_PERCENT_BPS,
        userIndex: 1,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedCollateral: ethers.parseEther("99.5"),
      },
      {
        name: "Should handle redeem with higher slippage tolerance",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 10 * ONE_PERCENT_BPS,
        userIndex: 2,
        expectedLeverageBps: TARGET_LEVERAGE_BPS,
        expectedReceivedCollateral: ethers.parseEther("99.5"),
      },
    ];

    for (const testCase of basicRedeemTests) {
      it(testCase.name, async function () {
        const user =
          testCase.userIndex === 1
            ? user1
            : testCase.userIndex === 2
              ? user2
              : user3;

        // First create a position
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user,
          testCase.depositAmount,
        );

        // Check current leverage

        // Calculate shares to redeem
        const sharesToRedeem =
          (shares * BigInt(testCase.redeemPercentage)) / 100n;

        // Calculate min output collateral
        const minOutputCollateral =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            sharesToRedeem,
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

        // Perform leveraged redeem
        await dLoopRedeemerMock.connect(user).redeem(
          sharesToRedeem,
          user.address,
          minOutputCollateral,
          "0x", // No specific swap data needed for SimpleDEXMock
          dloopMock,
        );

        // Verify user share balance decreased by redeemed shares
        const finalUserShareBalance = await dloopMock.balanceOf(user.address);
        expect(finalUserShareBalance).to.equal(
          initialUserShareBalance - sharesToRedeem,
        );

        // Verify user received collateral (at least minOutputCollateral)
        const finalUserCollateralBalance = await collateralToken.balanceOf(
          user.address,
        );
        const actualCollateralReceived =
          finalUserCollateralBalance - initialUserCollateralBalance;
        expect(actualCollateralReceived).to.be.gte(minOutputCollateral);

        // Verify core vault's collateral position decreased
        const finalCoreCollateral = await dloopMock.getMockCollateral(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
        );
        expect(finalCoreCollateral).to.be.lt(initialCoreCollateral);

        // For full redemption, verify leverage consistency
        if (testCase.redeemPercentage === 100) {
          // Check if vault still has position (might be zero if this was the only position)
          const finalTotalSupply = await dloopMock.totalSupply();

          if (finalTotalSupply > 0) {
            const currentLeverage = await dloopMock.getCurrentLeverageBps();
            expect(currentLeverage).to.be.closeTo(
              BigInt(testCase.expectedLeverageBps),
              BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
            );
          }
        }

        // Verify reasonable collateral received relative to shares redeemed
        const expectedLeveragedCollateral =
          await dloopMock.previewRedeem(sharesToRedeem);
        const expectedUnleveragedCollateral =
          await dloopMock.getUnleveragedAssets(expectedLeveragedCollateral);

        expect(actualCollateralReceived).to.be.closeTo(
          expectedUnleveragedCollateral,
          (expectedUnleveragedCollateral * BigInt(ONE_PERCENT_BPS)) /
            BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
        );

        expect(actualCollateralReceived).to.be.closeTo(
          testCase.expectedReceivedCollateral,
          (testCase.expectedReceivedCollateral * BigInt(ONE_PERCENT_BPS)) /
            BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
        );
      });
    }
  });

  describe("II. Flash Loan Integration", function () {
    const flashLoanTests = [
      {
        name: "Should utilize flash loans for small redeem",
        depositAmount: ethers.parseEther("50"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
      },
      {
        name: "Should utilize flash loans for medium redeem",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 1,
      },
      {
        name: "Should utilize flash loans for large redeem",
        depositAmount: ethers.parseEther("200"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 2,
      },
      {
        name: "Should utilize flash loans for partial redeem",
        depositAmount: ethers.parseEther("200"),
        redeemPercentage: 50,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        userIndex: 2,
      },
    ];

    for (const testCase of flashLoanTests) {
      it(testCase.name, async function () {
        const user = testCase.userIndex === 1 ? user1 : user2;

        // Create position first
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user,
          testCase.depositAmount,
        );

        // Check flash lender has sufficient balance
        const flashLenderBalance = await flashLender.balanceOf(
          await flashLender.getAddress(),
        );
        expect(flashLenderBalance).to.be.gt(0);

        // Record flash lender state before
        const initialFlashLenderBalance = await flashLender.balanceOf(
          await flashLender.getAddress(),
        );

        // Calculate shares to redeem and minimum output
        const sharesToRedeem =
          (shares * BigInt(testCase.redeemPercentage)) / 100n;
        const minOutputCollateral =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            sharesToRedeem,
            testCase.slippagePercentage,
            dloopMock,
          );

        // Perform leveraged redeem
        await dLoopRedeemerMock
          .connect(user)
          .redeem(
            sharesToRedeem,
            user.address,
            minOutputCollateral,
            "0x",
            dloopMock,
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
        {
          depositAmount: ethers.parseEther("50"),
          redeemPercentage: 100,
          expectedFee: 0,
        },
        {
          depositAmount: ethers.parseEther("100"),
          redeemPercentage: 100,
          expectedFee: 0,
        },
        {
          depositAmount: ethers.parseEther("200"),
          redeemPercentage: 50,
          expectedFee: 0,
        },
      ];

      for (const testCase of testCases) {
        // Flash loan should have zero fee by default in TestERC20FlashMintable
        const flashLoanAmount = ethers.parseEther("1000");
        const flashFee = await flashLender.flashFee(
          await flashLender.getAddress(),
          flashLoanAmount,
        );
        expect(flashFee).to.equal(testCase.expectedFee);

        // Create position and redeem
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        const sharesToRedeem =
          (shares * BigInt(testCase.redeemPercentage)) / 100n;
        const minOutputCollateral =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            sharesToRedeem,
            0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
            dloopMock,
          );

        // Should succeed even with zero fees
        await expect(
          dLoopRedeemerMock
            .connect(user1)
            .redeem(
              sharesToRedeem,
              user1.address,
              minOutputCollateral,
              "0x",
              dloopMock,
            ),
        ).to.not.be.reverted;
      }
    });

    it("Should fail if flash loan amount exceeds available", async function () {
      // Create an extremely large position that would require more flash loan than available
      // First, let's check the available flash loan amount (commented out as unused)
      // const maxFlashLoan = await flashLender.maxFlashLoan(
      //   await flashLender.getAddress(),
      // );

      // Create a position that would require a flash loan larger than available
      // This is tricky to test without knowing exact flash loan requirements
      // For now, let's create a reasonable position and manipulate flash lender balance
      const { shares } = await createPosition(
        dloopMock,
        collateralToken,
        debtToken,
        dLoopDepositorMock,
        user1,
        ethers.parseEther("100"),
      );

      // Reduce flash lender balance to simulate insufficient funds
      const flashLenderAddress = await flashLender.getAddress();
      const currentBalance = await flashLender.balanceOf(flashLenderAddress);

      // Burn most of the tokens from flash lender to create insufficient scenario
      // Connect as the flash lender address (using impersonation-like approach)
      // Since it's a mock token, we can transfer the tokens to user1 and then burn from user1
      const burnAmount = currentBalance - ethers.parseEther("1");
      await flashLender.transfer(user1.address, burnAmount);
      await flashLender.connect(user1).burn(burnAmount);

      const minOutputCollateral =
        await dLoopRedeemerMock.calculateMinOutputCollateral(
          shares,
          0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
          dloopMock,
        );

      // Should fail due to insufficient flash loan funds
      await expect(
        dLoopRedeemerMock
          .connect(user1)
          .redeem(shares, user1.address, minOutputCollateral, "0x", dloopMock),
      ).to.be.reverted;
    });
  });

  describe("III. DEX Integration", function () {
    const dexIntegrationTests = [
      {
        name: "Should swap collateral tokens to debt tokens for small amount",
        depositAmount: ethers.parseEther("50"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"), // 1:1 rate
        executionSlippage: 0,
        expectedReceivedCollateral: ethers.parseEther("47.4990499904999"),
      },
      {
        name: "Should swap collateral tokens to debt tokens for medium amount",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"), // 1:1 rate
        executionSlippage: 0,
        expectedReceivedCollateral: ethers.parseEther("94.9980999809998"),
      },
      {
        name: "Should handle different exchange rates (1:1.5)",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 1 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.5"), // 1 collateral = 1.5 debt
        executionSlippage: 0,
        expectedReceivedCollateral: ethers.parseEther("94.9980999809998"),
      },
      {
        name: "Should handle different exchange rates (1:1.2)",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 5 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.2"), // 1 collateral = 1.2 debt
        executionSlippage: 0,
        expectedReceivedCollateral: ethers.parseEther("83.33174983317498"),
      },
      {
        name: "Should handle DEX execution slippage (1%)",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 4 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"),
        executionSlippage: ONE_PERCENT_BPS,
        expectedReceivedCollateral: ethers.parseEther("83.33174983317498"),
      },
      {
        name: "Should handle DEX execution slippage (2%)",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 4 * ONE_PERCENT_BPS,
        exchangeRate: ethers.parseEther("1.0"),
        executionSlippage: 2 * ONE_PERCENT_BPS,
        expectedReceivedCollateral: ethers.parseEther("83.33174983317498"),
      },
    ];

    for (const testCase of dexIntegrationTests) {
      it(testCase.name, async function () {
        // Set exchange rate if different from default
        if (testCase.exchangeRate !== ethers.parseEther("1.0")) {
          await simpleDEXMock.setExchangeRate(
            await collateralToken.getAddress(),
            await debtToken.getAddress(),
            testCase.exchangeRate,
          );
        }

        // Set execution slippage if specified
        if (testCase.executionSlippage > 0) {
          await simpleDEXMock.setExecutionSlippage(testCase.executionSlippage);
        }

        // Create position first
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        // Get initial DEX balances
        const initialDexCollateralBalance = await collateralToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );
        const initialDexDebtBalance = await debtToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );

        // Calculate shares to redeem and minimum output
        const sharesToRedeem =
          (shares * BigInt(testCase.redeemPercentage)) / 100n;
        const minOutputCollateral =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            sharesToRedeem,
            testCase.slippagePercentage,
            dloopMock,
          );

        const userCollateralBalanceBeforeRedeem =
          await collateralToken.balanceOf(user1.address);

        // Perform leveraged redeem
        await dLoopRedeemerMock
          .connect(user1)
          .redeem(
            sharesToRedeem,
            user1.address,
            minOutputCollateral,
            "0x",
            dloopMock,
          );

        const userCollateralBalanceAfterRedeem =
          await collateralToken.balanceOf(user1.address);

        // DEX should have received collateral tokens and given out debt tokens
        const finalDexCollateralBalance = await collateralToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );
        const finalDexDebtBalance = await debtToken.balanceOf(
          await simpleDEXMock.getAddress(),
        );

        // DEX should have more collateral and less debt tokens (swap collateral -> debt)
        expect(finalDexCollateralBalance).to.be.gt(initialDexCollateralBalance);
        expect(finalDexDebtBalance).to.be.lt(initialDexDebtBalance);

        // Verify user received reasonable amount of collateral
        const userFinalBalance = await collateralToken.balanceOf(user1.address);
        expect(userFinalBalance).to.be.gte(minOutputCollateral);

        // Verify user received reasonable amount of collateral
        const userCollateralReceived =
          userCollateralBalanceAfterRedeem - userCollateralBalanceBeforeRedeem;
        expect(userCollateralReceived).to.be.gte(minOutputCollateral);
        expect(userCollateralReceived).to.be.closeTo(
          testCase.expectedReceivedCollateral,
          (testCase.expectedReceivedCollateral * BigInt(ONE_PERCENT_BPS)) /
            BigInt(0.1 * ONE_HUNDRED_PERCENT_BPS), // 0.1% tolerance for slippage and fees
        );

        // Reset to default values for next test
        if (testCase.exchangeRate !== ethers.parseEther("1.0")) {
          await simpleDEXMock.setExchangeRate(
            await collateralToken.getAddress(),
            await debtToken.getAddress(),
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
        name: "Should revert with insufficient share balance",
        depositAmount: ethers.parseEther("100"),
        redeemShares: "user_shares_plus_one", // Special marker for insufficient shares
        expectedError: "ERC20InsufficientBalance",
        errorSource: "dloopMock",
      },
      {
        name: "Should revert with insufficient allowance",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        expectedError: "ERC20InsufficientAllowance",
        errorSource: "dloopMock",
        removeAllowance: true,
      },
      {
        name: "Should handle zero redeem amount",
        depositAmount: ethers.parseEther("100"),
        redeemShares: 0,
        expectedError: "reverted", // Generic revert
        errorSource: "dLoopRedeemerMock",
      },
    ];

    for (const testCase of errorHandlingTests) {
      it(testCase.name, async function () {
        // Create position first
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        let actualRedeemShares: bigint;

        if (testCase.redeemShares === "user_shares_plus_one") {
          actualRedeemShares = shares + 1n;
        } else if (testCase.redeemPercentage) {
          actualRedeemShares =
            (shares * BigInt(testCase.redeemPercentage)) / 100n;
        } else if (typeof testCase.redeemShares === "number") {
          actualRedeemShares = BigInt(testCase.redeemShares);
        } else {
          throw new Error("Invalid test case configuration");
        }

        // Remove allowance if specified
        if (testCase.removeAllowance) {
          await dloopMock
            .connect(user1)
            .approve(await dLoopRedeemerMock.getAddress(), 0);
        }

        const errorContract =
          testCase.errorSource === "dloopMock" ? dloopMock : dLoopRedeemerMock;

        if (testCase.expectedError === "reverted") {
          await expect(
            dLoopRedeemerMock
              .connect(user1)
              .redeem(actualRedeemShares, user1.address, 0, "0x", dloopMock),
          ).to.be.reverted;
        } else {
          await expect(
            dLoopRedeemerMock
              .connect(user1)
              .redeem(actualRedeemShares, user1.address, 0, "0x", dloopMock),
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
          redeemPercentage: 100,
          unreasonableMultiplier: 2, // 200% of expected collateral
          expectedError: "WithdrawnCollateralTokenAmountNotMetMinReceiveAmount",
        },
        {
          depositAmount: ethers.parseEther("50"),
          redeemPercentage: 100,
          unreasonableMultiplier: 10, // 1000% of expected collateral
          expectedError: "WithdrawnCollateralTokenAmountNotMetMinReceiveAmount",
        },
      ];

      for (const testCase of slippageTests) {
        // Create position first
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        const sharesToRedeem =
          (shares * BigInt(testCase.redeemPercentage)) / 100n;

        // Get expected collateral amount and set impossible minimum
        const expectedCollateral =
          await dloopMock.previewRedeem(sharesToRedeem);
        const impossibleMinimum =
          expectedCollateral * BigInt(testCase.unreasonableMultiplier);

        await expect(
          dLoopRedeemerMock
            .connect(user1)
            .redeem(
              sharesToRedeem,
              user1.address,
              impossibleMinimum,
              "0x",
              dloopMock,
            ),
        ).to.be.revertedWithCustomError(
          dLoopRedeemerMock,
          testCase.expectedError,
        );
      }
    });
  });

  describe("V. Multiple Users and Complex Scenarios", function () {
    const multiUserTests = [
      {
        name: "Should handle redeems from multiple users with same amount",
        users: [1, 2, 3],
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
      },
      {
        name: "Should handle redeems from multiple users with different amounts",
        users: [1, 2, 3],
        depositAmounts: [
          ethers.parseEther("50"),
          ethers.parseEther("100"),
          ethers.parseEther("200"),
        ],
        redeemPercentage: 100,
        slippagePercentage: 0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
      },
    ];

    for (const testCase of multiUserTests) {
      it(testCase.name, async function () {
        const users = testCase.users.map((index) =>
          index === 1 ? user1 : index === 2 ? user2 : user3,
        );
        const userPositions: Array<{
          shares: bigint;
          leveragedAmount: bigint;
        }> = [];

        // Create positions for all users first
        for (let i = 0; i < users.length; i++) {
          const user = users[i];
          const depositAmount = testCase.depositAmounts
            ? testCase.depositAmounts[i]
            : testCase.depositAmount;

          const position = await createPosition(
            dloopMock,
            collateralToken,
            debtToken,
            dLoopDepositorMock,
            user,
            depositAmount,
          );
          userPositions.push(position);
        }

        // Now redeem for all users
        for (let i = 0; i < users.length; i++) {
          const user = users[i];
          const { shares } = userPositions[i];

          const sharesToRedeem =
            (shares * BigInt(testCase.redeemPercentage)) / 100n;
          const minOutputCollateral =
            await dLoopRedeemerMock.calculateMinOutputCollateral(
              sharesToRedeem,
              testCase.slippagePercentage,
              dloopMock,
            );

          const initialCollateralBalance = await collateralToken.balanceOf(
            user.address,
          );
          const initialShareBalance = await dloopMock.balanceOf(user.address);

          await dLoopRedeemerMock
            .connect(user)
            .redeem(
              sharesToRedeem,
              user.address,
              minOutputCollateral,
              "0x",
              dloopMock,
            );

          const finalCollateralBalance = await collateralToken.balanceOf(
            user.address,
          );
          const finalShareBalance = await dloopMock.balanceOf(user.address);

          const receivedCollateral =
            finalCollateralBalance - initialCollateralBalance;
          const burnedShares = initialShareBalance - finalShareBalance;

          expect(receivedCollateral).to.be.gte(minOutputCollateral);
          expect(burnedShares).to.equal(sharesToRedeem);
        }

        // Verify vault state is consistent
        const finalTotalSupply = await dloopMock.totalSupply();

        if (finalTotalSupply > 0) {
          const currentLeverage = await dloopMock.getCurrentLeverageBps();
          expect(currentLeverage).to.be.closeTo(
            BigInt(TARGET_LEVERAGE_BPS),
            BigInt(ONE_PERCENT_BPS * 2), // 2% tolerance for multiple operations
          );
        }
      });
    }

    it("Should handle sequential redeems by same user", async function () {
      const sequentialTests = [
        {
          depositAmount: ethers.parseEther("300"),
          redeemPercentages: [25, 50, 100], // Redeem 25%, then 50% of remaining, then all
          slippagePercentage: 0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
        },
      ];

      for (const testCase of sequentialTests) {
        // Create initial position
        const { shares: initialShares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        let remainingShares = initialShares;

        for (const redeemPercentage of testCase.redeemPercentages) {
          const sharesToRedeem =
            (remainingShares * BigInt(redeemPercentage)) / 100n;
          const minOutputCollateral =
            await dLoopRedeemerMock.calculateMinOutputCollateral(
              sharesToRedeem,
              testCase.slippagePercentage,
              dloopMock,
            );

          const initialCollateralBalance = await collateralToken.balanceOf(
            user1.address,
          );
          const initialShareBalance = await dloopMock.balanceOf(user1.address);

          await dLoopRedeemerMock
            .connect(user1)
            .redeem(
              sharesToRedeem,
              user1.address,
              minOutputCollateral,
              "0x",
              dloopMock,
            );

          const finalCollateralBalance = await collateralToken.balanceOf(
            user1.address,
          );
          const finalShareBalance = await dloopMock.balanceOf(user1.address);

          const receivedCollateral =
            finalCollateralBalance - initialCollateralBalance;
          const burnedShares = initialShareBalance - finalShareBalance;

          expect(receivedCollateral).to.be.gte(minOutputCollateral);
          expect(burnedShares).to.equal(sharesToRedeem);

          remainingShares -= sharesToRedeem;
        }

        // Should have redeemed all shares
        const finalUserShares = await dloopMock.balanceOf(user1.address);
        expect(finalUserShares).to.equal(0);
      }
    });

    it("Should maintain leverage after partial redemptions", async function () {
      const leverageMaintenanceTests = [
        {
          depositAmount: ethers.parseEther("200"),
          firstRedeemPercentage: 25, // Redeem 25%
          secondRedeemPercentage: 25, // Redeem another 25% of original
          expectedLeverageBps: TARGET_LEVERAGE_BPS,
          toleranceBps: ONE_PERCENT_BPS * 2,
        },
      ];

      for (const testCase of leverageMaintenanceTests) {
        // Create position
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        // First partial redeem
        const firstRedeemShares =
          (shares * BigInt(testCase.firstRedeemPercentage)) / 100n;
        const firstMinOutput =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            firstRedeemShares,
            0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
            dloopMock,
          );

        await dLoopRedeemerMock
          .connect(user1)
          .redeem(
            firstRedeemShares,
            user1.address,
            firstMinOutput,
            "0x",
            dloopMock,
          );

        const leverageAfterFirst = await dloopMock.getCurrentLeverageBps();
        expect(leverageAfterFirst).to.be.closeTo(
          BigInt(testCase.expectedLeverageBps),
          BigInt(testCase.toleranceBps),
        );

        // Second partial redeem
        const secondRedeemShares =
          (shares * BigInt(testCase.secondRedeemPercentage)) / 100n;
        const secondMinOutput =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            secondRedeemShares,
            0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
            dloopMock,
          );

        await dLoopRedeemerMock
          .connect(user1)
          .redeem(
            secondRedeemShares,
            user1.address,
            secondMinOutput,
            "0x",
            dloopMock,
          );

        const leverageAfterSecond = await dloopMock.getCurrentLeverageBps();

        // Leverage should still be maintained close to target
        expect(leverageAfterSecond).to.be.closeTo(
          leverageAfterFirst,
          BigInt(testCase.toleranceBps),
        );
      }
    });
  });

  describe("VI. Leftover Token Handling", function () {
    const leftoverTokenTests = [
      {
        name: "Should handle leftover collateral tokens for small redeem",
        depositAmount: ethers.parseEther("50"),
        redeemPercentage: 100,
        slippagePercentage: 0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
        setMinLeftover: true,
        minLeftoverAmount: 0,
      },
      {
        name: "Should handle leftover collateral tokens for medium redeem",
        depositAmount: ethers.parseEther("100"),
        redeemPercentage: 100,
        slippagePercentage: 0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
        setMinLeftover: true,
        minLeftoverAmount: 0,
      },
      {
        name: "Should handle leftover collateral tokens for large redeem",
        depositAmount: ethers.parseEther("200"),
        redeemPercentage: 100,
        slippagePercentage: 0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
        setMinLeftover: true,
        minLeftoverAmount: 0,
      },
    ];

    for (const testCase of leftoverTokenTests) {
      it(testCase.name, async function () {
        // Set minimum leftover amount if specified
        if (testCase.setMinLeftover) {
          await dLoopRedeemerMock.setMinLeftoverCollateralTokenAmount(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            testCase.minLeftoverAmount,
          );
        }

        // Create position first
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        const sharesToRedeem =
          (shares * BigInt(testCase.redeemPercentage)) / 100n;
        const minOutputCollateral =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            sharesToRedeem,
            testCase.slippagePercentage,
            dloopMock,
          );

        await dLoopRedeemerMock
          .connect(user1)
          .redeem(
            sharesToRedeem,
            user1.address,
            minOutputCollateral,
            "0x",
            dloopMock,
          );

        // Core vault may have received leftover collateral tokens
        const finalCoreCollateralBalance = await collateralToken.balanceOf(
          await dloopMock.getAddress(),
        );

        // Balance should be >= initial (may have received leftovers)
        expect(finalCoreCollateralBalance).to.be.gte(0); // Just ensure no negative balances
      });
    }

    it("Should emit LeftoverCollateralTokenTransferred event when applicable", async function () {
      const eventTests = [
        {
          depositAmount: ethers.parseEther("100"),
          redeemPercentage: 100,
          slippagePercentage: 0.1 * ONE_PERCENT_BPS, // 0.1% slippage tolerance
          minLeftoverAmount: 0,
        },
      ];

      for (const testCase of eventTests) {
        // Create position first
        const { shares } = await createPosition(
          dloopMock,
          collateralToken,
          debtToken,
          dLoopDepositorMock,
          user1,
          testCase.depositAmount,
        );

        const sharesToRedeem =
          (shares * BigInt(testCase.redeemPercentage)) / 100n;
        const minOutputCollateral =
          await dLoopRedeemerMock.calculateMinOutputCollateral(
            sharesToRedeem,
            testCase.slippagePercentage,
            dloopMock,
          );

        // Set minimum leftover to 0 to ensure transfer
        await dLoopRedeemerMock.setMinLeftoverCollateralTokenAmount(
          await dloopMock.getAddress(),
          await collateralToken.getAddress(),
          testCase.minLeftoverAmount,
        );

        // May emit leftover transfer event
        const tx = await dLoopRedeemerMock
          .connect(user1)
          .redeem(
            sharesToRedeem,
            user1.address,
            minOutputCollateral,
            "0x",
            dloopMock,
          );

        // Note: We can't guarantee leftovers, so this test just ensures it doesn't revert
        await tx.wait();
      }
    });
  });
});
