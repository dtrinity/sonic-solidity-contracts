import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createLeverageIncreaseScenario, deployDLoopIncreaseLeverageMockFixture } from "./fixtures";

describe("DLoopIncreaseLeverageMock - Pausable", function () {
  it("halts leverage increases while paused and restores functionality after unpausing", async function () {
    const fixture = await loadFixture(deployDLoopIncreaseLeverageMockFixture);

    const { dloopMock, quoter, increaseLeverageMock, deployer, user1, accounts } = fixture;

    const depositAmount = ethers.parseEther("100");
    await createLeverageIncreaseScenario(fixture, user1, depositAmount);

    const [requiredCollateralAmount, , direction] = await quoter.quoteRebalanceAmountToReachTargetLeverage(await dloopMock.getAddress());
    expect(direction).to.equal(1);
    expect(requiredCollateralAmount).to.be.gt(0n);

    const rebalancer = accounts[5];
    const leverageBefore = await dloopMock.getCurrentLeverageBps();

    const pauserRole = await increaseLeverageMock.PAUSER_ROLE();

    await expect(increaseLeverageMock.connect(rebalancer).pause())
      .to.be.revertedWithCustomError(increaseLeverageMock, "AccessControlUnauthorizedAccount")
      .withArgs(rebalancer.address, pauserRole);

    await increaseLeverageMock.connect(deployer).pause();
    expect(await increaseLeverageMock.paused()).to.equal(true);

    await expect(
      increaseLeverageMock.connect(rebalancer).increaseLeverage(requiredCollateralAmount, "0x", await dloopMock.getAddress()),
    ).to.be.revertedWithCustomError(increaseLeverageMock, "EnforcedPause");

    await increaseLeverageMock.connect(deployer).unpause();
    expect(await increaseLeverageMock.paused()).to.equal(false);

    await increaseLeverageMock.connect(rebalancer).increaseLeverage(requiredCollateralAmount, "0x", await dloopMock.getAddress());

    const leverageAfter = await dloopMock.getCurrentLeverageBps();
    expect(leverageAfter).to.be.gt(leverageBefore);
  });
});
