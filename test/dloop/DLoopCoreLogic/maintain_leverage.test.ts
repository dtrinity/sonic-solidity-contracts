import { expect } from "chai";
import { ethers } from "hardhat";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";

describe("DLoopCoreLogic - Maintain Leverage", () => {
  const SCALE = 1_000_000n;

  const pow10 = (n: bigint): bigint => 10n ** n;

  /**
   * Deploys the DLoopCoreLogic harness for maintain leverage tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("getRepayAmountThatKeepCurrentLeverage", () => {
    const cases = [
      {
        name: "leverage=0 -> 0",
        targetWithdrawToken: 1_000n,
        L: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
        expectedZero: true,
      },
      {
        name: "1e18 withdraw, 2x leverage, equal prices/decimals",
        targetWithdrawToken: pow10(18n),
        L: 2n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "0.5x price debt cheaper",
        targetWithdrawToken: pow10(18n),
        L: 3n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: 5n * pow10(17n),
      },
      {
        name: "debt more expensive",
        targetWithdrawToken: pow10(18n),
        L: 4n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: 2n * pow10(18n),
      },
      {
        name: "6 decimals",
        targetWithdrawToken: pow10(6n),
        L: 5n * SCALE,
        cDec: 6n,
        cPrice: pow10(6n),
        dDec: 6n,
        dPrice: pow10(6n),
      },
      {
        name: "rounding down",
        targetWithdrawToken: 100n,
        L: 3n * SCALE,
        cDec: 18n,
        cPrice: 3n,
        dDec: 18n,
        dPrice: 7n,
      },
      {
        name: "tiny withdraw",
        targetWithdrawToken: 1n,
        L: 10n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "big numbers",
        targetWithdrawToken: 10n ** 24n,
        L: 7n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "different decimals",
        targetWithdrawToken: pow10(8n),
        L: 2n * SCALE,
        cDec: 8n,
        cPrice: pow10(8n),
        dDec: 6n,
        dPrice: pow10(6n),
      },
      {
        name: "non-1 prices",
        targetWithdrawToken: pow10(18n),
        L: 6n * SCALE,
        cDec: 18n,
        cPrice: 123456789n,
        dDec: 18n,
        dPrice: 987654321n,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.getRepayAmountThatKeepCurrentLeveragePublic(
          tc.targetWithdrawToken,
          tc.L,
          Number(tc.cDec),
          tc.cPrice,
          Number(tc.dDec),
          tc.dPrice,
        );

        if ((tc as any).expectedZero) {
          expect(res).to.equal(0n);
          return;
        }

        // Compute expected via base conversions to match on-chain rounding
        const withdrawBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(tc.targetWithdrawToken, Number(tc.cDec), tc.cPrice);
        const repayBase = (withdrawBase * (tc.L - SCALE)) / tc.L;
        const expectedDebtToken = await harness.convertFromBaseCurrencyToTokenPublic(repayBase, Number(tc.dDec), tc.dPrice);
        expect(res).to.equal(expectedDebtToken);
      });
    }
  });

  describe("getBorrowAmountThatKeepCurrentLeverage", () => {
    const cases = [
      {
        name: "no prior leverage -> use target",
        supplied: 1_000n,
        L0: 0n,
        T: 2n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "2x prior",
        supplied: pow10(18n),
        L0: 2n * SCALE,
        T: 3n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "3x prior, debt cheaper",
        supplied: pow10(18n),
        L0: 3n * SCALE,
        T: 4n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: 5n * pow10(17n),
      },
      {
        name: "4x prior, debt expensive",
        supplied: pow10(18n),
        L0: 4n * SCALE,
        T: 2n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: 2n * pow10(18n),
      },
      {
        name: "6 decimals",
        supplied: pow10(6n),
        L0: 5n * SCALE,
        T: 5n * SCALE,
        cDec: 6n,
        cPrice: pow10(6n),
        dDec: 6n,
        dPrice: pow10(6n),
      },
      {
        name: "rounding",
        supplied: 100n,
        L0: 3n * SCALE,
        T: 3n * SCALE,
        cDec: 18n,
        cPrice: 3n,
        dDec: 18n,
        dPrice: 7n,
      },
      {
        name: "tiny",
        supplied: 1n,
        L0: 10n * SCALE,
        T: 10n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "big",
        supplied: 10n ** 24n,
        L0: 7n * SCALE,
        T: 7n * SCALE,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "different decimals",
        supplied: pow10(8n),
        L0: 2n * SCALE,
        T: 2n * SCALE,
        cDec: 8n,
        cPrice: pow10(8n),
        dDec: 6n,
        dPrice: pow10(6n),
      },
      {
        name: "non-1 prices",
        supplied: pow10(18n),
        L0: 6n * SCALE,
        T: 6n * SCALE,
        cDec: 18n,
        cPrice: 123456789n,
        dDec: 18n,
        dPrice: 987654321n,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.getBorrowAmountThatKeepCurrentLeveragePublic(
          tc.supplied,
          tc.L0,
          tc.T,
          Number(tc.cDec),
          tc.cPrice,
          Number(tc.dDec),
          tc.dPrice,
        );

        const L = tc.L0 === 0n ? tc.T : tc.L0;
        const suppliedBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(tc.supplied, Number(tc.cDec), tc.cPrice);
        const borrowBase = (suppliedBase * (L - SCALE)) / L;
        const expectedDebtToken = await harness.convertFromBaseCurrencyToTokenPublic(borrowBase, Number(tc.dDec), tc.dPrice);
        expect(res).to.equal(expectedDebtToken);
      });
    }

    it("uses target leverage when prior leverage is zero", async () => {
      const { harness } = await deployHarness();
      const supplied = 1_000_000n;
      const L0 = 0n;
      const T = 3_000_000n; // 3x
      const cDec = 18n;
      const cPrice = 10n ** 18n;
      const dDec = 18n;
      const dPrice = 10n ** 18n;

      const res = await harness.getBorrowAmountThatKeepCurrentLeveragePublic(supplied, L0, T, Number(cDec), cPrice, Number(dDec), dPrice);
      const expected = (supplied * (T - 1_000_000n)) / T;
      expect(res).to.equal(expected);
    });

    // Comprehensive test cases from deposit-calculation-test.ts
    describe("comprehensive leverage scenarios", () => {
      // Test scenarios with existing positions (non-zero leverage)
      const testCases = [
        {
          name: "Should maintain 300% leverage when adding collateral",
          existingCollateralBase: ethers.parseUnits("100", 8), // $100 existing collateral
          existingDebtBase: ethers.parseUnits("66.66666667", 8), // $66.67 existing debt (for 300% leverage)
          suppliedCollateralAmount: ethers.parseEther("50"), // Adding 50 more collateral tokens
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS), // 300% current leverage
          targetLeverageBps: BigInt(300 * ONE_PERCENT_BPS), // Maintain 300% leverage
          collateralPrice: ethers.parseUnits("1", 8), // $1 per collateral
          debtPrice: ethers.parseUnits("1", 8), // $1 per debt
          expectedBorrowAmount: ethers.parseEther("33.333333333333333333"), // 50 * (300-100)/300 ≈ 33.33
          debtTokenDecimals: 18,
        },
        {
          name: "Should maintain 200% leverage when adding collateral",
          existingCollateralBase: ethers.parseUnits("200", 8), // $200 existing collateral
          existingDebtBase: ethers.parseUnits("100", 8), // $100 existing debt (for 200% leverage)
          suppliedCollateralAmount: ethers.parseEther("100"), // Adding 100 more collateral tokens
          leverageBpsBeforeSupply: BigInt(200 * ONE_PERCENT_BPS), // 200% current leverage
          targetLeverageBps: BigInt(200 * ONE_PERCENT_BPS), // Maintain 200% leverage
          collateralPrice: ethers.parseUnits("1", 8),
          debtPrice: ethers.parseUnits("1", 8),
          expectedBorrowAmount: ethers.parseEther("50"), // 100 * (200-100)/200 = 50
          debtTokenDecimals: 18,
        },
        {
          name: "Should handle different token prices",
          existingCollateralBase: ethers.parseUnits("100", 8), // $100 existing collateral
          existingDebtBase: ethers.parseUnits("66.66666667", 8), // $66.67 existing debt
          suppliedCollateralAmount: ethers.parseEther("50"),
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          targetLeverageBps: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseUnits("2", 8), // $2 per collateral
          debtPrice: ethers.parseUnits("0.5", 8), // $0.5 per debt
          expectedBorrowAmount: ethers.parseEther("133.33333333"), // (50*2) * (300-100)/300 / 0.5 ≈ 133.33
          debtTokenDecimals: 18,
        },
        {
          name: "Should handle 6 decimal debt token",
          existingCollateralBase: ethers.parseUnits("100", 8),
          existingDebtBase: ethers.parseUnits("66.66666667", 8),
          suppliedCollateralAmount: ethers.parseEther("50"),
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          targetLeverageBps: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseUnits("1", 8),
          debtPrice: ethers.parseUnits("1", 8),
          expectedBorrowAmount: ethers.parseUnits("33.333333", 6), // Different decimals
          debtTokenDecimals: 6,
        },
        {
          name: "Should handle zero collateral supply",
          existingCollateralBase: ethers.parseUnits("100", 8),
          existingDebtBase: ethers.parseUnits("66.66666667", 8),
          suppliedCollateralAmount: 0n,
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          targetLeverageBps: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseUnits("1", 8),
          debtPrice: ethers.parseUnits("1", 8),
          expectedBorrowAmount: 0n,
          debtTokenDecimals: 18,
        },
        {
          name: "Should handle small supply amounts",
          existingCollateralBase: ethers.parseUnits("100", 8),
          existingDebtBase: ethers.parseUnits("66.66666667", 8),
          suppliedCollateralAmount: ethers.parseEther("0.1"),
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          targetLeverageBps: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseUnits("1", 8),
          debtPrice: ethers.parseUnits("1", 8),
          expectedBorrowAmount: ethers.parseEther("0.066666666666666666"), // 0.1 * (300-100)/300
          debtTokenDecimals: 18,
        },
        {
          name: "Should handle large supply amounts",
          existingCollateralBase: ethers.parseUnits("10000", 8),
          existingDebtBase: ethers.parseUnits("6666.66666667", 8),
          suppliedCollateralAmount: ethers.parseEther("5000"),
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          targetLeverageBps: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseUnits("1", 8),
          debtPrice: ethers.parseUnits("1", 8),
          expectedBorrowAmount: ethers.parseEther("3333.33333333"), // 5000 * (300-100)/300 ≈ 3333.33
          debtTokenDecimals: 18,
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          const { harness } = await deployHarness();

          const result = await harness.getBorrowAmountThatKeepCurrentLeveragePublic(
            testCase.suppliedCollateralAmount,
            testCase.leverageBpsBeforeSupply,
            testCase.targetLeverageBps,
            18, // collateral decimals
            testCase.collateralPrice,
            testCase.debtTokenDecimals,
            testCase.debtPrice,
          );

          if (testCase.expectedBorrowAmount > 0) {
            expect(result).to.be.closeTo(testCase.expectedBorrowAmount, ethers.parseUnits("0.000001", testCase.debtTokenDecimals));
          } else {
            expect(result).to.equal(testCase.expectedBorrowAmount);
          }

          // Validation: ensure new leverage equals target leverage
          if (testCase.suppliedCollateralAmount > 0n) {
            const suppliedBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
              testCase.suppliedCollateralAmount,
              18,
              testCase.collateralPrice,
            );
            const borrowBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
              result,
              testCase.debtTokenDecimals,
              testCase.debtPrice,
            );

            const newLeverage = await harness.getCurrentLeverageBpsPublic(
              testCase.existingCollateralBase + suppliedBase,
              testCase.existingDebtBase + borrowBase,
            );
            expect(newLeverage).to.be.closeTo(testCase.targetLeverageBps, BigInt(100)); // 1 BPS tolerance
          }
        });
      }

      // Special cases for initial deposits (zero leverage)
      describe("initial deposit scenarios", () => {
        const initialDepositCases = [
          {
            name: "Should calculate borrow amount for initial 300% leverage deposit",
            suppliedCollateralAmount: ethers.parseEther("100"),
            leverageBpsBeforeSupply: 0n, // No prior leverage
            targetLeverageBps: BigInt(300 * ONE_PERCENT_BPS), // Target 300%
            collateralPrice: ethers.parseUnits("1", 8),
            debtPrice: ethers.parseUnits("1", 8),
            expectedBorrowAmount: 66666666660000000000n, // Actual result from calculation
            debtTokenDecimals: 18,
          },
          {
            name: "Should handle 100% leverage (no borrowing) for initial deposit",
            suppliedCollateralAmount: ethers.parseEther("100"),
            leverageBpsBeforeSupply: 0n,
            targetLeverageBps: BigInt(100 * ONE_PERCENT_BPS), // 100% leverage = no borrowing
            collateralPrice: ethers.parseUnits("1", 8),
            debtPrice: ethers.parseUnits("1", 8),
            expectedBorrowAmount: 0n,
            debtTokenDecimals: 18,
          },
        ];

        for (const testCase of initialDepositCases) {
          it(testCase.name, async function () {
            const { harness } = await deployHarness();

            const result = await harness.getBorrowAmountThatKeepCurrentLeveragePublic(
              testCase.suppliedCollateralAmount,
              testCase.leverageBpsBeforeSupply,
              testCase.targetLeverageBps,
              18,
              testCase.collateralPrice,
              testCase.debtTokenDecimals,
              testCase.debtPrice,
            );

            expect(result).to.equal(testCase.expectedBorrowAmount);
          });
        }
      });
    });
  });
});
