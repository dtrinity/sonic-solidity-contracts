import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createPosition, deployDLoopRedeemerMockFixture, testSetup } from "./fixtures";

describe("DLoopRedeemerMock - Pausable", function () {
  it("blocks redeem operations during pause and succeeds after unpausing", async function () {
    const { dloopCoreMockFixture, dloopRedeemerMockFixture } = await loadFixture(deployDLoopRedeemerMockFixture);
    await testSetup(dloopCoreMockFixture, dloopRedeemerMockFixture);

    const { dloopMock, collateralToken, debtToken } = dloopCoreMockFixture;
    const { dLoopRedeemerMock, dLoopDepositorMock, deployer, user1 } = dloopRedeemerMockFixture;

    const depositAmount = ethers.parseEther("50");
    const { shares } = await createPosition(dloopMock, collateralToken, debtToken, dLoopDepositorMock, user1, depositAmount);
    expect(shares).to.be.gt(0n);

    const slippageBps = 500n; // 0.5% slippage tolerance
    const minOutputCollateral = await dLoopRedeemerMock.calculateMinOutputCollateral(shares, slippageBps, dloopMock);

    const pauserRole = await dLoopRedeemerMock.PAUSER_ROLE();

    await expect(dLoopRedeemerMock.connect(user1).pause())
      .to.be.revertedWithCustomError(dLoopRedeemerMock, "AccessControlUnauthorizedAccount")
      .withArgs(user1.address, pauserRole);

    await dLoopRedeemerMock.connect(deployer).pause();
    expect(await dLoopRedeemerMock.paused()).to.equal(true);

    await expect(
      dLoopRedeemerMock.connect(user1).redeem(shares, user1.address, minOutputCollateral, "0x", dloopMock),
    ).to.be.revertedWithCustomError(dLoopRedeemerMock, "EnforcedPause");

    await dLoopRedeemerMock.connect(deployer).unpause();
    expect(await dLoopRedeemerMock.paused()).to.equal(false);

    const collateralBefore = await collateralToken.balanceOf(user1.address);
    const sharesBefore = await dloopMock.balanceOf(user1.address);

    await dLoopRedeemerMock.connect(user1).redeem(shares, user1.address, minOutputCollateral, "0x", dloopMock);

    const collateralAfter = await collateralToken.balanceOf(user1.address);
    const sharesAfter = await dloopMock.balanceOf(user1.address);

    expect(collateralAfter).to.be.gt(collateralBefore);
    expect(sharesBefore - sharesAfter).to.equal(shares);
  });
});
