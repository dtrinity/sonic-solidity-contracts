import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployDLoopDepositorMockFixture, testSetup } from "./fixtures";

describe("DLoopDepositorMock - Pausable", function () {
  it("restricts deposit operations while paused and resumes after unpausing", async function () {
    const { dloopCoreMockFixture, dloopDepositorMockFixture } = await loadFixture(deployDLoopDepositorMockFixture);
    await testSetup(dloopCoreMockFixture, dloopDepositorMockFixture);

    const { dloopMock } = dloopCoreMockFixture;
    const { dLoopDepositorMock, deployer, user1 } = dloopDepositorMockFixture;

    const depositAmount = ethers.parseEther("10");
    const slippageBps = 500n; // 0.5% tolerance
    const minOutputShares = await dLoopDepositorMock.calculateMinOutputShares(depositAmount, slippageBps, dloopMock);

    const pauserRole = await dLoopDepositorMock.PAUSER_ROLE();

    await expect(dLoopDepositorMock.connect(user1).pause())
      .to.be.revertedWithCustomError(dLoopDepositorMock, "AccessControlUnauthorizedAccount")
      .withArgs(user1.address, pauserRole);

    await dLoopDepositorMock.connect(deployer).pause();
    expect(await dLoopDepositorMock.paused()).to.equal(true);

    await expect(
      dLoopDepositorMock.connect(user1).deposit(depositAmount, user1.address, minOutputShares, "0x", dloopMock),
    ).to.be.revertedWithCustomError(dLoopDepositorMock, "EnforcedPause");

    await dLoopDepositorMock.connect(deployer).unpause();
    expect(await dLoopDepositorMock.paused()).to.equal(false);

    const sharesBefore = await dloopMock.balanceOf(user1.address);

    await dLoopDepositorMock.connect(user1).deposit(depositAmount, user1.address, minOutputShares, "0x", dloopMock);

    const sharesAfter = await dloopMock.balanceOf(user1.address);
    expect(sharesAfter).to.be.gt(sharesBefore);
  });
});
