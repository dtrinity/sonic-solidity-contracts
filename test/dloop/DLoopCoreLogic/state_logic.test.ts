import { expect } from "chai";
import { ethers } from "hardhat";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";

describe("DLoopCoreLogic - State Logic", () => {
  const HUNDRED_BPS = 1_000_000n;

  /**
   * Deploys the DLoopCoreLogic harness for state logic tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("getCurrentLeverageBps", () => {
    const cases: Array<
      { name: string; C: bigint; D: bigint; expected: bigint } | { name: string; C: bigint; D: bigint; expectedError: string }
    > = [
      { name: "no collateral", C: 0n, D: 0n, expected: 0n },
      { name: "no debt -> 1x", C: 1_000_000n, D: 0n, expected: HUNDRED_BPS },
      {
        name: "equal C=D -> infinite",
        C: 1_000_000n,
        D: 1_000_000n,
        expected: (1n << 256n) - 1n,
      },
      { name: "2x leverage", C: 200n, D: 100n, expected: 2n * HUNDRED_BPS },
      { name: "10x leverage", C: 1000n, D: 900n, expected: 10n * HUNDRED_BPS },
      {
        name: "just above 1x (rounding)",
        C: 1_000_001n,
        D: 1n,
        expected: (1_000_001n * HUNDRED_BPS) / 1_000_000n,
      },
      {
        name: "large numbers",
        C: 10n ** 30n,
        D: 5n * 10n ** 29n,
        expected: (10n ** 30n * HUNDRED_BPS) / (5n * 10n ** 29n),
      },
      {
        name: "tiny surplus (C-D=1)",
        C: 1_000_000n,
        D: 999_999n,
        expected: 1_000_000n * HUNDRED_BPS,
      },
      { name: "D=0 minimal C", C: 1n, D: 0n, expected: HUNDRED_BPS },
      {
        name: "C slightly > D",
        C: 10_001n,
        D: 10_000n,
        expected: (10_001n * HUNDRED_BPS) / 1n,
      },
      {
        name: "error: C < D",
        C: 999_999n,
        D: 1_000_000n,
        expectedError: "CollateralLessThanDebt",
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();

        if ("expectedError" in tc) {
          await expect(harness.getCurrentLeverageBpsPublic(tc.C, tc.D)).to.be.revertedWithCustomError(harness, (tc as any).expectedError);
        } else {
          const res = await harness.getCurrentLeverageBpsPublic(tc.C, tc.D);
          expect(res).to.equal((tc as any).expected);

          // Sanity: result must be >= 1x when C>0 and C>=D
          if (tc.C > 0n && tc.C >= tc.D && tc.C !== tc.D) {
            expect(res >= HUNDRED_BPS).to.equal(true);
          }
        }
      });
    }
  });

  describe("getCurrentSubsidyBps", () => {
    const cases: Array<{
      name: string;
      current: bigint;
      target: bigint;
      maxSubsidy: bigint;
      minDeviation: bigint;
      expected: bigint;
    }> = [
      {
        name: "no deviation (equal)",
        current: 2n * HUNDRED_BPS,
        target: 2n * HUNDRED_BPS,
        maxSubsidy: 999_999n,
        minDeviation: 0n,
        expected: 0n,
      },
      {
        name: "+ deviation below min",
        current: 2_100_000n,
        target: 2_000_000n,
        maxSubsidy: 999_999n,
        minDeviation: 150_000n,
        expected: 0n,
      },
      {
        name: "+ deviation at min",
        current: 2_150_000n,
        target: 2_000_000n,
        maxSubsidy: 999_999n,
        minDeviation: 150_000n,
        expected: 75_000n,
      },
      {
        name: "+ deviation above min",
        current: 2_300_000n,
        target: 2_000_000n,
        maxSubsidy: 999_999n,
        minDeviation: 100_000n,
        expected: (300_000n * HUNDRED_BPS) / 2_000_000n,
      },
      {
        name: "- deviation below min",
        current: 1_900_000n,
        target: 2_000_000n,
        maxSubsidy: 999_999n,
        minDeviation: 150_000n,
        expected: 0n,
      },
      {
        name: "- deviation at min",
        current: 1_850_000n,
        target: 2_000_000n,
        maxSubsidy: 999_999n,
        minDeviation: 150_000n,
        expected: 75_000n,
      },
      {
        name: "- deviation above min",
        current: 1_600_000n,
        target: 2_000_000n,
        maxSubsidy: 999_999n,
        minDeviation: 100_000n,
        expected: (400_000n * HUNDRED_BPS) / 2_000_000n,
      },
      {
        name: "cap at maxSubsidy",
        current: 40_000n,
        target: 20_000n,
        maxSubsidy: 100n,
        minDeviation: 0n,
        expected: 100n,
      },
      {
        name: "zero maxSubsidy caps to 0",
        current: 30_000n,
        target: 20_000n,
        maxSubsidy: 0n,
        minDeviation: 0n,
        expected: 0n,
      },
      {
        name: "huge values within cap",
        current: 1000n * HUNDRED_BPS,
        target: 10n * HUNDRED_BPS,
        maxSubsidy: 9999n,
        minDeviation: 0n,
        expected: 9999n,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.getCurrentSubsidyBpsPublic(tc.current, tc.target, tc.maxSubsidy, tc.minDeviation);
        expect(res).to.equal(tc.expected);
      });
    }
  });

  describe("isTooImbalanced", () => {
    const cases: Array<{
      name: string;
      current: bigint;
      lower: bigint;
      upper: bigint;
      expected: boolean;
    }> = [
      {
        name: "no deposit (current=0) -> false",
        current: 0n,
        lower: 1_500_000n,
        upper: 2_500_000n,
        expected: false,
      },
      {
        name: "inside range lower boundary",
        current: 1_500_000n,
        lower: 1_500_000n,
        upper: 2_500_000n,
        expected: false,
      },
      {
        name: "inside range upper boundary",
        current: 2_500_000n,
        lower: 1_500_000n,
        upper: 2_500_000n,
        expected: false,
      },
      {
        name: "strictly inside range",
        current: 2_000_000n,
        lower: 1_500_000n,
        upper: 2_500_000n,
        expected: false,
      },
      {
        name: "below lower",
        current: 1_499_999n,
        lower: 1_500_000n,
        upper: 2_500_000n,
        expected: true,
      },
      {
        name: "above upper",
        current: 2_500_001n,
        lower: 1_500_000n,
        upper: 2_500_000n,
        expected: true,
      },
      {
        name: "tight range exact match",
        current: 2_000_000n,
        lower: 2_000_000n,
        upper: 2_000_000n,
        expected: false,
      },
      {
        name: "tight range not match (below)",
        current: 1_999_999n,
        lower: 2_000_000n,
        upper: 2_000_000n,
        expected: true,
      },
      {
        name: "tight range not match (above)",
        current: 2_000_001n,
        lower: 2_000_000n,
        upper: 2_000_000n,
        expected: true,
      },
      {
        name: "very large numbers in range",
        current: 500_000n,
        lower: 400_000n,
        upper: 600_000n,
        expected: false,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.isTooImbalancedPublic(tc.current, tc.lower, tc.upper);
        expect(res).to.equal(tc.expected);
      });
    }
  });
});
