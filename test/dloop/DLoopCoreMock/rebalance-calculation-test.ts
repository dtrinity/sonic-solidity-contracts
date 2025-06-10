import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import {
  ONE_BPS_UNIT,
  ONE_HUNDRED_PERCENT_BPS,
  ONE_PERCENT_BPS,
} from "../../../typescript/common/bps_constants";
import {
  deployDLoopMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixture";

describe("DLoopCoreMock Rebalance Calculation Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let _otherToken: TestMintableERC20;
  let _accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    _accounts = fixture.accounts;

    // Deploy an additional token for testing calculation functionality
    const TestMintableERC20Factory =
      await ethers.getContractFactory("TestMintableERC20");
    _otherToken = await TestMintableERC20Factory.deploy(
      "Other Token",
      "OTHER",
      8, // Different decimals for testing
    );
  });

  describe("I. Rebalance Calculation Functions", function () {
    describe("getAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        currentCollateral: bigint;
        currentDebt: bigint;
        vaultCollateralBalance?: bigint;
        vaultDebtBalance?: bigint;
        expectedDirection: number;
        expectedAmount: bigint;
        useVaultTokenBalance: boolean;
      }[] = [
        {
          name: "Should return increase direction when leverage is below target",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("50"), // $50
          // Current leverage: 200/(200-50) = 133.33%
          expectedDirection: 1, // Increase
          expectedAmount: ethers.parseUnits("242.71844660194174", 18), // Based on actual test result
          useVaultTokenBalance: false,
        },
        {
          name: "Should return no rebalance when leverage equals target",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("200"), // $200
          // Current leverage: 300/(300-200) = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle vault token balance mode for increase",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("50"), // $50
          vaultCollateralBalance: ethers.parseEther("10"), // 10 tokens in vault
          expectedDirection: 1, // Increase
          expectedAmount: ethers.parseUnits("232.718446601941747572", 18), // Based on actual test result
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle very low leverage",
          currentCollateral: ethers.parseEther("1000"), // $1000
          currentDebt: ethers.parseEther("10"), // $10
          // Current leverage: 1000/(1000-10) ≈ 101%
          expectedDirection: 1, // Increase to reach 300%
          expectedAmount: ethers.parseUnits("1912.621359223300970873", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle zero collateral and debt",
          currentCollateral: 0n,
          currentDebt: 0n,
          expectedDirection: 0, // No rebalance needed
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle small differences near target",
          currentCollateral: ethers.parseEther("299"), // $299
          currentDebt: ethers.parseEther("199.33"), // Close to 300%
          expectedDirection: 1, // Still slightly below target so needs increase
          expectedAmount: ethers.parseUnits("0.009999010098000297", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle moderate above-target leverage",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("200"), // $200
          // Current leverage: 350/(350-200) = 233.33%
          expectedDirection: 1, // Still need to increase to reach 300%
          expectedAmount: ethers.parseUnits("97.087378640776699029", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle below-target leverage with vault balance",
          currentCollateral: ethers.parseEther("250"), // $250
          currentDebt: ethers.parseEther("50"), // $50
          vaultCollateralBalance: ethers.parseEther("5"),
          expectedDirection: 1, // Increase
          expectedAmount: ethers.parseUnits("334.805825242718446601", 18),
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle exact target leverage with vault balance",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("200"), // $200
          vaultCollateralBalance: ethers.parseEther("1"),
          expectedDirection: 0, // Already at target
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle fractional amounts",
          currentCollateral: ethers.parseEther("150.5"), // $150.5
          currentDebt: ethers.parseEther("25.1"), // $25.1
          // Current leverage: 150.5/(150.5-25.1) ≈ 150.5/125.4 ≈ 120.09%
          expectedDirection: 1, // Increase
          expectedAmount: ethers.parseUnits("219.126213592233009708", 18),
          useVaultTokenBalance: false,
        },

        // Additional test cases for expectedDirection: -1 (decrease leverage)
        {
          name: "Should return decrease direction when leverage is above target",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("225"), // $225
          // Current leverage: 300/(300-225) = 300/75 = 400%
          expectedDirection: -1, // Decrease
          expectedAmount: ethers.parseUnits("0.002499916669444351", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle high leverage scenario requiring decrease",
          currentCollateral: ethers.parseEther("400"), // $400
          currentDebt: ethers.parseEther("300"), // $300
          // Current leverage: 400/(400-300) = 400/100 = 400%
          expectedDirection: -1, // Decrease
          expectedAmount: ethers.parseUnits("0.003333222225925802", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle moderate above-target leverage requiring decrease",
          currentCollateral: ethers.parseEther("500"), // $500
          currentDebt: ethers.parseEther("375"), // $375
          // Current leverage: 500/(500-375) = 500/125 = 400%
          expectedDirection: -1, // Decrease
          expectedAmount: ethers.parseUnits("0.004166527782407253", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle extreme high leverage requiring decrease",
          currentCollateral: ethers.parseEther("1000"), // $1000
          currentDebt: ethers.parseEther("900"), // $900
          // Current leverage: 1000/(1000-900) = 1000/100 = 1000%
          expectedDirection: -1, // Decrease
          expectedAmount: ethers.parseUnits("0.023332555581480617", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle slightly above target leverage",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("201"), // $201
          // Current leverage: 300/(300-201) = 300/99 ≈ 303%
          expectedDirection: -1, // Decrease
          expectedAmount: ethers.parseUnits("0.000099996666777774", 18),
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle above-target leverage with vault balance",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("280"), // $280
          // Current leverage: 350/(350-280) = 350/70 = 500%
          vaultDebtBalance: ethers.parseEther("5"),
          expectedDirection: -1, // Decrease
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle high leverage with sufficient vault debt balance",
          currentCollateral: ethers.parseEther("400"), // $400
          currentDebt: ethers.parseEther("320"), // $320
          // Current leverage: 400/(400-320) = 400/80 = 500%
          vaultDebtBalance: ethers.parseEther("100"), // Large vault balance
          expectedDirection: -1, // Decrease
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle large amounts requiring decrease",
          currentCollateral: ethers.parseEther("100000"), // $100,000
          currentDebt: ethers.parseEther("80000"), // $80,000
          // Current leverage: 100000/(100000-80000) = 100000/20000 = 500%
          expectedDirection: -1, // Decrease
          expectedAmount: ethers.parseUnits("1.333288890370320989", 18),
          // Leverage after rebalance: (100000-1.333288890370320989)/(100000-1.333288890370320989-80000+1.333288890370320989) ~ 500%
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle fractional amounts requiring decrease",
          currentCollateral: ethers.parseEther("123.45"), // $123.45
          currentDebt: ethers.parseEther("100.5"), // $100.5
          // Current leverage: 123.45/(123.45-100.5) = 123.45/22.95 ≈ 538%
          expectedDirection: -1, // Decrease
          expectedAmount: ethers.parseUnits("0.001819939335355488", 18),
          useVaultTokenBalance: false,
        },

        // Additional test cases for expectedDirection: 0 (no rebalance)
        {
          name: "Should handle exact target leverage with different amounts",
          currentCollateral: ethers.parseEther("600"), // $600
          currentDebt: ethers.parseEther("400"), // $400
          // Current leverage: 600/(600-400) = 600/200 = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle target leverage with fractional amounts",
          currentCollateral: ethers.parseEther("150"), // $150
          currentDebt: ethers.parseEther("100"), // $100
          // Current leverage: 150/(150-100) = 150/50 = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle target leverage with large amounts",
          currentCollateral: ethers.parseEther("30000"), // $30,000
          currentDebt: ethers.parseEther("20000"), // $20,000
          // Current leverage: 30000/(30000-20000) = 30000/10000 = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle target leverage with vault collateral balance",
          currentCollateral: ethers.parseEther("450"), // $450
          currentDebt: ethers.parseEther("300"), // $300
          // Current leverage: 450/(450-300) = 450/150 = 300%
          vaultCollateralBalance: ethers.parseEther("10"),
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle target leverage with vault debt balance",
          currentCollateral: ethers.parseEther("750"), // $750
          currentDebt: ethers.parseEther("500"), // $500
          // Current leverage: 750/(750-500) = 750/250 = 300%
          vaultDebtBalance: ethers.parseEther("8"),
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },

        // Additional test cases for useVaultTokenBalance: true
        {
          name: "Should handle low leverage with large vault collateral balance",
          currentCollateral: ethers.parseEther("100"), // $100
          currentDebt: ethers.parseEther("10"), // $10
          // Current leverage: 100/(100-10) = 100/90 ≈ 111%
          vaultCollateralBalance: ethers.parseEther("50"), // Large vault balance
          expectedDirection: 1, // Increase
          expectedAmount: ethers.parseUnits("115.048543689320388349", 18),
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle medium leverage with vault collateral balance",
          currentCollateral: ethers.parseEther("250"), // $250
          currentDebt: ethers.parseEther("125"), // $125
          // Current leverage: 250/(250-125) = 250/125 = 200%
          vaultCollateralBalance: ethers.parseEther("15"),
          expectedDirection: 1, // Increase
          expectedAmount: ethers.parseUnits("106.359223300970873786", 18),
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle high leverage with small vault debt balance",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("175"), // $175
          // Current leverage: 200/(200-175) = 200/25 = 800%
          vaultDebtBalance: ethers.parseEther("2"), // Small vault balance
          expectedDirection: -1, // Decrease
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle high leverage with large vault debt balance",
          currentCollateral: ethers.parseEther("500"), // $500
          currentDebt: ethers.parseEther("450"), // $450
          // Current leverage: 500/(500-450) = 500/50 = 1000%
          vaultDebtBalance: ethers.parseEther("200"), // Very large vault balance
          expectedDirection: -1, // Decrease
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle vault balance with both collateral and debt tokens",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("100"), // $100
          // Current leverage: 350/(350-100) = 350/250 = 140%
          vaultCollateralBalance: ethers.parseEther("20"),
          vaultDebtBalance: ethers.parseEther("5"), // Both vault balances
          expectedDirection: 1, // Increase
          expectedAmount: ethers.parseUnits("368.349514563106796116", 18),
          useVaultTokenBalance: true,
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Set up prices
          const collateralPrice = ethers.parseEther("1"); // $1 per token
          const debtPrice = ethers.parseEther("1"); // $1 per token

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            collateralPrice,
          );
          await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

          // Set up mock collateral and debt
          await dloopMock.setMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            testCase.currentCollateral,
          );
          await dloopMock.setMockDebt(
            await dloopMock.getAddress(),
            await debtToken.getAddress(),
            testCase.currentDebt,
          );

          // Set up vault balances if specified
          if (testCase.vaultCollateralBalance) {
            await collateralToken.mint(
              await dloopMock.getAddress(),
              testCase.vaultCollateralBalance,
            );
          }

          if (testCase.vaultDebtBalance) {
            await debtToken.mint(
              await dloopMock.getAddress(),
              testCase.vaultDebtBalance,
            );
          }

          const [tokenAmount, direction] =
            await dloopMock.getAmountToReachTargetLeverage(
              testCase.useVaultTokenBalance,
            );

          expect(direction).to.equal(testCase.expectedDirection);

          // Check amount with ±0.5% tolerance
          if (testCase.expectedAmount === 0n) {
            expect(tokenAmount).to.equal(0n);
          } else {
            const expectedAmount = testCase.expectedAmount;
            const tolerance = (expectedAmount * 5n) / 1000n; // 0.5% tolerance
            const minAmount = expectedAmount - tolerance;
            const maxAmount = expectedAmount + tolerance;

            expect(tokenAmount).to.be.gte(
              minAmount,
              `Amount ${tokenAmount} should be >= ${minAmount}`,
            );
            expect(tokenAmount).to.be.lte(
              maxAmount,
              `Amount ${tokenAmount} should be <= ${maxAmount}`,
            );
          }

          // Get the current subsidy bps
          const subsidyBps = await dloopMock.getCurrentSubsidyBps();

          // Make sure the expected amount leads to the target leverage
          const [totalCollateralInBase, totalDebtInBase] =
            await dloopMock.getTotalCollateralAndDebtOfUserInBase(
              await dloopMock.getAddress(),
            );

          let rebalanceAmount = tokenAmount;

          // If useVaultTokenBalance is true, we need to add the vault token balance to the rebalance amount
          // because the vault token balance is already included in the formula
          // of getAmountToReachTargetLeverage
          if (testCase.useVaultTokenBalance) {
            if (direction > 0) {
              const valutCollateralBalanceInBase =
                await dloopMock.convertFromTokenAmountToBaseCurrency(
                  testCase.vaultCollateralBalance ?? 0n,
                  await collateralToken.getAddress(),
                );
              rebalanceAmount += valutCollateralBalanceInBase;
            } else if (direction < 0) {
              const valutDebtBalanceInBase =
                await dloopMock.convertFromTokenAmountToBaseCurrency(
                  testCase.vaultDebtBalance ?? 0n,
                  await debtToken.getAddress(),
                );
              rebalanceAmount += valutDebtBalanceInBase;
            }
          }

          if (direction !== 0n) {
            const oneHundredPercentBps = BigInt(ONE_HUNDRED_PERCENT_BPS);
            const newLeverage =
              ((totalCollateralInBase + direction * rebalanceAmount) *
                oneHundredPercentBps) /
              (totalCollateralInBase +
                direction * rebalanceAmount -
                totalDebtInBase -
                (direction *
                  rebalanceAmount *
                  (oneHundredPercentBps + subsidyBps)) /
                  oneHundredPercentBps);
            expect(newLeverage).to.be.closeTo(
              BigInt(TARGET_LEVERAGE_BPS),
              ONE_BPS_UNIT, // very small tolerance
            );
          }
        });
      }
    });
  });

  describe("II. Internal Calculation Functions", function () {
    describe("_getCollateralTokenAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        targetLeverage: bigint;
        totalCollateralBase: bigint;
        totalDebtBase: bigint;
        subsidy: bigint;
        useVaultTokenBalance: boolean;
        expectedAmount: bigint;
        shouldThrow?: boolean;
      }[] = [
        {
          name: "Should calculate collateral needed for below-target leverage (200% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("50", 8), // $50, gives 133% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("250", 18),
        },
        {
          name: "Should handle exact target leverage scenario",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives exactly 300% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
        },
        {
          name: "Should handle zero position",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: 0n,
          totalDebtBase: 0n,
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          shouldThrow: true,
        },
        {
          name: "Should handle very low leverage (101% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("1000", 8), // $1000
          totalDebtBase: ethers.parseUnits("10", 8), // $10, gives ~101% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("1970", 18),
        },
        {
          name: "Should handle moderate leverage gap (233% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("350", 8), // $350
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives 233% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("100", 18),
        },
        {
          name: "Should handle small differences near target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("299", 8), // $299
          totalDebtBase: ethers.parseUnits("199.33", 8), // $199.33, close to 300% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("0.01", 18),
        },
        {
          name: "Should handle fractional amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("150.5", 8), // $150.5
          totalDebtBase: ethers.parseUnits("25.1", 8), // $25.1, gives ~120% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("225.7", 18),
        },
        {
          name: "Should handle large amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("100000", 8), // $100,000
          totalDebtBase: ethers.parseUnits("10000", 8), // $10,000, gives ~111% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("170000", 18),
        },
        {
          name: "Should handle with subsidy - below target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("50", 8), // $50
          subsidy: ethers.parseUnits("500", 8), // 5% subsidy
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("0.00166665", 18),
        },
        {
          name: "Should handle with high subsidy",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 133% leverage
          subsidy: ethers.parseUnits("1000", 8), // 10% subsidy
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("0.00166666", 18),
        },
        {
          name: "Should handle vault token balance mode - below target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("50", 8), // $50
          subsidy: 0n,
          useVaultTokenBalance: true,
          expectedAmount: ethers.parseUnits("250", 18),
        },
        {
          name: "Should handle vault token balance mode - at target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("200", 8), // $200
          subsidy: 0n,
          useVaultTokenBalance: true,
          expectedAmount: 0n,
        },
        {
          name: "Should handle vault token balance mode with subsidy",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("250", 8), // $250
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 167% leverage
          subsidy: ethers.parseUnits("200", 8), // 2% subsidy
          useVaultTokenBalance: true,
          expectedAmount: ethers.parseUnits("0.00333327", 18),
        },
        {
          name: "Should handle different target leverage (400%)",
          targetLeverage: BigInt(400 * ONE_PERCENT_BPS), // 400%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 150% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("500", 18),
        },
        {
          name: "Should handle different target leverage (500%)",
          targetLeverage: BigInt(500 * ONE_PERCENT_BPS), // 500%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives 200% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("600", 18),
        },
        {
          name: "Should handle edge case - very high leverage target (1000%)",
          targetLeverage: BigInt(1000 * ONE_PERCENT_BPS), // 1000%
          totalCollateralBase: ethers.parseUnits("100", 8), // $100
          totalDebtBase: ethers.parseUnits("50", 8), // $50, gives 200% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("400", 18),
        },
        {
          name: "Should handle minimal position amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("1", 8), // $1
          totalDebtBase: ethers.parseUnits("0.1", 8), // $0.1, gives ~111% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: ethers.parseUnits("1.7", 18),
        },
        {
          name: "Should handle debt-only position (infinite leverage to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("0.01", 8), // Very small collateral
          totalDebtBase: ethers.parseUnits("100", 8), // $100 debt
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          shouldThrow: true, // Arithmetic overflow expected
        },
        {
          name: "Should handle high subsidy with vault tokens",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("500", 8), // $500
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives 167% leverage
          subsidy: ethers.parseUnits("1500", 8), // 15% subsidy
          useVaultTokenBalance: true,
          expectedAmount: ethers.parseUnits("0.00088888", 18),
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Set up prices
          const collateralPrice = ethers.parseUnits("1", 8); // $1 per token
          const debtPrice = ethers.parseUnits("1", 8); // $1 per token

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            collateralPrice,
          );
          await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

          if (testCase.shouldThrow) {
            await expect(
              dloopMock.testGetCollateralTokenAmountToReachTargetLeverage(
                testCase.targetLeverage,
                testCase.totalCollateralBase,
                testCase.totalDebtBase,
                testCase.subsidy,
                testCase.useVaultTokenBalance,
              ),
            ).to.be.reverted;
          } else {
            const result =
              await dloopMock.testGetCollateralTokenAmountToReachTargetLeverage(
                testCase.targetLeverage,
                testCase.totalCollateralBase,
                testCase.totalDebtBase,
                testCase.subsidy,
                testCase.useVaultTokenBalance,
              );

            // Check amount with ±0.5% tolerance
            if (testCase.expectedAmount === 0n) {
              expect(result).to.equal(0n);
            } else {
              const expectedAmount = testCase.expectedAmount;
              const tolerance = (expectedAmount * 5n) / 1000n; // 0.5% tolerance
              const minAmount = expectedAmount - tolerance;
              const maxAmount = expectedAmount + tolerance;

              expect(result).to.be.gte(
                minAmount,
                `Amount ${result} should be >= ${minAmount}`,
              );
              expect(result).to.be.lte(
                maxAmount,
                `Amount ${result} should be <= ${maxAmount}`,
              );
            }
          }
        });
      }
    });

    describe("_getDebtTokenAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        targetLeverage: bigint;
        totalCollateralBase: bigint;
        totalDebtBase: bigint;
        subsidy: bigint;
        useVaultTokenBalance: boolean;
        expectedAmount: bigint;
        expectedToThrow: boolean;
      }[] = [
        {
          name: "Should return 0 when at target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives exactly 300% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: false,
        },
        {
          name: "Should handle zero position",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: 0n,
          totalDebtBase: 0n,
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true, // Should throw for zero collateral
        },
        {
          name: "Should throw for low leverage scenario requiring debt increase",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("600", 8), // $600
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 120% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle vault token balance mode with low leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 125% leverage
          subsidy: 0n,
          useVaultTokenBalance: true,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle small fractional amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("450.5", 8), // $450.5
          totalDebtBase: ethers.parseUnits("120.1", 8), // $120.1, gives ~136% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle large amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("500000", 8), // $500,000
          totalDebtBase: ethers.parseUnits("100000", 8), // $100,000, gives 125% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle near-target with vault balance",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("305", 8), // $305
          totalDebtBase: ethers.parseUnits("195", 8), // $195, gives ~277% leverage
          subsidy: 0n,
          useVaultTokenBalance: true,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle moderate leverage gap",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("450", 8), // $450
          totalDebtBase: ethers.parseUnits("150", 8), // $150, gives 150% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle different target leverage scenarios",
          targetLeverage: BigInt(400 * ONE_PERCENT_BPS), // 400%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 133% leverage, target 400%
          subsidy: ethers.parseUnits("200", 8), // 2% subsidy
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle high collateral, low debt scenario",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("900", 8), // $900
          totalDebtBase: ethers.parseUnits("50", 8), // $50, gives ~106% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle with subsidy - below target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("500", 8), // $500
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 125% leverage
          subsidy: ethers.parseUnits("1000", 8), // 10% subsidy
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle vault mode with different leverage target",
          targetLeverage: BigInt(500 * ONE_PERCENT_BPS), // 500%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 150% leverage
          subsidy: 0n,
          useVaultTokenBalance: true,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle edge case - very high target leverage",
          targetLeverage: BigInt(1000 * ONE_PERCENT_BPS), // 1000%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("50", 8), // $50, gives 200% leverage
          subsidy: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle minimal amounts with subsidy",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("2", 8), // $2
          totalDebtBase: ethers.parseUnits("0.5", 8), // $0.5, gives ~111% leverage
          subsidy: ethers.parseUnits("500", 8), // 5% subsidy
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
        {
          name: "Should handle vault mode with high subsidy",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("1000", 8), // $1000
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives 125% leverage
          subsidy: ethers.parseUnits("2000", 8), // 20% subsidy
          useVaultTokenBalance: true,
          expectedAmount: 0n,
          expectedToThrow: true,
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Set up prices
          const collateralPrice = ethers.parseUnits("1", 8); // $1 per token
          const debtPrice = ethers.parseUnits("1", 8); // $1 per token

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            collateralPrice,
          );
          await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

          if (testCase.expectedToThrow) {
            // Test that the function throws an error
            await expect(
              dloopMock.testGetDebtTokenAmountToReachTargetLeverage(
                testCase.targetLeverage,
                testCase.totalCollateralBase,
                testCase.totalDebtBase,
                testCase.subsidy,
                testCase.useVaultTokenBalance,
              ),
            ).to.be.reverted; // Any revert is acceptable
          } else {
            const result =
              await dloopMock.testGetDebtTokenAmountToReachTargetLeverage(
                testCase.targetLeverage,
                testCase.totalCollateralBase,
                testCase.totalDebtBase,
                testCase.subsidy,
                testCase.useVaultTokenBalance,
              );

            // Check amount with ±0.5% tolerance
            if (testCase.expectedAmount === 0n) {
              expect(result).to.equal(0n);
            } else {
              const expectedAmount = testCase.expectedAmount;
              const tolerance = (expectedAmount * 5n) / 1000n; // 0.5% tolerance
              const minAmount = expectedAmount - tolerance;
              const maxAmount = expectedAmount + tolerance;

              expect(result).to.be.gte(
                minAmount,
                `Amount ${result} should be >= ${minAmount}`,
              );
              expect(result).to.be.lte(
                maxAmount,
                `Amount ${result} should be <= ${maxAmount}`,
              );
            }
          }
        });
      }
    });
  });
});
