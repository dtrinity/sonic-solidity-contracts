import { expect } from "chai";

import { deployDLoopMockFixture, testSetup } from "./fixture";

describe("DLoopCoreMock – tolerant balance differences", function () {
  it("allows 1 wei rounding difference on repay", async function () {
    const fixture = await deployDLoopMockFixture();
    await testSetup(fixture);

    const { dloopMock, debtToken, mockPool } = fixture;
    const vault = await dloopMock.getAddress();

    // First create a debt of 100 wei so that a subsequent repay is meaningful
    await dloopMock.testBorrowFromPool(await debtToken.getAddress(), 100n, vault);

    const poolBalBefore = await debtToken.balanceOf(mockPool.address);

    // -------- CASE 1: diff = 1 wei -------------
    // Set transferPortionBps so that only 99/100 is actually transferred (difference of 1 wei)
    await dloopMock.setTransferPortionBps(990000); // 99.00%

    // Should not revert when the observed diff is within tolerance (1 wei)
    await expect(dloopMock.testRepayDebtToPool(await debtToken.getAddress(), 100n, vault)).to.not.be.reverted;

    // Ensure pool received 99 wei (difference) and vault kept the dust
    const poolBalAfterFirst = await debtToken.balanceOf(mockPool.address);
    expect(poolBalAfterFirst - poolBalBefore).to.equal(99n);
    expect(await debtToken.balanceOf(vault)).to.equal(1n);

    // -------- CASE 2: diff > 1 wei -------------
    // Borrow again to restore debt to 100 wei
    await dloopMock.testBorrowFromPool(await debtToken.getAddress(), 100n, vault);
    // Set transferPortionBps to create a 2-wei difference (98/100)
    await dloopMock.setTransferPortionBps(980000); // 98.00%

    await expect(dloopMock.testRepayDebtToPool(await debtToken.getAddress(), 100n, vault)).to.be.reverted;
  });

  it("allows 1 wei rounding difference on borrow", async function () {
    const fixture = await deployDLoopMockFixture();
    await testSetup(fixture);

    const { dloopMock, debtToken, mockPool } = fixture;
    const vault = await dloopMock.getAddress();

    const poolBalBefore = await debtToken.balanceOf(mockPool.address);

    // -------- CASE 1: diff = 1 wei -------------
    await dloopMock.setTransferPortionBps(990000); // 99.00%

    await expect(dloopMock.testBorrowFromPool(await debtToken.getAddress(), 100n, vault)).to.not.be.reverted;

    const poolBalAfterFirst = await debtToken.balanceOf(mockPool.address);
    expect(poolBalBefore - poolBalAfterFirst).to.equal(99n);
    expect(await debtToken.balanceOf(vault)).to.equal(99n);

    // -------- CASE 2: diff > 1 wei -------------
    await dloopMock.setTransferPortionBps(980000); // 98.00%

    await expect(dloopMock.testBorrowFromPool(await debtToken.getAddress(), 100n, vault)).to.be.reverted;
  });
});
