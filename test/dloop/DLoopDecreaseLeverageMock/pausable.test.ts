import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createImbalancedLeveragePosition, deployDLoopDecreaseLeverageFixture, testSetup } from "./fixture";

describe("DLoopDecreaseLeverageMock - Pausable", function () {
  it("prevents leverage reduction while paused and allows it after unpausing", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const { dloopCoreMock, quoter, decreaseLeverageMock, deployer, user1 } = fixture;

    const depositAmount = ethers.parseEther("100");
    await createImbalancedLeveragePosition(fixture, user1, depositAmount);

    const [requiredDebtAmount, , direction] = await quoter.quoteRebalanceAmountToReachTargetLeverage(await dloopCoreMock.getAddress());
    expect(direction).to.equal(-1);
    expect(requiredDebtAmount).to.be.gt(0n);

    const leverageBefore = await dloopCoreMock.getCurrentLeverageBps();

    const pauserRole = await decreaseLeverageMock.PAUSER_ROLE();

    await expect(decreaseLeverageMock.connect(user1).pause())
      .to.be.revertedWithCustomError(decreaseLeverageMock, "AccessControlUnauthorizedAccount")
      .withArgs(user1.address, pauserRole);

    await decreaseLeverageMock.connect(deployer).pause();
    expect(await decreaseLeverageMock.paused()).to.equal(true);

    await expect(
      decreaseLeverageMock.connect(user1).decreaseLeverage(requiredDebtAmount, "0x", await dloopCoreMock.getAddress()),
    ).to.be.revertedWithCustomError(decreaseLeverageMock, "EnforcedPause");

    await decreaseLeverageMock.connect(deployer).unpause();
    expect(await decreaseLeverageMock.paused()).to.equal(false);

    await decreaseLeverageMock.connect(user1).decreaseLeverage(requiredDebtAmount, "0x", await dloopCoreMock.getAddress());

    const leverageAfter = await dloopCoreMock.getCurrentLeverageBps();
    expect(leverageAfter).to.be.lt(leverageBefore);
  });
});
