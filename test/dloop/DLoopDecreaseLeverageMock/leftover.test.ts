import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  createImbalancedLeveragePosition,
  deployDLoopDecreaseLeverageFixture,
  testSetup,
} from "./fixture";

describe("DLoopDecreaseLeverageMock - Leftover Collateral Token Handling", function () {
  it("transfers leftover collateral tokens to user and emits event", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const {
      dloopCoreMock,
      decreaseLeverageMock,
      collateralToken,
      debtToken,
      user1,
    } = fixture;

    // Create imbalanced position (above target leverage)
    const depositAmount = ethers.parseEther("100");
    await createImbalancedLeveragePosition(fixture, user1, depositAmount);

    // Pre-fund periphery with some debt tokens for the operation
    await debtToken.mint(
      await decreaseLeverageMock.getAddress(),
      ethers.parseEther("10"),
    );

    // Pre-fund periphery with 1 wei of collateral to guarantee leftover after transfer
    await collateralToken.mint(await decreaseLeverageMock.getAddress(), 1n);

    const before = await collateralToken.balanceOf(user1.address);

    // Ensure transferPortionBps is 100% for deterministic transfer behavior
    await dloopCoreMock.setTransferPortionBps(1_000_000);

    // Ensure the core holds enough debt tokens to perform repay (mock uses transfer from core)
    const result =
      await dloopCoreMock.quoteRebalanceAmountToReachTargetLeverage();
    const requiredDebtAmount = result[0];
    const direction = result[2];
    expect(direction).to.equal(-1n);
    await debtToken.mint(await dloopCoreMock.getAddress(), requiredDebtAmount);

    const tx = await decreaseLeverageMock
      .connect(user1)
      .decreaseLeverage(
        requiredDebtAmount,
        "0x",
        await dloopCoreMock.getAddress(),
      );

    const receipt = await tx.wait();

    // Find event
    const leftoverEvents = receipt!.logs.filter((log) => {
      try {
        const parsed = decreaseLeverageMock.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsed?.name === "LeftoverCollateralTokensTransferred";
      } catch {
        return false;
      }
    });

    expect(leftoverEvents.length).to.be.greaterThan(0);

    const parsed = decreaseLeverageMock.interface.parseLog({
      topics: leftoverEvents[0].topics,
      data: leftoverEvents[0].data,
    });

    expect(parsed).to.not.be.null;

    if (parsed) {
      expect(parsed.args[0]).to.equal(await collateralToken.getAddress());
      expect(parsed.args[2]).to.equal(user1.address);
      expect(parsed.args[1]).to.be.gte(1n);
    }

    const after = await collateralToken.balanceOf(user1.address);

    expect(after).to.be.gte(before);
  });
});
