import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployDLoopIncreaseLeverageMockFixture } from "./fixtures";

describe("DLoopIncreaseLeverageMock - Leftover Debt Token Handling", function () {
  it.skip("transfers leftover debt tokens to user and emits event", async function () {
    const {
      dloopMock,
      increaseLeverageMock,
      collateralToken,
      debtToken,
      user1,
    } = await loadFixture(deployDLoopIncreaseLeverageMockFixture);

    // Ensure mock transfer behavior is deterministic (100%)
    await dloopMock.setTransferPortionBps(1_000_000);

    // Reduce subsidy to mitigate overshoot
    const owner = (await ethers.getSigners())[0];
    await dloopMock.connect(owner).setMaxSubsidyBps(0);

    // Move leverage below target so we need to increase leverage
    const increasedPrice = ethers.parseUnits("1.002", 8); // 0.2% price increase
    await dloopMock.setMockPrice(
      await collateralToken.getAddress(),
      increasedPrice,
    );

    // Pre-fund periphery with 1 wei debt token to guarantee a leftover > 0 after operations
    await debtToken.mint(await increaseLeverageMock.getAddress(), 1n);

    // Provide a tiny additional collateral to satisfy supply-from-sender constraint in the mock
    const additionalCollateralFromUser = 1n;

    const beforeDebt = await debtToken.balanceOf(user1.address);

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
