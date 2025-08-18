import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreViewStub,
  DLoopDepositorLogicHarness,
} from "../../../typechain-types";
import { ONE_HUNDRED_PERCENT_BPS } from "../../../typescript/common/bps_constants";

describe("DLoopDepositorLogic - slippage and min output", () => {
  let harness: DLoopDepositorLogicHarness;
  let dloop: DLoopCoreViewStub;

  beforeEach(async () => {
    const Stub = await ethers.getContractFactory("DLoopCoreViewStub");
    dloop = (await Stub.deploy()) as unknown as DLoopCoreViewStub;
    const Harness = await ethers.getContractFactory(
      "DLoopDepositorLogicHarness",
    );
    harness = (await Harness.deploy()) as unknown as DLoopDepositorLogicHarness;
  });

  it("calculateEstimatedOverallSlippageBps - table", async () => {
    const cases: Array<
      | { cur: bigint; min: bigint; want: bigint }
      | { cur: bigint; min: bigint; revert: boolean }
    > = [
      { cur: 1000n, min: 1000n, want: 0n },
      { cur: 1000n, min: 900n, want: 100n },
      { cur: 1000n, min: 800n, want: 200n },
      { cur: 1000n, min: 500n, want: 500n },
      { cur: 10_000n, min: 9_999n, want: 1n },
      { cur: 1n, min: 0n, want: BigInt(ONE_HUNDRED_PERCENT_BPS) },
      { cur: 10_000_000n, min: 9_900_000n, want: 1000n },
      {
        cur: 1_000_000_000_000_000_000n,
        min: 999_999_999_999_999_999n,
        want: 1n,
      },
      { cur: 123456789n, min: 120000000n, want: 2790n },
      { cur: 9999n, min: 1n, want: 9998n },
      { cur: 1000n, min: 1001n, revert: true },
    ];

    for (const c of cases) {
      if ("revert" in c && c.revert) {
        await expect(
          harness.calculateEstimatedOverallSlippageBpsPublic(c.cur, c.min),
        ).to.be.reverted;
      } else {
        const got = await harness.calculateEstimatedOverallSlippageBpsPublic(
          c.cur,
          c.min,
        );
        const expected =
          (BigInt(ONE_HUNDRED_PERCENT_BPS) * (c.cur - c.min)) / c.cur;
        expect(got).to.equal(expected);
      }
    }
  });

  it("calculateRequiredAdditionalCollateral - table", async () => {
    const cases: Array<{
      lev: bigint;
      dep: bigint;
      want?: bigint;
      revert?: boolean;
    }> = [
      { lev: 1000n, dep: 1000n, want: 0n },
      { lev: 1000n, dep: 900n, want: 100n },
      { lev: 10_000n, dep: 1n, want: 9_999n },
      { lev: 1_000_000n, dep: 999_999n, want: 1n },
      { lev: 0n, dep: 0n, want: 0n },
      { lev: 1n, dep: 2n, revert: true },
      { lev: 50n, dep: 49n, want: 1n },
      { lev: 2n, dep: 1n, want: 1n },
      { lev: 100n, dep: 0n, want: 100n },
      {
        lev: 1_000_000_000_000_000_000n,
        dep: 0n,
        want: 1_000_000_000_000_000_000n,
      },
    ];

    for (const c of cases) {
      if (c.revert) {
        await expect(
          harness.calculateRequiredAdditionalCollateralPublic(c.lev, c.dep),
        ).to.be.reverted;
      } else {
        const got = await harness.calculateRequiredAdditionalCollateralPublic(
          c.lev,
          c.dep,
        );
        expect(got).to.equal(c.want!);
      }
    }
  });

  it("calculateMinOutputShares - table", async () => {
    const slippageCases = [
      0, 1_000, 10_000, 50_000, 100_000, 123_456, 250_000, 333_333, 500_000,
      750_000, 999_999,
    ];

    for (const dep of [
      1n,
      10n,
      1234n,
      ethers.parseEther("1"),
      ethers.parseEther("10"),
    ]) {
      for (const s of slippageCases) {
        const got = await harness.calculateMinOutputSharesPublic(
          dep,
          BigInt(s),
          dloop.getAddress(),
        );
        // expectedSharesBeforeSlippage = dep * targetLeverage (3x)
        const expectedBefore = dep * 3n;
        const expectedAfter =
          (expectedBefore * BigInt(ONE_HUNDRED_PERCENT_BPS - s)) /
          BigInt(ONE_HUNDRED_PERCENT_BPS);
        expect(got).to.equal(expectedAfter);
      }
    }

    // revert when slippage > 100%
    await expect(
      harness.calculateMinOutputSharesPublic(
        1000n,
        BigInt(ONE_HUNDRED_PERCENT_BPS + 1),
        dloop.getAddress(),
      ),
    ).to.be.reverted;
  });
});
