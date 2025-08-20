import { expect } from "chai";
import { ethers } from "hardhat";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";

describe("DLoopCoreLogic - Fee Logic", () => {
  const SCALE = 1_000_000n;

  /**
   * Deploys the DLoopCoreLogic harness for fee logic tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("getGrossAmountRequiredForNet", () => {
    it("table-driven cases", async () => {
      const { harness } = await deployHarness();
      const cases = [
        { name: "zero fee", net: 1_000_000n, fee: 0n },
        { name: "1% fee", net: 1_000_000n, fee: 10_000n },
        { name: "0.01% fee rounding", net: 100n, fee: 100n },
        { name: "half pct", net: 999_999n, fee: 5_000n },
        { name: "max fee-1", net: 555_555n, fee: SCALE - 1n },
        { name: "tiny net", net: 1n, fee: 100n },
        { name: "large net", net: 10n ** 30n, fee: 0n },
        { name: "random", net: 123_456_789n, fee: 2_500n },
        { name: "another", net: 987_654_321n, fee: 3_333n },
        { name: "fee 1 bps", net: 777_777n, fee: 100n },
      ];

      for (const tc of cases) {
        const expected = (tc.net * SCALE) / (SCALE - tc.fee);
        const res = await harness.getGrossAmountRequiredForNetPublic(
          tc.net,
          tc.fee,
        );
        expect(res).to.equal(expected, tc.name);
      }
    });
  });

  describe("getNetAmountAfterFee", () => {
    it("table-driven cases", async () => {
      const { harness } = await deployHarness();
      const cases = [
        { name: "zero fee", gross: 1_000_000n, fee: 0n },
        { name: "1% fee", gross: 1_000_000n, fee: 10_000n },
        { name: "0.01% fee rounding", gross: 100n, fee: 100n },
        { name: "half pct", gross: 999_999n, fee: 5_000n },
        { name: "max fee-1", gross: 555_555n, fee: SCALE - 1n },
        { name: "tiny gross", gross: 1n, fee: 100n },
        { name: "large gross", gross: 10n ** 30n, fee: 0n },
        { name: "random", gross: 123_456_789n, fee: 2_500n },
        { name: "another", gross: 987_654_321n, fee: 3_333n },
        { name: "fee 1 bps", gross: 777_777n, fee: 100n },
      ];

      for (const tc of cases) {
        const expected = (tc.gross * (SCALE - tc.fee)) / SCALE;
        const res = await harness.getNetAmountAfterFeePublic(tc.gross, tc.fee);
        expect(res).to.equal(expected, tc.name);
      }
    });
  });
});
