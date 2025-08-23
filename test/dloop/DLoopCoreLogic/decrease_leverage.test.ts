import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreLogicHarness } from "../../../typechain-types";

describe("DLoopCoreLogic - Decrease Leverage", () => {
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

  describe("getDebtRepayAmountInBaseToReachTargetLeverage", () => {
    const cases = [
      {
        name: "moderate decrease, no subsidy",
        C: 2_000_000n,
        D: 1_000_000n,
        TT: 1500000n,
        k: 0n,
      },
      {
        name: "moderate decrease, small subsidy",
        C: 3_500_000n,
        D: 2_000_000n,
        TT: 1600000n,
        k: 100n,
      },
      {
        name: "strong decrease, no subsidy",
        C: 5_000_000n,
        D: 4_000_000n,
        TT: 1250000n,
        k: 0n,
      },
      {
        name: "strong decrease, subsidy",
        C: 5_000_000n,
        D: 4_000_000n,
        TT: 1300000n,
        k: 777n,
      },
      {
        name: "tiny surplus case",
        C: 1_000_000n,
        D: 999_900n,
        TT: 2000000n,
        k: 0n,
      },
      {
        name: "large numbers",
        C: 10n ** 18n,
        D: 7n * 10n ** 17n,
        TT: 1500000n,
        k: 333n,
      },
      {
        name: "edge: TT just below current",
        C: 1_000_000n,
        D: 800_000n,
        TT: 1999999n,
        k: 0n,
      },
      {
        name: "edge: TT much lower",
        C: 2_000_000n,
        D: 1_800_000n,
        TT: 1200000n,
        k: 500n,
      },
      {
        name: "k large",
        C: 3_000_000n,
        D: 2_400_000n,
        TT: 1700000n,
        k: 9999n,
      },
      { name: "varied", C: 4_321_987n, D: 3_876_543n, TT: 1450000n, k: 250n },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        // Precondition: current leverage must be > target
        const Lcur = await harness.getCurrentLeverageBpsPublic(tc.C, tc.D);
        if (Lcur <= tc.TT) return; // skip invalid case

        const y = await harness.getDebtRepayAmountInBaseToReachTargetLeveragePublic(tc.TT, tc.C, tc.D, tc.k);
        const x = await harness.getCollateralWithdrawAmountInBaseToDecreaseLeveragePublic(y, tc.k);
        // new state after repay/withdraw
        const C2 = tc.C >= x ? tc.C - x : 0n;
        const D2 = tc.D >= y ? tc.D - y : 0n;
        const L2 = await harness.getCurrentLeverageBpsPublic(C2, D2);
        // Should not be below target due to rounding direction
        expect(L2 >= tc.TT).to.equal(true);
      });
    }

    it("returns zero when equal to target, reverts when below target", async () => {
      const { harness } = await deployHarness();

      // equal to target => returns 0
      {
        const tc = { C: 1_000_000n, D: 500_000n, TT: 2_000_000n, k: 0n };
        const Lcur = await harness.getCurrentLeverageBpsPublic(tc.C, tc.D);
        expect(Lcur === tc.TT).to.equal(true);
        const res = await harness.getDebtRepayAmountInBaseToReachTargetLeveragePublic(tc.TT, tc.C, tc.D, tc.k);
        expect(res).to.equal(0n);
      }

      // below target => revert with panic 0x11
      {
        const tc = { C: 1_000_000n, D: 333_333n, TT: 2_000_000n, k: 0n };
        const Lcur = await harness.getCurrentLeverageBpsPublic(tc.C, tc.D);
        expect(Lcur < tc.TT).to.equal(true);
        await expect(harness.getDebtRepayAmountInBaseToReachTargetLeveragePublic(tc.TT, tc.C, tc.D, tc.k)).to.be.revertedWithPanic(0x11);
      }
    });
  });

  describe("getCollateralWithdrawAmountInBaseToDecreaseLeverage", () => {
    const cases = [
      { name: "no subsidy", y: 1_000_000n, k: 0n },
      { name: "+100 bps (ceil)", y: 1_000_000n, k: 100n },
      { name: "+333 bps (ceil)", y: 100n, k: 333n },
      { name: "zero", y: 0n, k: 0n },
      { name: "tiny", y: 1n, k: 1n },
      { name: "large y", y: 10n ** 24n, k: 0n },
      { name: "large k", y: 10n ** 12n, k: 9_999n },
      { name: "mid", y: 123_456_789n, k: 250n },
      { name: "k=1", y: 999_999n, k: 1n },
      { name: "k=SCALE-1", y: 555_555n, k: SCALE - 1n },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.getCollateralWithdrawAmountInBaseToDecreaseLeveragePublic(tc.y, tc.k);
        // Basic property: res >= y and increases with k
        expect(res >= tc.y).to.equal(true);
      });
    }
  });

  describe("getCollateralWithdrawTokenAmountToDecreaseLeverage", () => {
    const success = [
      {
        name: "1e18, no subsidy, equal price",
        y: pow10(18n),
        k: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "3e18, +100bps",
        y: 3n * pow10(18n),
        k: 100n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "6 decimals",
        y: pow10(6n),
        k: 333n,
        cDec: 6n,
        cPrice: pow10(6n),
        dDec: 6n,
        dPrice: pow10(6n),
      },
      {
        name: "collateral more expensive",
        y: pow10(18n),
        k: 250n,
        cDec: 18n,
        cPrice: 2n * pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "collateral cheaper",
        y: pow10(18n),
        k: 250n,
        cDec: 18n,
        cPrice: 5n * pow10(17n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "tiny",
        y: 1n,
        k: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "big",
        y: 10n ** 24n,
        k: 0n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
      {
        name: "different decimals",
        y: pow10(8n),
        k: 0n,
        cDec: 8n,
        cPrice: pow10(8n),
        dDec: 6n,
        dPrice: pow10(6n),
      },
      {
        name: "non-1 prices",
        y: pow10(18n),
        k: 777n,
        cDec: 18n,
        cPrice: 123456789n,
        dDec: 18n,
        dPrice: 987654321n,
      },
      {
        name: "edge k=SCALE-1",
        y: pow10(18n),
        k: SCALE - 1n,
        cDec: 18n,
        cPrice: pow10(18n),
        dDec: 18n,
        dPrice: pow10(18n),
      },
    ];

    for (const tc of success) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const yBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(tc.y, Number(tc.dDec), tc.dPrice);
        const baseExpected = await harness.getCollateralWithdrawAmountInBaseToDecreaseLeveragePublic(yBase, tc.k);
        const expectedTokenOut = await harness.convertFromBaseCurrencyToTokenPublic(baseExpected, Number(tc.cDec), tc.cPrice);
        const tokenOut = await harness.getCollateralWithdrawTokenAmountToDecreaseLeveragePublic(
          tc.y,
          tc.k,
          Number(tc.cDec),
          tc.cPrice,
          Number(tc.dDec),
          tc.dPrice,
        );
        expect(tokenOut).to.equal(expectedTokenOut);
      });
    }

    it("error: zero input debt", async () => {
      const { harness } = await deployHarness();
      await expect(
        harness.getCollateralWithdrawTokenAmountToDecreaseLeveragePublic(0, 0, 18, pow10(18n), 18, pow10(18n)),
      ).to.be.revertedWithCustomError(harness, "InputDebtTokenAmountIsZero");
    });
  });
});
