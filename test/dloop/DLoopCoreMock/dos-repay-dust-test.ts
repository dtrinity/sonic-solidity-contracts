import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { ONE_HUNDRED_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, testSetup } from "./fixture";

/**
 * This test demonstrates the griefing/DoS vector described in the audit report:
 * 1. A legitimate user opens a position and later wants to withdraw (redeem).
 * 2. An attacker manipulates the _effective_ amount that will be sent during the internal
 *    `_repayDebtToPool()` call so that the observed balance delta differs from the `amount`
 *    parameter by more than the tolerated 1-wei window.
 *
 * In the production setting the attacker achieves this by sending a tiny (e.g. 2-wei)
 * `repay()` directly to the Aave pool on behalf of the vault.  In the mock environment we
 * achieve the same post-condition by abusing the unprotected `setTransferPortionBps()`
 * helper that adjusts how much of the requested `amount` is actually transferred.
 * Any value that creates a >1 wei delta will trigger the revert.  We compute a value that
 * leaves exactly a 2-wei difference for clarity.
 */
describe("DLoopCoreMock – DoS via dust repay", function () {
  it("reverts user redeem when observed repay delta exceeds 1 wei", async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    const { dloopMock, collateralToken, debtToken, accounts } = fixture;
    const user = accounts[1]; // honest user
    const attacker = accounts[2]; // malicious actor
    const vaultAddress = await dloopMock.getAddress();

    // 1. User opens a position by depositing collateral.
    const initialDeposit = ethers.parseEther("100");
    await collateralToken.connect(user).approve(vaultAddress, initialDeposit);
    await dloopMock.connect(user).deposit(initialDeposit, user.address);

    // 2. Prepare the user for a full redeem later (needs debt tokens for repayment).
    const userShares = await dloopMock.balanceOf(user.address);
    const expectedAssets = await dloopMock.previewRedeem(userShares);
    const repayAmount = await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      await collateralToken.getAddress(),
      await debtToken.getAddress(),
      expectedAssets,
      await dloopMock.getCurrentLeverageBps()
    );

    // debt tokens were already minted & approved in fixture.testSetup()
    expect(await debtToken.balanceOf(user.address)).to.be.gte(repayAmount);

    // 3. Attacker performs the griefing action – here modelled by lowering the
    //    transferPortionBps so that only (repayAmount - 2) wei will actually be
    //    moved when the vault later calls `_repayDebtToPool`.
    //
    //    transferPortionBps = ((repayAmount - 2) / repayAmount) * 100%
    const diff = 2n; // 2 wei dust
    const portionBps =
      ((repayAmount - diff) * BigInt(ONE_HUNDRED_PERCENT_BPS)) / repayAmount;
    await dloopMock.connect(attacker).setTransferPortionBps(portionBps);

    // 4. User attempts to redeem their entire position.  The internal repay will now
    //    observe a 2-wei mismatch and revert with `UnexpectedRepayAmountToPool`.
    await expect(
      dloopMock.connect(user).redeem(userShares, user.address, user.address)
    ).to.be.reverted;
  });
});
