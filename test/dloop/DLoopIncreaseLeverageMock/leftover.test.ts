import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployDLoopIncreaseLeverageMockFixture } from "./fixtures";

describe("DLoopIncreaseLeverageMock - Leftover Debt Token Handling", function () {
  it("transfers leftover debt tokens to user and emits event", async function () {
    const {
      dloopMock,
      increaseLeverageMock,
      collateralToken,
      debtToken,
      user1,
    } = await loadFixture(deployDLoopIncreaseLeverageMockFixture);

    // Ensure mock transfer behavior is deterministic (100%)
    await dloopMock.setTransferPortionBps(1_000_000);

    // Reduce subsidy to mitigate overshoot and make leverage math stable
    const owner = (await ethers.getSigners())[0];
    await dloopMock.connect(owner).setMaxSubsidyBps(0);
    // Set transfer portion to 100% to match expected supply checks in core wrapper
    await dloopMock.setTransferPortionBps(1_000_000);

    // Keep price unchanged to minimize required collateral and avoid overshoot
    const currentPrice = await dloopMock.getMockPrice(
      await collateralToken.getAddress(),
    );
    await dloopMock.setMockPrice(
      await collateralToken.getAddress(),
      currentPrice,
    );

    // Pre-fund periphery with 1 wei debt token to guarantee a leftover > 0 after operations
    await debtToken.mint(await increaseLeverageMock.getAddress(), 1n);

    // Compute exact required collateral to avoid flash loan path and prevent overshoot
    const result = await dloopMock.getAmountToReachTargetLeverage(true);
    const requiredCollateralAmount: bigint = result[0];
    const direction: bigint = result[1];
    expect(direction).to.equal(1n);

    // Fund user with enough collateral (already funded in fixture) and set additionalCollateralFromUser
    const additionalCollateralFromUser = requiredCollateralAmount;

    // Pre-fund core with a cushion of collateral to satisfy onBehalfOf == this supply path
    await collateralToken.mint(
      await dloopMock.getAddress(),
      ethers.parseEther("1000"),
    );

    const beforeDebt = await debtToken.balanceOf(user1.address);
    // Make required change extremely small by setting maxSubsidy to zero and leaving price unchanged
    await dloopMock.setTransferPortionBps(1_000_000);

    const tx = await increaseLeverageMock
      .connect(user1)
      .increaseLeverage(additionalCollateralFromUser, 0, "0x", dloopMock);

    const receipt = await tx.wait();

    // Parse leftover event
    const leftoverEvents = receipt!.logs.filter((log) => {
      try {
        const parsed = increaseLeverageMock.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsed?.name === "LeftoverDebtTokensTransferred";
      } catch {
        return false;
      }
    });

    expect(leftoverEvents.length).to.be.greaterThan(0);

    const parsed = increaseLeverageMock.interface.parseLog({
      topics: leftoverEvents[0].topics,
      data: leftoverEvents[0].data,
    });

    expect(parsed).to.not.be.null;

    if (parsed) {
      expect(parsed.args[0]).to.equal(await debtToken.getAddress());
      expect(parsed.args[2]).to.equal(user1.address);
      expect(parsed.args[1]).to.be.gte(1n);
    }

    const afterDebt = await debtToken.balanceOf(user1.address);

    expect(afterDebt).to.be.gte(beforeDebt);
  });
});
