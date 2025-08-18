import { expect } from "chai";
import { ethers } from "hardhat";

describe("Compare library", function () {
  /**
   *
   */
  async function deployHarness() {
    const HarnessFactory = await ethers.getContractFactory("CompareHarness");
    const harness = await HarnessFactory.deploy();
    return { harness };
  }

  describe("isWithinTolerance", function () {
    it("returns true when values are equal and tolerance is 0", async function () {
      const { harness } = await deployHarness();
      expect(await harness.isWithinTolerancePublic(100n, 100n, 0n)).to.equal(
        true,
      );
    });

    it("returns false when difference is 1 and tolerance is 0", async function () {
      const { harness } = await deployHarness();
      expect(await harness.isWithinTolerancePublic(101n, 100n, 0n)).to.equal(
        false,
      );
      expect(await harness.isWithinTolerancePublic(100n, 101n, 0n)).to.equal(
        false,
      );
    });

    it("returns true when difference equals tolerance boundary", async function () {
      const { harness } = await deployHarness();
      expect(await harness.isWithinTolerancePublic(105n, 100n, 5n)).to.equal(
        true,
      );
      expect(await harness.isWithinTolerancePublic(100n, 105n, 5n)).to.equal(
        true,
      );
    });

    it("returns true when difference is below tolerance and false when above", async function () {
      const { harness } = await deployHarness();
      // below
      expect(await harness.isWithinTolerancePublic(104n, 100n, 5n)).to.equal(
        true,
      );
      // above
      expect(await harness.isWithinTolerancePublic(106n, 100n, 5n)).to.equal(
        false,
      );
    });

    it("handles zero values correctly", async function () {
      const { harness } = await deployHarness();
      expect(await harness.isWithinTolerancePublic(0n, 0n, 0n)).to.equal(true);
      expect(await harness.isWithinTolerancePublic(0n, 1n, 1n)).to.equal(true);
      expect(await harness.isWithinTolerancePublic(1n, 0n, 0n)).to.equal(false);
    });

    it("handles extreme max uint256 values", async function () {
      const { harness } = await deployHarness();
      const UINT_MAX = (1n << 256n) - 1n;
      // equal
      expect(
        await harness.isWithinTolerancePublic(UINT_MAX, UINT_MAX, 0n),
      ).to.equal(true);
      // far apart: require max tolerance
      expect(
        await harness.isWithinTolerancePublic(UINT_MAX, 0n, UINT_MAX - 1n),
      ).to.equal(false);
      expect(
        await harness.isWithinTolerancePublic(UINT_MAX, 0n, UINT_MAX),
      ).to.equal(true);
    });

    it("is symmetric for observed < expected and observed > expected", async function () {
      const { harness } = await deployHarness();
      expect(
        await harness.isWithinTolerancePublic(1_000_010n, 1_000_000n, 10n),
      ).to.equal(true);
      expect(
        await harness.isWithinTolerancePublic(1_000_000n, 1_000_010n, 10n),
      ).to.equal(true);
    });
  });

  describe("checkBalanceDelta", function () {
    it("Increase: direction false when after <= before", async function () {
      const { harness } = await deployHarness();
      const [directionOk, observedDelta, toleranceOk] =
        await harness.checkBalanceDeltaPublic(
          100n,
          100n,
          0n,
          0n,
          0, // Compare.BalanceDirection.Increase
        );
      expect(directionOk).to.equal(false);
      expect(observedDelta).to.equal(0n);
      expect(toleranceOk).to.equal(false);

      const res2 = await harness.checkBalanceDeltaPublic(100n, 99n, 1n, 0n, 0);
      expect(res2[0]).to.equal(false);
      expect(res2[1]).to.equal(0n);
      expect(res2[2]).to.equal(false);
    });

    it("Increase: correct delta and tolerance within/at/above boundary", async function () {
      const { harness } = await deployHarness();
      // exact expected, zero tolerance
      let res = await harness.checkBalanceDeltaPublic(100n, 150n, 50n, 0n, 0);
      expect(res[0]).to.equal(true);
      expect(res[1]).to.equal(50n);
      expect(res[2]).to.equal(true);

      // within tolerance (expected 49, tol 1)
      res = await harness.checkBalanceDeltaPublic(100n, 150n, 49n, 1n, 0);
      expect(res[2]).to.equal(true);

      // at boundary (expected 51, tol 1)
      res = await harness.checkBalanceDeltaPublic(100n, 150n, 51n, 1n, 0);
      expect(res[2]).to.equal(true);

      // above tolerance (expected 52, tol 1)
      res = await harness.checkBalanceDeltaPublic(100n, 150n, 52n, 1n, 0);
      expect(res[2]).to.equal(false);
    });

    it("Decrease: direction false when after >= before", async function () {
      const { harness } = await deployHarness();
      const [directionOk, observedDelta, toleranceOk] =
        await harness.checkBalanceDeltaPublic(
          100n,
          100n,
          0n,
          0n,
          1, // Compare.BalanceDirection.Decrease
        );
      expect(directionOk).to.equal(false);
      expect(observedDelta).to.equal(0n);
      expect(toleranceOk).to.equal(false);

      const res2 = await harness.checkBalanceDeltaPublic(100n, 101n, 1n, 0n, 1);
      expect(res2[0]).to.equal(false);
      expect(res2[1]).to.equal(0n);
      expect(res2[2]).to.equal(false);
    });

    it("Decrease: correct delta and tolerance within/at/above boundary", async function () {
      const { harness } = await deployHarness();
      // exact expected, zero tolerance
      let res = await harness.checkBalanceDeltaPublic(200n, 150n, 50n, 0n, 1);
      expect(res[0]).to.equal(true);
      expect(res[1]).to.equal(50n);
      expect(res[2]).to.equal(true);

      // within tolerance (expected 49, tol 1)
      res = await harness.checkBalanceDeltaPublic(200n, 150n, 49n, 1n, 1);
      expect(res[2]).to.equal(true);

      // at boundary (expected 51, tol 1)
      res = await harness.checkBalanceDeltaPublic(200n, 150n, 51n, 1n, 1);
      expect(res[2]).to.equal(true);

      // above tolerance (expected 52, tol 1)
      res = await harness.checkBalanceDeltaPublic(200n, 150n, 52n, 1n, 1);
      expect(res[2]).to.equal(false);
    });

    it("handles extreme max uint256 delta for Increase", async function () {
      const { harness } = await deployHarness();
      const UINT_MAX = (1n << 256n) - 1n;
      const res = await harness.checkBalanceDeltaPublic(
        0n,
        UINT_MAX,
        UINT_MAX,
        0n,
        0,
      );
      expect(res[0]).to.equal(true);
      expect(res[1]).to.equal(UINT_MAX);
      expect(res[2]).to.equal(true);
    });

    it("handles extreme max uint256 delta for Decrease", async function () {
      const { harness } = await deployHarness();
      const UINT_MAX = (1n << 256n) - 1n;
      const res = await harness.checkBalanceDeltaPublic(
        UINT_MAX,
        0n,
        UINT_MAX,
        0n,
        1,
      );
      expect(res[0]).to.equal(true);
      expect(res[1]).to.equal(UINT_MAX);
      expect(res[2]).to.equal(true);
    });

    it("tolerance = max always passes when direction is satisfied", async function () {
      const { harness } = await deployHarness();
      const UINT_MAX = (1n << 256n) - 1n;
      let res = await harness.checkBalanceDeltaPublic(
        10n,
        20n,
        0n,
        UINT_MAX,
        0,
      );
      expect(res[2]).to.equal(true);
      res = await harness.checkBalanceDeltaPublic(
        20n,
        10n,
        UINT_MAX,
        UINT_MAX,
        1,
      );
      expect(res[2]).to.equal(true);
    });
  });
});
