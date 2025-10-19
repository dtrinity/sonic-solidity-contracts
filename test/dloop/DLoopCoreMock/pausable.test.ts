import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

import { deployDLoopMockFixture, MAX_SUBSIDY_BPS, testSetup } from "./fixture";

describe("DLoopCoreMock - Pausable", function () {
  /**
   * Loads the shared core fixture and applies the standard test setup.
   */
  async function loadCoreFixture(): Promise<DLoopCoreMockFixture> {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);
    return fixture;
  }

  type DLoopCoreMockFixture = Awaited<ReturnType<typeof deployDLoopMockFixture>>;

  it("allows only accounts with pauser role to toggle pause state", async function () {
    const { dloopMock, deployer, user1 } = await loadCoreFixture();

    expect(await dloopMock.paused()).to.equal(false);

    const pauserRole = await dloopMock.PAUSER_ROLE();

    await expect(dloopMock.connect(user1).pause())
      .to.be.revertedWithCustomError(dloopMock, "AccessControlUnauthorizedAccount")
      .withArgs(user1.address, pauserRole);

    await dloopMock.connect(deployer).pause();
    expect(await dloopMock.paused()).to.equal(true);

    await expect(dloopMock.connect(user1).unpause())
      .to.be.revertedWithCustomError(dloopMock, "AccessControlUnauthorizedAccount")
      .withArgs(user1.address, pauserRole);

    await dloopMock.connect(deployer).unpause();
    expect(await dloopMock.paused()).to.equal(false);
  });

  it("blocks state changing functions while paused", async function () {
    const { dloopMock, deployer } = await loadCoreFixture();

    const initialMaxSubsidyBps = await dloopMock.maxSubsidyBps();
    expect(initialMaxSubsidyBps).to.equal(BigInt(MAX_SUBSIDY_BPS));

    await dloopMock.connect(deployer).pause();

    const updatedValue = BigInt(MAX_SUBSIDY_BPS) + 100n;
    await expect(dloopMock.connect(deployer).setMaxSubsidyBps(updatedValue)).to.be.revertedWithCustomError(dloopMock, "EnforcedPause");

    await dloopMock.connect(deployer).unpause();

    await dloopMock.connect(deployer).setMaxSubsidyBps(updatedValue);
    expect(await dloopMock.maxSubsidyBps()).to.equal(updatedValue);
  });
});
