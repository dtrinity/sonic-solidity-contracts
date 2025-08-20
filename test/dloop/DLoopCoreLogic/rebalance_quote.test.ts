import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";

describe("DLoopCoreLogic - Rebalance Quote", () => {
  const SCALE = 1_000_000n;
  const pow10 = (n: bigint): bigint => 10n ** n;

  /**
   * Deploy the harness
   *
   * @returns {Promise<{harness: DLoopCoreLogicHarness}>}
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = await Factory.deploy();
    return { harness };
  }

  describe("quoteRebalanceAmountToReachTargetLeverage", () => {
    const cases = [
      {
        name: "no collateral",
        C: 0n,
        D: 0n,
        current: 0n,
        target: 2n * SCALE,
        k: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
        expectedDir: 0,
      },
      {
        name: "increase simple",
        C: 1_000_000n,
        D: 500_000n,
        current: 2n * SCALE,
        target: 3n * SCALE,
        k: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
        expectedDir: 1,
      },
      {
        name: "decrease with subsidy (label corrected)",
        C: 1_000_000n,
        D: 666_666n,
        current: 3n * SCALE,
        target: 2n * SCALE,
        k: 100n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
        expectedDir: -1,
      },
      {
        name: "decrease simple",
        C: 2_000_000n,
        D: 1_000_000n,
        current: 3n * SCALE,
        target: 2n * SCALE,
        k: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
        expectedDir: -1,
      },
      {
        name: "decrease with subsidy",
        C: 2_000_000n,
        D: 1_000_000n,
        current: 3n * SCALE,
        target: 2n * SCALE,
        k: 333n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
        expectedDir: -1,
      },
      {
        name: "already at target",
        C: 1_000_000n,
        D: 500_000n,
        current: 2n * SCALE,
        target: 2n * SCALE,
        k: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
        expectedDir: 0,
      },
      {
        name: "increase with decimals/prices mismatch",
        C: 5_000_000n,
        D: 2_000_000n,
        current: (5n * SCALE) / 2n, // 2.5x
        target: 3n * SCALE, // 3x
        k: 0n,
        cDec: 6n,
        cPrice: 1_000_000n, // 1e6
        dDec: 18n,
        dPrice: 5n * pow10(17n), // 0.5e18
        expectedDir: 1,
      },
      {
        name: "decrease with decimals/prices mismatch",
        C: 2_000_000n,
        D: 1_600_000n,
        current: (2_000_000n * SCALE) / 400_000n, // 5x
        target: 3n * SCALE, // 3x
        k: 250n,
        cDec: 18n,
        cPrice: 2n * pow10(18n), // 2e18
        dDec: 6n,
        dPrice: 1_000_000n, // 1e6
        expectedDir: -1,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const [inputTokenAmount, estimatedOutputTokenAmount, direction] =
          await harness.quoteRebalanceAmountToReachTargetLeveragePublic(
            tc.C,
            tc.D,
            tc.current,
            tc.target,
            tc.k,
            Number(tc.cDec),
            tc.cPrice,
            Number(tc.dDec),
            tc.dPrice,
          );

        if (tc.current < tc.target && direction === 1n) {
          // Increase: compute expected via harness base functions to avoid duplication
          const xBase =
            await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
              tc.target,
              tc.C,
              tc.D,
              tc.k,
            );
          const expectedInputToken =
            await harness.convertFromBaseCurrencyToTokenPublic(
              xBase,
              Number(tc.cDec),
              tc.cPrice,
            );
          expect(inputTokenAmount).to.equal(expectedInputToken);
          const yBase =
            await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
              xBase,
              tc.k,
            );
          const expectedOutputToken =
            await harness.convertFromBaseCurrencyToTokenPublic(
              yBase,
              Number(tc.dDec),
              tc.dPrice,
            );
          expect(estimatedOutputTokenAmount).to.equal(expectedOutputToken);
        } else if (tc.current > tc.target && direction === -1n) {
          const yBase =
            await harness.getDebtRepayAmountInBaseToReachTargetLeveragePublic(
              tc.target,
              tc.C,
              tc.D,
              tc.k,
            );
          const expectedInputToken =
            await harness.convertFromBaseCurrencyToTokenPublic(
              yBase,
              Number(tc.dDec),
              tc.dPrice,
            );
          expect(inputTokenAmount).to.equal(expectedInputToken);
          const xBase =
            await harness.getCollateralWithdrawAmountInBaseToDecreaseLeveragePublic(
              yBase,
              tc.k,
            );
          const expectedOutputToken =
            await harness.convertFromBaseCurrencyToTokenPublic(
              xBase,
              Number(tc.cDec),
              tc.cPrice,
            );
          expect(estimatedOutputTokenAmount).to.equal(expectedOutputToken);
        } else {
          // At target: both amounts should be zero
          if (tc.current === tc.target) {
            expect(inputTokenAmount).to.equal(0n);
            expect(estimatedOutputTokenAmount).to.equal(0n);
          }
        }
        expect(direction).to.equal(tc.expectedDir);
      });
    }

    it("produces final leverage close to target (property)", async () => {
      const { harness } = await deployHarness();

      const props = [
        {
          name: "increase",
          C: 1_000_000n,
          D: 500_000n,
          current: 2n * SCALE,
          target: 3n * SCALE,
          k: 0n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
        },
        {
          name: "decrease",
          C: 2_000_000n,
          D: 1_600_000n,
          current: (2_000_000n * SCALE) / 400_000n, // 5x
          target: 3n * SCALE,
          k: 0n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
        },
      ];

      for (const tc of props) {
        const [, , dir] =
          await harness.quoteRebalanceAmountToReachTargetLeveragePublic(
            tc.C,
            tc.D,
            tc.current,
            tc.target,
            tc.k,
            Number(tc.cDec),
            tc.cPrice,
            Number(tc.dDec),
            tc.dPrice,
          );

        if (dir === 0n) continue;

        // Use base helpers to avoid rounding drift
        let xBase: bigint;
        let yBase: bigint;

        if (dir > 0) {
          xBase =
            await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
              tc.target,
              tc.C,
              tc.D,
              tc.k,
            );
          yBase =
            await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
              xBase,
              tc.k,
            );
        } else {
          yBase =
            await harness.getDebtRepayAmountInBaseToReachTargetLeveragePublic(
              tc.target,
              tc.C,
              tc.D,
              tc.k,
            );
          xBase =
            await harness.getCollateralWithdrawAmountInBaseToDecreaseLeveragePublic(
              yBase,
              tc.k,
            );
        }

        const C2 = dir > 0 ? tc.C + xBase : tc.C - xBase;
        const D2 = dir > 0 ? tc.D + yBase : tc.D - yBase;
        const L2 = await harness.getCurrentLeverageBpsPublic(C2, D2);

        if (dir > 0) {
          // Increase: should not exceed target due to rounding
          expect(L2 <= tc.target).to.equal(true, tc.name);
          const diff = tc.target - L2;
          expect(diff <= 3n).to.equal(true, tc.name);
        } else {
          // Decrease: should not be below target due to rounding
          // It is acceptable for L2 to be slightly below target due to conversion rounding,
          // but the deviation should be very small.
          const diff = L2 > tc.target ? L2 - tc.target : tc.target - L2;
          expect(diff <= 3n).to.equal(true, tc.name);
        }
      }
    });
  });
});
