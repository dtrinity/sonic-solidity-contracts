import { expect } from "chai";
import { ethers } from "hardhat";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";

describe("DLoopCoreLogic - Leverage Scaling", () => {
  const SCALE = 1_000_000n; // ONE_HUNDRED_PERCENT_BPS

  /**
   * Deploys the DLoopCoreLogic harness for leverage scaling tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("getUnleveragedAssetsWithLeverage", () => {
    const cases = [
      {
        name: "1x",
        leveraged: 1_000_000n,
        leverage: SCALE,
        expected: 1_000_000n,
      },
      {
        name: "2x",
        leveraged: 1_000_000n,
        leverage: 2n * SCALE,
        expected: 500_000n,
      },
      {
        name: "4x",
        leveraged: 1_000_000n,
        leverage: 4n * SCALE,
        expected: 250_000n,
      },
      {
        name: "10x",
        leveraged: 1_000_000n,
        leverage: 10n * SCALE,
        expected: 100_000n,
      },
      {
        name: "rounding down",
        leveraged: 100n,
        leverage: 3n * SCALE,
        expected: 33n,
      },
      {
        name: "large numbers",
        leveraged: 10n ** 30n,
        leverage: 5n * SCALE,
        expected: 10n ** 30n / 5n,
      },
      {
        name: "SCALE edge",
        leveraged: 123456789n,
        leverage: SCALE + 1n,
        expected: (123456789n * SCALE) / (SCALE + 1n),
      },
      {
        name: "minimum leveraged",
        leveraged: 1n,
        leverage: 2n * SCALE,
        expected: 0n,
      },
      {
        name: "3x",
        leveraged: 999_999n,
        leverage: 3n * SCALE,
        expected: (999_999n * SCALE) / (3n * SCALE),
      },
      {
        name: "7x",
        leveraged: 777_777n,
        leverage: 7n * SCALE,
        expected: (777_777n * SCALE) / (7n * SCALE),
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.getUnleveragedAssetsWithLeveragePublic(tc.leveraged, Number(tc.leverage));
        expect(res).to.equal(tc.expected);
      });
    }
  });

  describe("getLeveragedAssetsWithLeverage", () => {
    const cases = [
      { name: "1x", assets: 1_000_000n, leverage: SCALE, expected: 1_000_000n },
      {
        name: "2x",
        assets: 1_000_000n,
        leverage: 2n * SCALE,
        expected: 2_000_000n,
      },
      {
        name: "4x",
        assets: 1_000_000n,
        leverage: 4n * SCALE,
        expected: 4_000_000n,
      },
      {
        name: "10x",
        assets: 100_000n,
        leverage: 10n * SCALE,
        expected: 1_000_000n,
      },
      {
        name: "rounding exact",
        assets: 100n,
        leverage: 3n * SCALE,
        expected: 300n,
      },
      {
        name: "large numbers",
        assets: 10n ** 30n,
        leverage: 5n * SCALE,
        expected: 5n * 10n ** 30n,
      },
      {
        name: "SCALE edge",
        assets: 123456789n,
        leverage: SCALE + 1n,
        expected: (123456789n * (SCALE + 1n)) / SCALE,
      },
      { name: "min asset", assets: 1n, leverage: 2n * SCALE, expected: 2n },
      {
        name: "3x",
        assets: 999_999n,
        leverage: 3n * SCALE,
        expected: 2_999_997n,
      },
      {
        name: "7x",
        assets: 777_777n,
        leverage: 7n * SCALE,
        expected: 5_444_439n,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.getLeveragedAssetsWithLeveragePublic(tc.assets, Number(tc.leverage));
        expect(res).to.equal(tc.expected);
      });
    }
  });
});
