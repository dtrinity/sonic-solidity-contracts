import { expect } from "chai";
import { ethers } from "hardhat";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";

describe("DLoopCoreLogic - Maintain Leverage", () => {
  const SCALE = 1_000_000n;

  const pow10 = (n: bigint): bigint => 10n ** n;

  const toBase = (amountToken: bigint, dec: bigint, price: bigint): bigint =>
    (amountToken * price) / pow10(dec);
  const toToken = (amountBase: bigint, dec: bigint, price: bigint): bigint =>
    (amountBase * pow10(dec)) / price;

  /**
   * Deploys the DLoopCoreLogic harness for maintain leverage tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("getRepayAmountThatKeepCurrentLeverage", () => {
    it("table-driven cases", async () => {
      const { harness } = await deployHarness();

      const cases: Array<
        | {
            name: string;
            targetWithdrawToken: bigint;
            L: bigint; // leverageBpsBeforeRepayDebt
            cDec: bigint;
            cPrice: bigint;
            dDec: bigint;
            dPrice: bigint;
            expected: bigint;
          }
        | {
            name: string;
            targetWithdrawToken: bigint;
            L: bigint;
            cDec: bigint;
            cPrice: bigint;
            dDec: bigint;
            dPrice: bigint;
            expected: 0n;
          }
      > = [
        {
          name: "leverage=0 -> 0",
          targetWithdrawToken: 1_000n,
          L: 0n,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
          expected: 0n,
        },
        {
          name: "1e18 withdraw, 2x leverage, equal prices/decimals",
          targetWithdrawToken: pow10(18n),
          L: 2n * SCALE,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
          expected: toToken(
            (toBase(pow10(18n), 18n, pow10(18n)) * (2n * SCALE - SCALE)) /
              (2n * SCALE),
            18n,
            pow10(18n),
          ),
        },
        {
          name: "0.5x price debt cheaper",
          targetWithdrawToken: pow10(18n),
          L: 3n * SCALE,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: 5n * pow10(17n),
          expected: toToken(
            (toBase(pow10(18n), 18n, pow10(18n)) * (3n * SCALE - SCALE)) /
              (3n * SCALE),
            18n,
            5n * pow10(17n),
          ),
        },
        {
          name: "debt more expensive",
          targetWithdrawToken: pow10(18n),
          L: 4n * SCALE,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: 2n * pow10(18n),
          expected: toToken(
            (toBase(pow10(18n), 18n, pow10(18n)) * (4n * SCALE - SCALE)) /
              (4n * SCALE),
            18n,
            2n * pow10(18n),
          ),
        },
        {
          name: "6 decimals",
          targetWithdrawToken: pow10(6n),
          L: 5n * SCALE,
          cDec: 6n,
          cPrice: pow10(6n),
          dDec: 6n,
          dPrice: pow10(6n),
          expected: toToken(
            (toBase(pow10(6n), 6n, pow10(6n)) * (5n * SCALE - SCALE)) /
              (5n * SCALE),
            6n,
            pow10(6n),
          ),
        },
        {
          name: "rounding down",
          targetWithdrawToken: 100n,
          L: 3n * SCALE,
          cDec: 18n,
          cPrice: 3n,
          dDec: 18n,
          dPrice: 7n,
          expected: toToken(
            (toBase(100n, 18n, 3n) * (3n * SCALE - SCALE)) / (3n * SCALE),
            18n,
            7n,
          ),
        },
        {
          name: "tiny withdraw",
          targetWithdrawToken: 1n,
          L: 10n * SCALE,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
          expected: toToken(
            (toBase(1n, 18n, pow10(18n)) * (10n * SCALE - SCALE)) /
              (10n * SCALE),
            18n,
            pow10(18n),
          ),
        },
        {
          name: "big numbers",
          targetWithdrawToken: 10n ** 24n,
          L: 7n * SCALE,
          cDec: 18n,
          cPrice: pow10(18n),
          dDec: 18n,
          dPrice: pow10(18n),
          expected: toToken(
            (toBase(10n ** 24n, 18n, pow10(18n)) * (7n * SCALE - SCALE)) /
              (7n * SCALE),
            18n,
            pow10(18n),
          ),
        },
        {
          name: "different decimals",
          targetWithdrawToken: pow10(8n),
          L: 2n * SCALE,
          cDec: 8n,
          cPrice: pow10(8n),
          dDec: 6n,
          dPrice: pow10(6n),
          expected: toToken(
            (toBase(pow10(8n), 8n, pow10(8n)) * (2n * SCALE - SCALE)) /
              (2n * SCALE),
            6n,
            pow10(6n),
          ),
        },
        {
          name: "non-1 prices",
          targetWithdrawToken: pow10(18n),
          L: 6n * SCALE,
          cDec: 18n,
          cPrice: 123456789n,
          dDec: 18n,
          dPrice: 987654321n,
          expected: toToken(
            (toBase(pow10(18n), 18n, 123456789n) * (6n * SCALE - SCALE)) /
              (6n * SCALE),
            18n,
            987654321n,
          ),
        },
      ];

      for (const tc of cases) {
        const res = await harness.getRepayAmountThatKeepCurrentLeveragePublic(
          tc.targetWithdrawToken,
          tc.L,
          Number(tc.cDec),
          tc.cPrice,
          Number(tc.dDec),
          tc.dPrice,
        );
        expect(res).to.equal(tc.expected, tc.name);
      }
    });
  });

  describe("getBorrowAmountThatKeepCurrentLeverage", () => {
    it("table-driven cases", async () => {
      const { harness } = await deployHarness();

      const toBaseLocal = toBase;
      const toTokenLocal = toToken;

      const compute = (
        suppliedCollateralAmount: bigint,
        leverageBpsBeforeSupply: bigint,
        targetLeverageBps: bigint,
        cDec: bigint,
        cPrice: bigint,
        dDec: bigint,
        dPrice: bigint,
      ): bigint => {
        const L =
          leverageBpsBeforeSupply === 0n
            ? targetLeverageBps
            : leverageBpsBeforeSupply;
        const suppliedBase = toBaseLocal(
          suppliedCollateralAmount,
          cDec,
          cPrice,
        );
        const borrowBase = (suppliedBase * (L - SCALE)) / L;
        return toTokenLocal(borrowBase, dDec, dPrice);
      };

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
      ].map((tc) => ({
        ...tc,
        expected: compute(
          tc.supplied,
          tc.L0,
          tc.T,
          tc.cDec,
          tc.cPrice,
          tc.dDec,
          tc.dPrice,
        ),
      }));

      for (const tc of cases) {
        const res = await harness.getBorrowAmountThatKeepCurrentLeveragePublic(
          tc.supplied,
          tc.L0,
          tc.T,
          Number(tc.cDec),
          tc.cPrice,
          Number(tc.dDec),
          tc.dPrice,
        );
        expect(res).to.equal(tc.expected, tc.name);
      }
    });

    it("uses target leverage when prior leverage is zero", async () => {
      const { harness } = await deployHarness();
      const supplied = 1_000_000n;
      const L0 = 0n;
      const T = 3_000_000n; // 3x
      const cDec = 18n;
      const cPrice = 10n ** 18n;
      const dDec = 18n;
      const dPrice = 10n ** 18n;

      const res = await harness.getBorrowAmountThatKeepCurrentLeveragePublic(
        supplied,
        L0,
        T,
        Number(cDec),
        cPrice,
        Number(dDec),
        dPrice,
      );
      const expected = (supplied * (T - 1_000_000n)) / T;
      expect(res).to.equal(expected);
    });
  });
});
