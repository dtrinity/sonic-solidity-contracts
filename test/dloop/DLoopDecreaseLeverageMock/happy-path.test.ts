import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createImbalancedLeveragePosition, deployDLoopDecreaseLeverageFixture, testSetup } from "./fixture";

/**
 * Issue #324 Fix Verification - Happy Path
 * Tests that prove the collateral transfer ordering bug is fixed.
 * Key assertion: user receives collateral BEFORE leftovers are swept to dLoopCore.
 */
describe("DLoopDecreaseLeverageMock - Issue #324 Fix - Happy Path", function () {
  it("transfers all collateral to user (no leftovers kept by periphery)", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const { dloopCoreMock, quoter, decreaseLeverageMock, collateralToken, debtToken, user1 } = fixture;

    const depositAmount = ethers.parseEther("100");
    const { leverageAfter } = await createImbalancedLeveragePosition(fixture, user1, depositAmount);
    console.log(`Leverage after imbalance: ${leverageAfter} bps`);

    const userCollateralBefore = await collateralToken.balanceOf(user1.address);
    const peripheryCollateralBefore = await collateralToken.balanceOf(await decreaseLeverageMock.getAddress());

    expect(peripheryCollateralBefore).to.equal(0n);

    // Pre-fund periphery with some debt tokens for the operation
    await debtToken.mint(await decreaseLeverageMock.getAddress(), ethers.parseEther("10"));

    // Note: quoteRebalanceAmountToReachTargetLeverage is now in DLoopQuoter contract
    // For this test, we'll use a fixed amount
    const [fullRequiredDebtAmount, , direction] = await quoter.quoteRebalanceAmountToReachTargetLeverage(await dloopCoreMock.getAddress());

    // Only use 1/2 of the required debt amount
    const requiredDebtAmount = (fullRequiredDebtAmount + 1n) / 2n;

    expect(direction).to.equal(-1);
    expect(requiredDebtAmount).to.be.gt(0n);
    const tx = await decreaseLeverageMock.connect(user1).decreaseLeverage(requiredDebtAmount, "0x", await dloopCoreMock.getAddress());
    const receipt = await tx.wait();

    const userCollateralAfter = await collateralToken.balanceOf(user1.address);
    const peripheryCollateralAfter = await collateralToken.balanceOf(await decreaseLeverageMock.getAddress());

    expect(userCollateralAfter).to.be.gt(userCollateralBefore);
    expect(peripheryCollateralAfter).to.equal(0n);

    expect(receipt).to.not.be.null;

    // Make sure periphery has no leftovers
    const leftovers = await collateralToken.balanceOf(await decreaseLeverageMock.getAddress());
    expect(leftovers).to.equal(0n);
  });
});
