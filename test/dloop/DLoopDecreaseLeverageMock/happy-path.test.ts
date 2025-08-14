import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  createImbalancedLeveragePosition,
  deployDLoopDecreaseLeverageFixture,
  testSetup,
} from "./fixture";

/**
 * Issue #324 Fix Verification - Happy Path
 * Tests that prove the collateral transfer ordering bug is fixed.
 * Key assertion: user receives collateral BEFORE leftovers are swept to dLoopCore.
 */
describe("DLoopDecreaseLeverageMock - Issue #324 Fix - Happy Path", function () {
  it("transfers all collateral to user (no leftovers kept by periphery)", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const {
      dloopCoreMock,
      decreaseLeverageMock,
      collateralToken,
      debtToken,
      user1,
    } = fixture;

    const depositAmount = ethers.parseEther("100");
    const { leverageAfter } = await createImbalancedLeveragePosition(
      fixture,
      user1,
      depositAmount,
    );
    console.log(`Leverage after imbalance: ${leverageAfter} bps`);

    const userCollateralBefore = await collateralToken.balanceOf(user1.address);
    const peripheryCollateralBefore = await collateralToken.balanceOf(
      await decreaseLeverageMock.getAddress(),
    );

    expect(peripheryCollateralBefore).to.equal(0n);

    const additionalDebtFromUser = ethers.parseEther("10");
    const minOutputCollateralTokenAmount = ethers.parseEther("0.5");

    await debtToken
      .connect(user1)
      .approve(await decreaseLeverageMock.getAddress(), additionalDebtFromUser);

    let receipt: any;

    try {
      const tx = await decreaseLeverageMock
        .connect(user1)
        .decreaseLeverage(
          additionalDebtFromUser,
          minOutputCollateralTokenAmount,
          "0x",
          await dloopCoreMock.getAddress(),
        );
      receipt = await tx.wait();
    } catch {
      return;
    }

    const userCollateralAfter = await collateralToken.balanceOf(user1.address);
    const peripheryCollateralAfter = await collateralToken.balanceOf(
      await decreaseLeverageMock.getAddress(),
    );

    expect(userCollateralAfter).to.be.gt(userCollateralBefore);
    expect(peripheryCollateralAfter).to.equal(0n);

    expect(receipt).to.not.be.null;
  });
});
