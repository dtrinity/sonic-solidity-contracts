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
    it("error: C=0", async () => {
      const { harness } = await deployHarness();
      await expect(
        harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          2n * SCALE,
          0n,
          0n,
          0n,
        ),
      ).to.be.revertedWithCustomError(harness, "TotalCollateralBaseIsZero");
    });

    it("error: C<D", async () => {
      const { harness } = await deployHarness();
      await expect(
        harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          2n * SCALE,
          1000n,
          1001n,
          0n,
        ),
      ).to.be.revertedWithCustomError(
        harness,
        "TotalCollateralBaseIsLessThanTotalDebtBase",
      );
    });

    it("simple 2x, no subsidy", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          2n * SCALE,
          1_000_000n,
          500_000n,
          0n,
        );
      expect(res).to.equal(0n);
    });

    it("3x, no subsidy", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          3n * SCALE,
          1_000_000n,
          666_666n,
          0n,
        );
      expect(res).to.equal(2n);
    });

    it("2x, small subsidy", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          2n * SCALE,
          1_000_000n,
          500_000n,
          1_000n,
        );
      expect(res).to.equal(0n);
    });

    it("high subsidy cap", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          5n * SCALE,
          2_000_000n,
          1_000_000n,
          10_000n,
        );
      expect(res).to.equal(2_857_143n);
    });

    it("already near target (tiny)", async () => {
      const { harness } = await deployHarness();
      await expect(
        harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          2n * SCALE,
          1_000_001n,
          500_001n,
          0n,
        ),
      ).to.be.revertedWithPanic(0x11);
    });

    it("large numbers", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          7n * SCALE,
          10n ** 24n,
          3n * 10n ** 23n,
          0n,
        );
      expect(res).to.equal(3_900_000_000_000_000_000_000_000n);
    });

    it("tiny surplus", async () => {
      const { harness } = await deployHarness();
      await expect(
        harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          10n * SCALE,
          1_000_000n,
          999_999n,
          0n,
        ),
      ).to.be.revertedWithPanic(0x11);
    });

    it("with subsidy rounding up", async () => {
      const { harness } = await deployHarness();
      await expect(
        harness.getCollateralTokenDepositAmountToReachTargetLeveragePublic(
          3n * SCALE,
          1_000_000n,
          750_000n,
          3_333n,
        ),
      ).to.be.revertedWithPanic(0x11);
    });
  });

  describe("getDebtBorrowAmountInBaseToIncreaseLeverage", () => {
    it("no subsidy", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          1_000_000n,
          0n,
        );
      expect(res).to.equal(1_000_000n);
    });

    it("+100 bps", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          1_000_000n,
          10_000n,
        );
      expect(res).to.equal((1_000_000n * (SCALE + 10_000n)) / SCALE);
    });

    it("+333 bps rounding down", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          100n,
          3_333n,
        );
      expect(res).to.equal((100n * (SCALE + 3_333n)) / SCALE);
    });

    it("zero", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(0n, 0n);
      expect(res).to.equal(0n);
    });

    it("tiny", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          1n,
          100n,
        );
      expect(res).to.equal((1n * (SCALE + 100n)) / SCALE);
    });

    it("large x", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          10n ** 30n,
          0n,
        );
      expect(res).to.equal(10n ** 30n);
    });

    it("large k", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          10n ** 6n,
          99_999n,
        );
      expect(res).to.equal((10n ** 6n * (SCALE + 99_999n)) / SCALE);
    });

    it("mid", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          123_456_789n,
          25_000n,
        );
      expect(res).to.equal((123_456_789n * (SCALE + 25_000n)) / SCALE);
    });

    it("k=1", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          999_999n,
          1n,
        );
      expect(res).to.equal((999_999n * (SCALE + 1n)) / SCALE);
    });

    it("k=SCALE-1", async () => {
      const { harness } = await deployHarness();
      const res =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          555_555n,
          SCALE - 1n,
        );
      expect(res).to.equal((555_555n * (2n * SCALE - 1n)) / SCALE);
    });
  });

  describe("getDebtBorrowTokenAmountToIncreaseLeverage", () => {
    it("1e18, no subsidy, equal price", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        pow10(18n),
        18,
        pow10(18n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          0n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          pow10(18n),
          0n,
          18,
          pow10(18n),
          18,
          pow10(18n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          pow10(18n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * pow10(18n)).to.equal(true);
    });

    it("3e18, +100bps", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        3n * pow10(18n),
        18,
        pow10(18n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          10_000n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          3n * pow10(18n),
          10_000n,
          18,
          pow10(18n),
          18,
          pow10(18n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          pow10(18n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * pow10(18n)).to.equal(true);
    });

    it("6 decimals", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        pow10(6n),
        6,
        pow10(6n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          3_333n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          pow10(6n),
          3_333n,
          6,
          pow10(6n),
          6,
          pow10(6n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          6,
          pow10(6n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * pow10(6n)).to.equal(true);
    });

    it("debt cheaper", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        pow10(18n),
        18,
        pow10(18n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          25_000n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          pow10(18n),
          25_000n,
          18,
          pow10(18n),
          18,
          5n * pow10(17n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          5n * pow10(17n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * (5n * pow10(17n))).to.equal(true);
    });

    it("debt more expensive", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        pow10(18n),
        18,
        pow10(18n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          25_000n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          pow10(18n),
          25_000n,
          18,
          pow10(18n),
          18,
          2n * pow10(18n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          2n * pow10(18n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * (2n * pow10(18n))).to.equal(true);
    });

    it("tiny", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        1n,
        18,
        pow10(18n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          0n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          1n,
          0n,
          18,
          pow10(18n),
          18,
          pow10(18n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          pow10(18n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * pow10(18n)).to.equal(true);
    });

    it("big", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        10n ** 24n,
        18,
        pow10(18n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          0n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          10n ** 24n,
          0n,
          18,
          pow10(18n),
          18,
          pow10(18n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          pow10(18n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * pow10(18n)).to.equal(true);
    });

    it("different decimals", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        pow10(8n),
        8,
        pow10(8n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          0n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          pow10(8n),
          0n,
          8,
          pow10(8n),
          6,
          pow10(6n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          6,
          pow10(6n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * pow10(6n)).to.equal(true);
    });

    it("non-1 prices", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        pow10(18n),
        18,
        123456789n,
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          77_700n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          pow10(18n),
          77_700n,
          18,
          123456789n,
          18,
          987654321n,
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          987654321n,
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * 987654321n).to.equal(true);
    });

    it("edge k=SCALE-1", async () => {
      const { harness } = await deployHarness();
      const xBase = await harness.convertFromTokenAmountToBaseCurrencyPublic(
        pow10(18n),
        18,
        pow10(18n),
      );
      const baseExpected =
        await harness.getDebtBorrowAmountInBaseToIncreaseLeveragePublic(
          xBase,
          SCALE - 1n,
        );
      const tokenOut =
        await harness.getDebtBorrowTokenAmountToIncreaseLeveragePublic(
          pow10(18n),
          SCALE - 1n,
          18,
          pow10(18n),
          18,
          pow10(18n),
        );
      const baseFromToken =
        await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tokenOut,
          18,
          pow10(18n),
        );
      const diff =
        baseExpected > baseFromToken
          ? baseExpected - baseFromToken
          : baseFromToken - baseExpected;
      expect(diff < 2n * pow10(18n)).to.equal(true);
    });

    it("error: zero input collateral", async () => {
      const { harness } = await deployHarness();
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
