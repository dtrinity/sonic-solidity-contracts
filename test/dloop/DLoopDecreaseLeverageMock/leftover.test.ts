import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createImbalancedLeveragePosition, deployDLoopDecreaseLeverageFixture, testSetup } from "./fixture";

describe("DLoopDecreaseLeverageMock - Leftover Collateral Token Handling", function () {
  it("transfers leftover collateral tokens to user and emits event", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const { dloopCoreMock, quoter, decreaseLeverageMock, collateralToken, debtToken, user1 } = fixture;

    // Create imbalanced position (above target leverage)
    const depositAmount = ethers.parseEther("100");
    const { leverageAfter } = await createImbalancedLeveragePosition(fixture, user1, depositAmount);

    // Check if leverage is actually above upper bound
    const upperBound = await dloopCoreMock.upperBoundTargetLeverageBps();

    // Make sure the scenario is created correctly
    expect(leverageAfter).to.be.gt(upperBound);

    // Pre-fund periphery with some debt tokens for the operation
    await debtToken.mint(await decreaseLeverageMock.getAddress(), ethers.parseEther("10"));

    // Pre-fund periphery with 1 wei of collateral to guarantee leftover after transfer
    await collateralToken.mint(await decreaseLeverageMock.getAddress(), 1n);

    const collateralTokenBalanceBefore = await collateralToken.balanceOf(await decreaseLeverageMock.getAddress());
    const debtTokenBalanceBefore = await debtToken.balanceOf(await decreaseLeverageMock.getAddress());

    const before = await collateralToken.balanceOf(user1.address);

    // Ensure transferPortionBps is 100% for deterministic transfer behavior
    await dloopCoreMock.setTransferPortionBps(1_000_000);

    // Ensure the core holds enough debt tokens to perform repay (mock uses transfer from core)
    // Note: quoteRebalanceAmountToReachTargetLeverage is now in DLoopQuoter contract
    // For this test, we'll use a fixed amount for testing leftover functionality
    const [fullRequiredDebtAmount, , direction] = await quoter.quoteRebalanceAmountToReachTargetLeverage(await dloopCoreMock.getAddress());

    const requiredDebtAmount = (fullRequiredDebtAmount + 1n) / 2n;
    expect(direction).to.equal(-1n);
    await debtToken.mint(await dloopCoreMock.getAddress(), requiredDebtAmount);

    // The operation should succeed
    const tx = await decreaseLeverageMock.connect(user1).decreaseLeverage(requiredDebtAmount, "0x", await dloopCoreMock.getAddress());
    const receipt = await tx.wait();

    // Find event
    const leftoverEvents = receipt!.logs.filter((log) => {
      const parsed = decreaseLeverageMock.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.name === "LeftoverCollateralTokensTransferred";
    });

    expect(leftoverEvents.length).to.be.greaterThan(0);

    const parsed = decreaseLeverageMock.interface.parseLog({
      topics: leftoverEvents[0].topics,
      data: leftoverEvents[0].data,
    });

    expect(parsed).to.not.be.null;
    expect(parsed?.args[0]).to.equal(await collateralToken.getAddress());
    expect(parsed?.args[2]).to.equal(user1.address);
    expect(parsed?.args[1]).to.be.gte(1n);

    const after = await collateralToken.balanceOf(user1.address);

    expect(after).to.be.gte(before);

    // Make sure periphery has no leftovers, means there is no difference in the balance before and after
    const collateralTokenBalanceAfter = await collateralToken.balanceOf(await decreaseLeverageMock.getAddress());
    const debtTokenBalanceAfter = await debtToken.balanceOf(await decreaseLeverageMock.getAddress());
    expect(collateralTokenBalanceAfter).to.be.equal(collateralTokenBalanceBefore);
    expect(debtTokenBalanceAfter).to.be.equal(debtTokenBalanceBefore);
  });
});
