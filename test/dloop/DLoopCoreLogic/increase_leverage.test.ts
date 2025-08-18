import { expect } from "chai";
import { ethers } from "hardhat";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";

describe("DLoopCoreLogic - Increase Leverage", () => {
  const SCALE = 1_000_000n;
  const pow10 = (n: bigint): bigint => 10n ** n;

  /**
   * Deploys the DLoopCoreLogic harness for increase leverage tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("getCollateralTokenDepositAmountToReachTargetLeverage", () => {
    it("table-driven cases (success and errors)", async () => {
      const { harness } = await deployHarness();

      const cases: Array<
        | {
            name: string;
            TT: bigint; // expectedTargetLeverageBps
            C: bigint; // totalCollateralBase
            D: bigint; // totalDebtBase
            k: bigint; // subsidy bps
            expectedBase: bigint;
          }
        | {
            name: string;
            TT: bigint;
            C: bigint;
            D: bigint;
            k: bigint;
            expectedError: string; // "panic" or custom error id
          }
      > = [
        {
          name: "error: C=0",
          TT: 2n * SCALE,
          C: 0n,
          D: 0n,
          k: 0n,
          expectedError: "TotalCollateralBaseIsZero",
        },
        {
          name: "error: C<D",
          TT: 2n * SCALE,
          C: 1000n,
          D: 1001n,
          k: 0n,
          expectedError: "TotalCollateralBaseIsLessThanTotalDebtBase",
        },
        // x = (TT*(C-D) - C*SCALE) / (SCALE + TT*k/SCALE)
        // For the deterministic cases below we pre-compute expectedBase offline to avoid computeExpected()
        {
          name: "simple 2x, no subsidy",
          TT: 2n * SCALE,
          C: 1_000_000n,
          D: 500_000n,
          k: 0n,
          expectedBase: 0n, // exact target already, so require 0
        },
        {
          name: "3x, no subsidy",
          TT: 3n * SCALE,
          C: 1_000_000n,
          D: 666_666n,
          k: 0n,
          expectedBase: 2n, // minimal ceil result from internal math
        },
        {
          name: "2x, small subsidy",
          TT: 2n * SCALE,
          C: 1_000_000n,
          D: 500_000n,
          k: 1_000n,
          expectedBase: 0n, // still exactly at target
        },
        {
          name: "high subsidy cap",
          TT: 5n * SCALE,
          C: 2_000_000n,
          D: 1_000_000n,
          k: 10_000n,
          expectedBase: 2_857_143n, // hand-calculated expected
        },
        {
          name: "already near target (tiny)",
          TT: 2n * SCALE,
          C: 1_000_001n,
          D: 500_001n,
          k: 0n,
          expectedError: "panic",
        },
        {
          name: "large numbers",
          TT: 7n * SCALE,
          C: 10n ** 24n,
          D: 3n * 10n ** 23n,
          k: 0n,
          expectedBase: 3_900_000_000_000_000_000_000_000n,
        },
        {
          name: "tiny surplus",
          TT: 10n * SCALE,
          C: 1_000_000n,
          D: 999_999n,
          k: 0n,
          expectedError: "panic",
        },
        {
          name: "with subsidy rounding up",
          TT: 3n * SCALE,
          C: 1_000_000n,
          D: 750_000n,
          k: 3_333n,
          expectedError: "panic",
        },
      ];

      for (const tc of cases) {
        if ("expectedError" in tc) {
          if ((tc as any).expectedError === "panic") {
            await expect(
              harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
                (tc as any).TT,
                (tc as any).C,
                (tc as any).D,
                (tc as any).k,
              ),
            ).to.be.revertedWithPanic(0x11);
          } else {
            await expect(
              harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
                (tc as any).TT,
                (tc as any).C,
                (tc as any).D,
                (tc as any).k,
              ),
            ).to.be.revertedWithCustomError(harness, (tc as any).expectedError);
          }
        } else {
          const res =
            await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
              (tc as any).TT,
              (tc as any).C,
              (tc as any).D,
              (tc as any).k,
            );
          expect(res).to.equal((tc as any).expectedBase, (tc as any).name);
        }
      }
    });
  });

  describe("getDebtBorrowAmountInBaseToIncreaseLeverage", () => {
    it("table-driven cases", async () => {
      const { harness } = await deployHarness();

      const cases = [
        { name: "no subsidy", x: 1_000_000n, k: 0n, expected: 1_000_000n },
        {
          name: "+100 bps",
          x: 1_000_000n,
          k: 10_000n,
          expected: (1_000_000n * (SCALE + 10_000n)) / SCALE,
        },
        {
          name: "+333 bps rounding down",
          x: 100n,
          k: 3_333n,
          expected: (100n * (SCALE + 3_333n)) / SCALE,
        },
        { name: "zero", x: 0n, k: 0n, expected: 0n },
        {
          name: "tiny",
          x: 1n,
          k: 100n,
          expected: (1n * (SCALE + 100n)) / SCALE,
        },
        { name: "large x", x: 10n ** 30n, k: 0n, expected: 10n ** 30n },
        {
          name: "large k",
          x: 10n ** 6n,
          k: 99_999n,
          expected: (10n ** 6n * (SCALE + 99_999n)) / SCALE,
        },
        {
          name: "mid",
          x: 123_456_789n,
          k: 25_000n,
          expected: (123_456_789n * (SCALE + 25_000n)) / SCALE,
        },
        {
          name: "k=1",
          x: 999_999n,
          k: 1n,
          expected: (999_999n * (SCALE + 1n)) / SCALE,
        },
        {
          name: "k=SCALE-1",
          x: 555_555n,
          k: SCALE - 1n,
          expected: (555_555n * (2n * SCALE - 1n)) / SCALE,
        },
      ];

      for (const tc of cases) {
        const res =
          await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
            tc.x,
            tc.k,
          );
        expect(res).to.equal(tc.expected, tc.name);
      }
    });
  });

  describe("getDebtBorrowTokenAmountToIncreaseLeverage", () => {
    it("table-driven cases including error on zero input", async () => {
      const { harness } = await deployHarness();

      // success cases
      const success = [
        {
          name: "1e18, no subsidy, equal price",
          x: pow10(18n),
          k: 0n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
        },
        {
          name: "3e18, +100bps",
          x: 3n * pow10(18n),
          k: 10_000n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
        },
        {
          name: "6 decimals",
          x: pow10(6n),
          k: 3_333n,
          cDec: 6n,
          cPrice: pow10(6n),
          dDec: 6n,
          dPrice: pow10(6n),
        },
        {
          name: "debt cheaper",
          x: pow10(18n),
          k: 25_000n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: 5n * pow10(17n),
        },
        {
          name: "debt more expensive",
          x: pow10(18n),
          k: 25_000n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: 2n * pow10(18n),
        },
        {
          name: "tiny",
          x: 1n,
          k: 0n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
        },
        {
          name: "big",
          x: 10n ** 24n,
          k: 0n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
        },
        {
          name: "different decimals",
          x: pow10(8n),
          k: 0n,
          cDec: 8n,
          cPrice: pow10(8n),
          dDec: 6n,
          dPrice: pow10(6n),
        },
        {
          name: "non-1 prices",
          x: pow10(18n),
          k: 77_700n,
          cDec: 18n,
          cPrice: 123456789n,
          dDec: 18n,
          dPrice: 987654321n,
        },
        {
          name: "edge k=SCALE-1",
          x: pow10(18n),
          k: SCALE - 1n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
        },
      ];

      for (const tc of success) {
        const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tc.x,
          Number(tc.cDec),
          tc.cPrice,
        );
        const baseExpected =
          await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
            xBase,
            tc.k,
          );
        const tokenOut =
          await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
            tc.x,
            tc.k,
            Number(tc.cDec),
            tc.cPrice,
            Number(tc.dDec),
            tc.dPrice,
          );
        const baseFromToken =
          await harness.convertFromTokenAmountToBaseCurrencyPublic(
            tokenOut,
            Number(tc.dDec),
            tc.dPrice,
          );
        const diff =
          baseExpected > baseFromToken
            ? baseExpected - baseFromToken
            : baseFromToken - baseExpected;
        expect(diff < 2n * tc.dPrice).to.equal(true, tc.name);
      }

      // error case: zero input collateral
      await expect(
        harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          0,
          0,
          18,
          pow10(18n),
          18,
          pow10(18n),
        ),
      ).to.be.revertedWithCustomError(
        harness,
        "InputCollateralTokenAmountIsZero",
      );
    });
  });
});
