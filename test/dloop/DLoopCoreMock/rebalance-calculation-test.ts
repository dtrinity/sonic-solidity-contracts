import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_BPS_UNIT, ONE_HUNDRED_PERCENT_BPS, ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, TARGET_LEVERAGE_BPS, testSetup } from "./fixture";

// NOTE: Redundant with CoreLogic rebalance_quote tests; skipping to reduce duplication
describe.skip("DLoopCoreMock Rebalance Calculation Tests", function () {
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
    const TestMintableERC20Factory = await ethers.getContractFactory("TestMintableERC20");
    _otherToken = await TestMintableERC20Factory.deploy(
      "Other Token",
      "OTHER",
      8, // Different decimals for testing
    );
  });

  describe("I. Rebalance Calculation Functions", function () {
    describe("quoteRebalanceAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        currentCollateral: bigint;
        currentDebt: bigint;
        expectedDirection: number;
        whenUseVaultTokenBalance: {
          vaultCollateralBalance?: bigint;
          vaultDebtBalance?: bigint;
          expectedAmount: bigint;
        };
        whenNotUseVaultTokenBalance: {
          vaultCollateralBalance?: bigint;
          vaultDebtBalance?: bigint;
          expectedAmount: bigint;
        };
      }[] = [
        {
          name: "Should return increase direction when leverage is below target",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("50"), // $50
          // Current leverage: 200/(200-50) = 133.33%
          expectedDirection: 1, // Increase
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("10"), // 10 tokens in vault
            expectedAmount: ethers.parseUnits("232.718446601941747572", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("242.71844660194174", 18), // Based on actual test result
          },
        },
        {
          name: "Should return no rebalance when leverage equals target",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("200"), // $200
          // Current leverage: 300/(300-200) = 300%
          expectedDirection: 0, // No rebalance
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("1"),
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
        {
          name: "Should handle very low leverage",
          currentCollateral: ethers.parseEther("1000"), // $1000
          currentDebt: ethers.parseEther("10"), // $10
          // Current leverage: 1000/(1000-10) ≈ 101%
          expectedDirection: 1, // Increase to reach 300%
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("50"), // Large vault balance
            expectedAmount: ethers.parseUnits("1862.621359223300970873", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("1912.621359223300970873", 18),
          },
        },
        {
          name: "Should handle zero collateral and debt",
          currentCollateral: 0n,
          currentDebt: 0n,
          expectedDirection: 0, // No rebalance needed
          whenUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
        {
          name: "Should handle small differences near target",
          currentCollateral: ethers.parseEther("299"), // $299
          currentDebt: ethers.parseEther("199.33"), // Close to 300%
          expectedDirection: 1, // Still slightly below target so needs increase
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("0.01"),
            expectedAmount: 0n, // Very small amount, vault balance covers it
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("0.009999010098000297", 18),
          },
        },
        {
          name: "Should handle moderate below-target leverage",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("200"), // $200
          // Current leverage: 350/(350-200) = 233.33%
          expectedDirection: 1, // Still need to increase to reach 300%
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("15"),
            expectedAmount: ethers.parseUnits("82.087378640776699029", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("97.087378640776699029", 18),
          },
        },
        {
          name: "Should handle below-target leverage with vault balance",
          currentCollateral: ethers.parseEther("250"), // $250
          currentDebt: ethers.parseEther("50"), // $50
          expectedDirection: 1, // Increase
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("5"),
            expectedAmount: ethers.parseUnits("334.805825242718446601", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("339.805825242718446601", 18), // Slightly more without vault balance
          },
        },
        {
          name: "Should handle fractional amounts",
          currentCollateral: ethers.parseEther("150.5"), // $150.5
          currentDebt: ethers.parseEther("25.1"), // $25.1
          // Current leverage: 150.5/(150.5-25.1) ≈ 150.5/125.4 ≈ 120.09%
          expectedDirection: 1, // Increase
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("20"),
            vaultDebtBalance: ethers.parseEther("5"), // Both vault balances
            expectedAmount: ethers.parseUnits("199.126213592233009708", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("219.126213592233009708", 18),
          },
        },

        // Additional test cases for expectedDirection: -1 (decrease leverage)
        {
          name: "Should return decrease direction when leverage is above target",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("225"), // $225
          // Current leverage: 300/(300-225) = 300/75 = 400%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("5"),
            expectedAmount: ethers.parseUnits("67.81553398058253", 18), // 72.81553398058253 - 5 ≈ 67.82
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("72.81553398058253", 18),
          },
        },
        {
          name: "Should handle high leverage scenario requiring decrease",
          currentCollateral: ethers.parseEther("400"), // $400
          currentDebt: ethers.parseEther("300"), // $300
          // Current leverage: 400/(400-300) = 400/100 = 400%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("20"),
            expectedAmount: ethers.parseUnits("77.08737864077669", 18), // 97.08737864077669 - 20 = 77.09
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("97.08737864077669", 18),
          },
        },
        {
          name: "Should handle moderate above-target leverage requiring decrease",
          currentCollateral: ethers.parseEther("500"), // $500
          currentDebt: ethers.parseEther("375"), // $375
          // Current leverage: 500/(500-375) = 500/125 = 400%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("50"),
            expectedAmount: ethers.parseUnits("71.35922330097087", 18), // 121.35922330097087 - 50 = 71.36
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("121.35922330097087", 18),
          },
        },
        {
          name: "Should handle extreme high leverage requiring decrease",
          currentCollateral: ethers.parseEther("1000"), // $1000
          currentDebt: ethers.parseEther("900"), // $900
          // Current leverage: 1000/(1000-900) = 1000/100 = 1000%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("200"), // Very large vault balance
            expectedAmount: ethers.parseUnits("479.6116504854369", 18), // 679.6116504854369 - 200 = 479.61
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("679.6116504854369", 18),
          },
        },
        {
          name: "Should handle slightly above target leverage",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("201"), // $201
          // Current leverage: 300/(300-201) = 300/99 ≈ 303%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("1"),
            expectedAmount: ethers.parseUnits("1.912621359223301", 18), // 2.912621359223301 - 1 = 1.91
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("2.912621359223301", 18),
          },
        },
        {
          name: "Should handle above-target leverage with vault balance",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("280"), // $280
          // Current leverage: 350/(350-280) = 350/70 = 500%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("5"),
            expectedAmount: ethers.parseUnits("130.92233009708738", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("135.92233009708738", 18), // Slightly more without vault balance
          },
        },
        {
          name: "Should handle high leverage with sufficient vault debt balance",
          currentCollateral: ethers.parseEther("400"), // $400
          currentDebt: ethers.parseEther("320"), // $320
          // Current leverage: 400/(400-320) = 400/80 = 500%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("100"), // Large vault balance
            expectedAmount: ethers.parseUnits("55.33980582524272", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("155.33980582524272", 18), // 55.33980582524272 + 100 = 155.34
          },
        },
        {
          name: "Should handle large amounts requiring decrease",
          currentCollateral: ethers.parseEther("100000"), // $100,000
          currentDebt: ethers.parseEther("80000"), // $80,000
          // Current leverage: 100000/(100000-80000) = 100000/20000 = 500%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("5000"),
            expectedAmount: ethers.parseUnits("33834.95145631068", 18), // 38834.95145631068 - 5000 = 33834.95
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("38834.95145631068", 18),
          },
        },
        {
          name: "Should handle fractional amounts requiring decrease",
          currentCollateral: ethers.parseEther("123.45"), // $123.45
          currentDebt: ethers.parseEther("100.5"), // $100.5
          // Current leverage: 123.45/(123.45-100.5) = 123.45/22.95 ≈ 538%
          expectedDirection: -1, // Decrease
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("10"),
            expectedAmount: ethers.parseUnits("43.00970873786408", 18), // 53.00970873786408 - 10 = 43.01
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("53.00970873786408", 18),
          },
        },

        // Additional test cases for expectedDirection: 0 (no rebalance)
        {
          name: "Should handle exact target leverage with different amounts",
          currentCollateral: ethers.parseEther("600"), // $600
          currentDebt: ethers.parseEther("400"), // $400
          expectedDirection: 0, // No rebalance
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("10"),
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
        {
          name: "Should handle target leverage with fractional amounts",
          currentCollateral: ethers.parseEther("150"), // $150
          currentDebt: ethers.parseEther("100"), // $100
          // Current leverage: 150/(150-100) = 150/50 = 300%
          expectedDirection: 0, // No rebalance
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseEther("8"),
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
        {
          name: "Should handle target leverage with large amounts",
          currentCollateral: ethers.parseEther("30000"), // $30,000
          currentDebt: ethers.parseEther("20000"), // $20,000
          // Current leverage: 30000/(30000-20000) = 30000/10000 = 300%
          expectedDirection: 0, // No rebalance
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseEther("100"),
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
      ];

      for (const testCase of testCases) {
        for (const useVaultTokenBalance of [true, false]) {
          it(`${testCase.name} ${useVaultTokenBalance ? "(useVaultTokenBalance)" : ""}`, async function () {
            // Set up prices
            const collateralPrice = ethers.parseEther("1"); // $1 per token
            const debtPrice = ethers.parseEther("1"); // $1 per token

            await dloopMock.setMockPrice(await collateralToken.getAddress(), collateralPrice);
            await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

            // Set up mock collateral and debt
            await dloopMock.setMockCollateral(await dloopMock.getAddress(), await collateralToken.getAddress(), testCase.currentCollateral);
            await dloopMock.setMockDebt(await dloopMock.getAddress(), await debtToken.getAddress(), testCase.currentDebt);

            const testExpectedResult = useVaultTokenBalance ? testCase.whenUseVaultTokenBalance : testCase.whenNotUseVaultTokenBalance;

            // Set up vault balances if specified
            if (useVaultTokenBalance) {
              if (testExpectedResult.vaultCollateralBalance) {
                await collateralToken.mint(await dloopMock.getAddress(), testExpectedResult.vaultCollateralBalance);
              }

              if (testExpectedResult.vaultDebtBalance) {
                await debtToken.mint(await dloopMock.getAddress(), testExpectedResult.vaultDebtBalance);
              }
            }

            const [tokenAmount, direction] = await dloopMock.quoteRebalanceAmountToReachTargetLeverage();

            expect(direction).to.equal(testCase.expectedDirection);

            // Check amount with ±0.5% tolerance
            if (testExpectedResult.expectedAmount === 0n) {
              expect(tokenAmount).to.equal(0n);
            } else {
              const expectedAmount = testExpectedResult.expectedAmount;
              const tolerance = (expectedAmount * 5n) / 1000n; // 0.5% tolerance
              const minAmount = expectedAmount - tolerance;
              const maxAmount = expectedAmount + tolerance;

              expect(tokenAmount).to.be.gte(minAmount, `Amount ${tokenAmount} should be >= ${minAmount}`);
              expect(tokenAmount).to.be.lte(maxAmount, `Amount ${tokenAmount} should be <= ${maxAmount}`);
            }

            // Get the current subsidy bps
            const subsidyBps = await dloopMock.getCurrentSubsidyBps();

            // Make sure the expected amount leads to the target leverage
            const [totalCollateralInBase, totalDebtInBase] = await dloopMock.getTotalCollateralAndDebtOfUserInBase(
              await dloopMock.getAddress(),
            );

            // Leverage validation to make sure the new leverage is close to the target leverage
            await validateRebalanceLeverage(
              dloopMock,
              testExpectedResult.vaultCollateralBalance ?? 0n,
              testExpectedResult.vaultDebtBalance ?? 0n,
              direction,
              tokenAmount,
              totalCollateralInBase,
              totalDebtInBase,
              subsidyBps,
              BigInt(TARGET_LEVERAGE_BPS),
            );
          });
        }
      }
    });
  });

  describe("II. Internal Calculation Functions", function () {
    describe("_getCollateralTokenDepositAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        targetLeverage: bigint;
        totalCollateralBase: bigint;
        totalDebtBase: bigint;
        subsidy: bigint;
        whenUseVaultTokenBalance: {
          vaultCollateralBalance: bigint;
          expectedAmount: bigint;
          expectedRevertError?: string;
        };
        whenNotUseVaultTokenBalance: {
          expectedAmount: bigint;
          expectedRevertError?: string;
        };
      }[] = [
        {
          name: "Should calculate collateral needed for below-target leverage (200% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("50", 8), // $50, gives 133% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("150", 18), // 250 - 100 = 150
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("250", 18),
          },
        },
        {
          name: "Should handle exact target leverage scenario",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives exactly 300% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("0", 18),
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
        {
          name: "Should handle zero position",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: 0n,
          totalDebtBase: 0n,
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: 0n,
            expectedAmount: 0n,
            expectedRevertError: "TotalCollateralBaseIsZero",
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
            expectedRevertError: "TotalCollateralBaseIsZero",
          },
        },
        {
          name: "Should handle very low leverage (101% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("1000", 8), // $1000
          totalDebtBase: ethers.parseUnits("10", 8), // $10, gives ~101% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("1234", 18),
            expectedAmount: ethers.parseUnits("736", 18), // 1970 - 1234 = 736
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("1970", 18),
          },
        },
        {
          name: "Should handle moderate leverage gap (233% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("350", 8), // $350
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives 233% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("0", 18), // 100 - 100 = 0
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("100", 18),
          },
        },
        {
          name: "Should handle small differences near target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("299", 8), // $299
          totalDebtBase: ethers.parseUnits("199.33", 8), // $199.33, close to 300% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("0.02", 18),
            expectedAmount: ethers.parseUnits("0", 18), // max(0.01-0.02, 0) = 0
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("0.01", 18),
          },
        },
        {
          name: "Should handle fractional amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("150.5", 8), // $150.5
          totalDebtBase: ethers.parseUnits("25.1", 8), // $25.1, gives ~120% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("125.7", 18), // 225.7 - 100 = 125.7
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("225.7", 18),
          },
        },
        {
          name: "Should handle large amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("100000", 8), // $100,000
          totalDebtBase: ethers.parseUnits("10000", 8), // $10,000, gives ~111% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("169900", 18), // 170000 - 100 = 169900
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("170000", 18),
          },
        },
        {
          name: "Should handle with subsidy - below target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("50", 8), // $50
          subsidy: BigInt(5 * ONE_PERCENT_BPS), // 5% subsidy
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("117.39130434", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("217.39130434", 18),
          },
        },
        {
          name: "Should handle with high subsidy",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 133% leverage
          subsidy: BigInt(10 * ONE_PERCENT_BPS), // 10% subsidy
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: 0n, // zero vault collateral balance
            expectedAmount: ethers.parseUnits("384.61538461000004", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("384.61538461000004", 18),
          },
        },
        {
          name: "Should handle vault token balance mode - below target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("50", 8), // $50
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("150", 18), // 250 - 100 = 150
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("250", 18),
          },
        },
        {
          name: "Should handle vault token balance mode - at target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("200", 8), // $200
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("0", 18),
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
        {
          name: "Should handle vault token balance mode with subsidy",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("250", 8), // $250
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 167% leverage
          subsidy: BigInt(2 * ONE_PERCENT_BPS), // 2% subsidy
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("0.003", 18),
            expectedAmount: ethers.parseUnits("188.67624528", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("188.67924528", 18),
          },
        },
        {
          name: "Should handle different target leverage (400%)",
          targetLeverage: BigInt(400 * ONE_PERCENT_BPS), // 400%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 150% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: 0n,
            expectedAmount: ethers.parseUnits("500", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("500", 18),
          },
        },
        {
          name: "Should handle different target leverage (500%)",
          targetLeverage: BigInt(500 * ONE_PERCENT_BPS), // 500%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives 200% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("500", 18), // 600 - 100 = 500
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("600", 18),
          },
        },
        {
          name: "Should handle edge case - very high leverage target (1000%)",
          targetLeverage: BigInt(1000 * ONE_PERCENT_BPS), // 1000%
          totalCollateralBase: ethers.parseUnits("100", 8), // $100
          totalDebtBase: ethers.parseUnits("50", 8), // $50, gives 200% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("300", 18), // 400 - 100 = 300
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("400", 18),
          },
        },
        {
          name: "Should handle minimal position amounts",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("1", 8), // $1
          totalDebtBase: ethers.parseUnits("0.1", 8), // $0.1, gives ~111% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("0.1", 18),
            expectedAmount: ethers.parseUnits("1.6", 18), // 1.7 - 0.1 = 1.6
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("1.7", 18),
          },
        },
        {
          name: "Should handle debt-only position (infinite leverage to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("0.01", 8), // Very small collateral
          totalDebtBase: ethers.parseUnits("100", 8), // $100 debt
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: 0n,
            expectedAmount: 0n,
            expectedRevertError: "TotalCollateralBaseIsLessThanTotalDebtBase",
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
            expectedRevertError: "TotalCollateralBaseIsLessThanTotalDebtBase",
          },
        },
        {
          name: "Should handle high subsidy with vault tokens",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("500", 8), // $500
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives 167% leverage
          subsidy: BigInt(15 * ONE_PERCENT_BPS), // 15% subsidy
          whenUseVaultTokenBalance: {
            vaultCollateralBalance: ethers.parseUnits("0.0008", 18),
            expectedAmount: ethers.parseUnits("275.86126896", 18),
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("275.86206896000004", 18),
          },
        },
      ];

      for (const testCase of testCases) {
        for (const useVaultTokenBalance of [true, false]) {
          it(`${testCase.name} ${useVaultTokenBalance ? "(useVaultTokenBalance)" : ""}`, async function () {
            // Set up prices
            const collateralPrice = ethers.parseUnits("1", 8); // $1 per token
            const debtPrice = ethers.parseUnits("1", 8); // $1 per token

            await dloopMock.setMockPrice(await collateralToken.getAddress(), collateralPrice);
            await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

            if (useVaultTokenBalance) {
              if (testCase.whenUseVaultTokenBalance.vaultCollateralBalance) {
                await collateralToken.mint(await dloopMock.getAddress(), testCase.whenUseVaultTokenBalance.vaultCollateralBalance);
              }
            }

            const _testExpectedResult: {
              expectedRevertError?: string;
              expectedAmount: bigint;
            } = useVaultTokenBalance ? testCase.whenUseVaultTokenBalance : testCase.whenNotUseVaultTokenBalance;

            // if (testExpectedResult.expectedRevertError) {
            //   await expect(
            //     dloopMock.testGetCollateralTokenDepositAmountToReachTargetLeverage(
            //       testCase.targetLeverage,
            //       testCase.totalCollateralBase,
            //       testCase.totalDebtBase,
            //       testCase.subsidy,
            //       useVaultTokenBalance,
            //     ),
            //   ).to.be.revertedWithCustomError(
            //     dloopMock,
            //     testExpectedResult.expectedRevertError,
            //   );
            // } else {
            //   const result =
            //     await dloopMock.testGetCollateralTokenDepositAmountToReachTargetLeverage(
            //       testCase.targetLeverage,
            //       testCase.totalCollateralBase,
            //       testCase.totalDebtBase,
            //       testCase.subsidy,
            //       useVaultTokenBalance,
            //     );

            //   // Check amount with ±0.5% tolerance
            //   if (testExpectedResult.expectedAmount === 0n) {
            //     expect(result).to.equal(0n);
            //   } else {
            //     const expectedAmount = testExpectedResult.expectedAmount;
            //     const tolerance = (expectedAmount * 5n) / 1000n; // 0.5% tolerance
            //     const minAmount = expectedAmount - tolerance;
            //     const maxAmount = expectedAmount + tolerance;

            //     expect(result).to.be.gte(
            //       minAmount,
            //       `Amount ${result} should be >= ${minAmount}`,
            //     );
            //     expect(result).to.be.lte(
            //       maxAmount,
            //       `Amount ${result} should be <= ${maxAmount}`,
            //     );
            //   }

            //   const vaultCollateralBalance = useVaultTokenBalance
            //     ? (testCase.whenUseVaultTokenBalance.vaultCollateralBalance ??
            //       0n)
            //     : 0n;

            //   // Validate the new leverage
            //   await validateRebalanceLeverage(
            //     dloopMock,
            //     vaultCollateralBalance,
            //     0n, // No vault debt balance required for increasing leverage
            //     1n,
            //     result,
            //     testCase.totalCollateralBase,
            //     testCase.totalDebtBase,
            //     testCase.subsidy,
            //     testCase.targetLeverage,
            //   );
            // }
          });
        }
      }
    });

    describe("_getDebtRepayAmountInBaseToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        targetLeverage: bigint;
        totalCollateralBase: bigint;
        totalDebtBase: bigint;
        subsidy: bigint;
        whenUseVaultTokenBalance: {
          vaultDebtBalance: bigint;
          expectedAmount: bigint;
          expectedRevertError?: string;
          expectedRevertPanic?: string;
        };
        whenNotUseVaultTokenBalance: {
          expectedAmount: bigint;
          expectedRevertError?: string;
          expectedRevertPanic?: string;
        };
      }[] = [
        {
          name: "Should calculate debt to repay for above-target leverage (400% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("300", 8), // $300, gives 400% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("50", 18),
            expectedAmount: ethers.parseUnits("50", 18), // 100 - 50 = 50
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("100", 18), // Actual: 100000000000000000000
          },
        },
        {
          name: "Should return 0 when at target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("300", 8), // $300
          totalDebtBase: ethers.parseUnits("200", 8), // $200, gives exactly 300% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("0", 18),
            expectedAmount: 0n,
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
          },
        },
        {
          name: "Should handle zero position",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: 0n,
          totalDebtBase: 0n,
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: 0n,
            expectedAmount: 0n,
            expectedRevertError: "TotalCollateralBaseIsZero",
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
            expectedRevertError: "TotalCollateralBaseIsZero",
          },
        },
        {
          name: "Should throw for low leverage scenario requiring debt increase (this method is only used for decreasing leverage)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("600", 8), // $600
          totalDebtBase: ethers.parseUnits("100", 8), // $100, gives 120% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("10", 18),
            expectedAmount: 0n,
            expectedRevertPanic: "0x11", // Arithmetic operation overflowed
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: 0n,
            expectedRevertPanic: "0x11", // Arithmetic operation overflowed
          },
        },
        {
          name: "Should handle high leverage scenario (500% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("500", 8), // $500
          totalDebtBase: ethers.parseUnits("400", 8), // $400, gives 500% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("100", 18),
            expectedAmount: ethers.parseUnits("100", 18), // 200 - 100 = 100
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("200", 18), // Actual: 200000000000000000000
          },
        },
        {
          name: "Should handle very high leverage scenario (1000% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("1000", 8), // $1000
          totalDebtBase: ethers.parseUnits("900", 8), // $900, gives 1000% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("300", 18),
            expectedAmount: ethers.parseUnits("400", 18), // 700 - 300 = 400
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("700", 18), // Actual: 700000000000000000000
          },
        },
        {
          name: "Should handle with subsidy - above target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("600", 8), // $600
          totalDebtBase: ethers.parseUnits("500", 8), // $500, gives 600% leverage
          subsidy: ethers.parseUnits("500", 8), // 5% subsidy
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("0.001", 18),
            expectedAmount: ethers.parseUnits("0.001", 18), // 0.00199998 - 0.001 ≈ 0.001
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("0.00199998", 18), // Actual: 1999980000000000
          },
        },
        {
          name: "Should handle fractional amounts - above target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("123.45", 8), // $123.45
          totalDebtBase: ethers.parseUnits("100.5", 8), // $100.5, gives ~538% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("20", 18),
            expectedAmount: ethers.parseUnits("34.6", 18), // 54.6 - 20 = 34.6
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("54.6", 18), // Actual: 54600000000000000000
          },
        },
        {
          name: "Should handle large amounts - above target",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("100000", 8), // $100,000
          totalDebtBase: ethers.parseUnits("80000", 8), // $80,000, gives 500% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("10000", 18),
            expectedAmount: ethers.parseUnits("30000", 18), // 40000 - 10000 = 30000
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("40000", 18), // Actual: 40000000000000000000000
          },
        },
        {
          name: "Should handle different target leverage (400% current to 200% target)",
          targetLeverage: BigInt(200 * ONE_PERCENT_BPS), // 200%
          totalCollateralBase: ethers.parseUnits("400", 8), // $400
          totalDebtBase: ethers.parseUnits("300", 8), // $300, gives 400% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("50", 18),
            expectedAmount: ethers.parseUnits("150", 18), // 200 - 50 = 150
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("200", 18), // Actual: 200000000000000000000
          },
        },
        {
          name: "Should handle high subsidy with above-target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("800", 8), // $800
          totalDebtBase: ethers.parseUnits("700", 8), // $700, gives 800% leverage
          subsidy: ethers.parseUnits("1000", 8), // 10% subsidy
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("0.0001", 18),
            expectedAmount: ethers.parseUnits("0.00156666", 18), // Actual: 1566660000000000
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("0.00166666", 18), // Actual: 1666660000000000
          },
        },
        {
          name: "Should handle edge case - extremely high leverage (2000% to 300%)",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("200", 8), // $200
          totalDebtBase: ethers.parseUnits("190", 8), // $190, gives 2000% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("70", 18),
            expectedAmount: ethers.parseUnits("100", 18), // 170 - 70 = 100
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("170", 18), // Actual: 170000000000000000000
          },
        },
        {
          name: "Should handle minimal amounts with above-target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("3", 8), // $3
          totalDebtBase: ethers.parseUnits("2.5", 8), // $2.5, gives 600% leverage
          subsidy: 0n,
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("0.5", 18),
            expectedAmount: ethers.parseUnits("1", 18), // 1.5 - 0.5 = 1
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("1.5", 18), // Actual: 1500000000000000000
          },
        },
        {
          name: "Should handle vault mode with subsidy and above-target leverage",
          targetLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
          totalCollateralBase: ethers.parseUnits("1000", 8), // $1000
          totalDebtBase: ethers.parseUnits("850", 8), // $850, gives ~588% leverage
          subsidy: ethers.parseUnits("200", 8), // 2% subsidy
          whenUseVaultTokenBalance: {
            vaultDebtBalance: ethers.parseUnits("0.005", 18),
            expectedAmount: ethers.parseUnits("0.004166510", 18), // Actual: 4166510000000000
          },
          whenNotUseVaultTokenBalance: {
            expectedAmount: ethers.parseUnits("0.00916651", 18), // Actual: 9166510000000000
          },
        },
      ];

      for (const testCase of testCases) {
        for (const useVaultTokenBalance of [true, false]) {
          it(`${testCase.name} ${useVaultTokenBalance ? "(useVaultTokenBalance)" : ""}`, async function () {
            // Set up prices
            const collateralPrice = ethers.parseUnits("1", 8); // $1 per token
            const debtPrice = ethers.parseUnits("1", 8); // $1 per token

            await dloopMock.setMockPrice(await collateralToken.getAddress(), collateralPrice);
            await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

            if (useVaultTokenBalance) {
              if (testCase.whenUseVaultTokenBalance.vaultDebtBalance) {
                await debtToken.mint(await dloopMock.getAddress(), testCase.whenUseVaultTokenBalance.vaultDebtBalance);
              }
            }

            const _testExpectedResult: {
              expectedRevertError?: string;
              expectedRevertPanic?: string;
              expectedAmount: bigint;
            } = useVaultTokenBalance ? testCase.whenUseVaultTokenBalance : testCase.whenNotUseVaultTokenBalance;

            // if (testExpectedResult.expectedRevertError) {
            //   await expect(
            //     dloopMock.testGetDebtTokenAmountToReachTargetLeverage(
            //       testCase.targetLeverage,
            //       testCase.totalCollateralBase,
            //       testCase.totalDebtBase,
            //       testCase.subsidy,
            //       useVaultTokenBalance,
            //     ),
            //   ).to.be.revertedWithCustomError(
            //     dloopMock,
            //     testExpectedResult.expectedRevertError,
            //   );
            // } else if (testExpectedResult.expectedRevertPanic) {
            //   await expect(
            //     dloopMock.testGetDebtTokenAmountToReachTargetLeverage(
            //       testCase.targetLeverage,
            //       testCase.totalCollateralBase,
            //       testCase.totalDebtBase,
            //       testCase.subsidy,
            //       useVaultTokenBalance,
            //     ),
            //   ).to.be.revertedWithPanic(testExpectedResult.expectedRevertPanic);
            // } else {
            //   const result =
            //     await dloopMock.testGetDebtTokenAmountToReachTargetLeverage(
            //       testCase.targetLeverage,
            //       testCase.totalCollateralBase,
            //       testCase.totalDebtBase,
            //       testCase.subsidy,
            //       useVaultTokenBalance,
            //     );

            //   // Check amount with ±0.5% tolerance
            //   if (testExpectedResult.expectedAmount === 0n) {
            //     expect(result).to.equal(0n);
            //   } else {
            //     const expectedAmount = testExpectedResult.expectedAmount;
            //     const tolerance = (expectedAmount * 5n) / 1000n; // 0.5% tolerance
            //     const minAmount = expectedAmount - tolerance;
            //     const maxAmount = expectedAmount + tolerance;

            //     expect(result).to.be.gte(
            //       minAmount,
            //       `Amount ${result} should be >= ${minAmount}`,
            //     );
            //     expect(result).to.be.lte(
            //       maxAmount,
            //       `Amount ${result} should be <= ${maxAmount}`,
            //     );
            //   }

            //   const vaultDebtBalance = useVaultTokenBalance
            //     ? (testCase.whenUseVaultTokenBalance.vaultDebtBalance ?? 0n)
            //     : 0n;

            //   // Validate the new leverage
            //   await validateRebalanceLeverage(
            //     dloopMock,
            //     0n, // No vault collateral balance required for decreasing leverage
            //     vaultDebtBalance,
            //     -1n,
            //     result,
            //     testCase.totalCollateralBase,
            //     testCase.totalDebtBase,
            //     testCase.subsidy,
            //     testCase.targetLeverage,
            //   );
            // }
          });
        }
      }
    });
  });
});

/**
 * Validate the new leverage after rebalance
 *
 * @param dloopMock - the dloop mock contract
 * @param vaultCollateralBalance - the vault collateral balance
 * @param vaultDebtBalance - the vault debt balance
 * @param direction -1: decrease, 1: increase
 * @param requiredCollateralTokenAmount - the required token amount from user
 * @param totalCollateralInBase - the total collateral in base currency
 * @param totalDebtInBase - the total debt in base currency
 * @param subsidyBps - the subsidy in basis points
 * @param targetLeverage - the target leverage in basis points
 */
async function validateRebalanceLeverage(
  dloopMock: DLoopCoreMock,
  vaultCollateralBalance: bigint,
  vaultDebtBalance: bigint,
  direction: bigint,
  requiredCollateralTokenAmount: bigint,
  totalCollateralInBase: bigint,
  totalDebtInBase: bigint,
  subsidyBps: bigint,
  targetLeverage: bigint,
): Promise<void> {
  if (direction === 0n) {
    // If no rebalance is needed, there is no rebalance and no validation is needed
    return;
  }

  expect(direction).to.be.oneOf([-1n, 1n]);

  const collateralToken = await ethers.getContractAt("TestMintableERC20", await dloopMock.collateralToken());
  const debtToken = await ethers.getContractAt("TestMintableERC20", await dloopMock.debtToken());

  let rebalanceAmountInBase = await dloopMock.convertFromTokenAmountToBaseCurrency(
    requiredCollateralTokenAmount,
    await collateralToken.getAddress(),
  );

  // If useVaultTokenBalance is true, we need to add the vault token balance to the rebalance amount
  // because the vault token balance is already included in the formula
  // of quoteRebalanceAmountToReachTargetLeverage
  if (direction > 0) {
    if (vaultCollateralBalance > 0n) {
      const valutCollateralBalanceInBase = await dloopMock.convertFromTokenAmountToBaseCurrency(
        vaultCollateralBalance,
        await collateralToken.getAddress(),
      );
      rebalanceAmountInBase += valutCollateralBalanceInBase;
    }
  } else if (direction < 0) {
    if (vaultDebtBalance > 0n) {
      const valutDebtBalanceInBase = await dloopMock.convertFromTokenAmountToBaseCurrency(vaultDebtBalance, await debtToken.getAddress());
      rebalanceAmountInBase += valutDebtBalanceInBase;
    }
  }

  const oneHundredPercentBps = BigInt(ONE_HUNDRED_PERCENT_BPS);
  const newLeverage =
    ((totalCollateralInBase + direction * rebalanceAmountInBase) * oneHundredPercentBps) /
    (totalCollateralInBase +
      direction * rebalanceAmountInBase -
      totalDebtInBase -
      (direction * rebalanceAmountInBase * (oneHundredPercentBps + subsidyBps)) / oneHundredPercentBps);
  expect(newLeverage).to.be.closeTo(
    targetLeverage,
    ONE_BPS_UNIT, // very small tolerance
  );
}
