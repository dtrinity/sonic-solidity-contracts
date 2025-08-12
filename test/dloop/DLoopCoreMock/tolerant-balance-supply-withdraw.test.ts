import { expect } from "chai";

import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, testSetup } from "./fixture";

/**
 * Additional tolerance tests for _supplyToPool and _withdrawFromPool wrapper functions
 * introduced in branch chi/fix_hats_85.  Mirrors the borrow / repay tolerance
 * checks already present in tolerant-balance-test.ts.
 */
describe("DLoopCoreMock – tolerant balance differences (supply / withdraw)", function () {
  // Remove helper and compute vault inside each test
  describe("_supplyToPool wrapper", function () {
    it("allows 1 wei rounding difference on supply", async function () {
      const fixture = await deployDLoopMockFixture();
      await testSetup(fixture);

      const { dloopMock, collateralToken, mockPool } = fixture;
      const vault = await fixture.dloopMock.getAddress();

      // Mint 100 wei collateral to the vault so it can supply to the pool
      await collateralToken.mint(vault, 100n);

      const poolBalBefore = await collateralToken.balanceOf(mockPool.address);

      // -------- CASE 1: diff = 1 wei -------------
      // Only 99/100 gets transferred (difference of 1 wei)
      await dloopMock.setTransferPortionBps(99 * ONE_PERCENT_BPS); // 99.00%

      await expect(
        dloopMock.testSupplyToPool(
          await collateralToken.getAddress(),
          100n,
          vault,
        ),
      ).to.not.be.reverted;

      const poolBalAfterCase1 = await collateralToken.balanceOf(
        mockPool.address,
      );
      expect(poolBalAfterCase1 - poolBalBefore).to.equal(99n);
      expect(await collateralToken.balanceOf(vault)).to.equal(1n);

      // -------- CASE 2: diff > 1 wei -------------
      // Mint fresh collateral to vault to reset state
      await collateralToken.mint(vault, 100n);

      // Set transfer portion so only 98/100 is transferred (2-wei diff)
      await dloopMock.setTransferPortionBps(98 * ONE_PERCENT_BPS); // 98.00%

      await expect(
        dloopMock.testSupplyToPool(
          await collateralToken.getAddress(),
          100n,
          vault,
        ),
      ).to.be.reverted;
    });
  });

  describe("_withdrawFromPool wrapper", function () {
    it("allows 1 wei rounding difference on withdraw", async function () {
      const fixture = await deployDLoopMockFixture();
      await testSetup(fixture);

      const { dloopMock, collateralToken, mockPool } = fixture;
      const vault = await fixture.dloopMock.getAddress();

      // --- Prepare collateral inside the pool ---
      // Mint 200 tokens to vault and supply full 100 twice to ensure pool has enough balance.
      await collateralToken.mint(vault, 200n);
      await dloopMock.setTransferPortionBps(ONE_PERCENT_BPS * 100); // 100%
      await dloopMock.testSupplyToPoolImplementation(
        await collateralToken.getAddress(),
        100n,
        vault,
      );
      await dloopMock.testSupplyToPoolImplementation(
        await collateralToken.getAddress(),
        100n,
        vault,
      );

      const poolBalBefore = await collateralToken.balanceOf(mockPool.address);

      // -------- CASE 1: diff = 1 wei -------------
      // Withdraw 100 but receive 99 (1-wei diff)
      await dloopMock.setTransferPortionBps(99 * ONE_PERCENT_BPS); // 99.00%
      await expect(
        dloopMock.testWithdrawFromPool(
          await collateralToken.getAddress(),
          100n,
          vault,
        ),
      ).to.not.be.reverted;

      const poolBalAfterCase1 = await collateralToken.balanceOf(
        mockPool.address,
      );
      expect(poolBalBefore - poolBalAfterCase1).to.equal(99n);
      expect(await collateralToken.balanceOf(vault)).to.equal(99n); // vault got 99 back

      // -------- CASE 2: diff > 1 wei -------------
      // Withdraw again with 2-wei diff; expect revert
      await dloopMock.setTransferPortionBps(98 * ONE_PERCENT_BPS); // 98.00%
      await expect(
        dloopMock.testWithdrawFromPool(
          await collateralToken.getAddress(),
          100n,
          vault,
        ),
      ).to.be.reverted;
    });
  });
});
