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
    it("table-driven cases", async () => {
      const { harness } = await deployHarness();

      type Case = {
        name: string;
        C: bigint; // totalCollateralBase
        D: bigint; // totalDebtBase
        current: bigint;
        target: bigint;
        k: bigint; // subsidyBps
        cDec: bigint;
        cPrice: bigint;
        dDec: bigint;
        dPrice: bigint;
        expectedDir: number;
      };

      const cases: Case[] = [
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
          name: "increase with subsidy",
          C: 1_000_000n,
          D: 666_666n,
          current: 3n * SCALE,
          target: 2n * SCALE,
          k: 100n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
          expectedDir: 1,
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
      ];

      for (const tc of cases) {
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

        if (tc.current < tc.target) {
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
          expect(inputTokenAmount).to.equal(
            expectedInputToken,
            tc.name + " input",
          );
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
          expect(estimatedOutputTokenAmount).to.equal(
            expectedOutputToken,
            tc.name + " output",
          );
        } else if (tc.current > tc.target) {
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
          expect(inputTokenAmount).to.equal(
            expectedInputToken,
            tc.name + " input",
          );
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
          expect(estimatedOutputTokenAmount).to.equal(
            expectedOutputToken,
            tc.name + " output",
          );
        } else {
          expect(inputTokenAmount).to.equal(0n);
          expect(estimatedOutputTokenAmount).to.equal(0n);
        }
        expect(direction).to.equal(tc.expectedDir, tc.name + " dir");
      }
    });
  });
});
