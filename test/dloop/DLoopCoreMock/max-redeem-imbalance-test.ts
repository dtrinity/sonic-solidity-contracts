import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock } from "../../../typechain-types";
import { deployDLoopMockFixture, TARGET_LEVERAGE_BPS, testSetup, UPPER_BOUND_BPS } from "./fixture";

/**
 * This test ensures that after the vault's leverage drifts above the configured
 * upper bound, `maxRedeem` (as well as `maxWithdraw`) is capped at zero, thus
 * preventing users from redeeming until the position is re-balanced.
 */

describe("DLoopCoreMock.maxRedeem: leverage guard", function () {
  /**
   * Deploys a mock dLoop, seeds a healthy position, then pushes leverage above the upper bound.
   *
   * @returns Object containing the vault and deployer signer
   */
  async function deployAndImbalance(): Promise<{
    dloopMock: DLoopCoreMock;
    deployer: HardhatEthersSigner;
  }> {
    const fixture = await deployDLoopMockFixture();
    await testSetup(fixture);

    const { dloopMock, collateralToken, debtToken, deployer } = fixture;

    // ---------------- Seed a healthy position (target leverage ~3x) ----------------
    const seedCollateral = ethers.parseEther("100");
    await collateralToken.connect(deployer).mint(deployer.address, seedCollateral);
    await collateralToken.connect(deployer).approve(await dloopMock.getAddress(), seedCollateral);
    await dloopMock.connect(deployer).deposit(seedCollateral, deployer.address);

    // Confirm leverage is inside bounds and maxRedeem > 0 initially
    const leverageBefore = await dloopMock.getCurrentLeverageBps();
    expect(leverageBefore).to.be.closeTo(TARGET_LEVERAGE_BPS, 10000n);
    expect(await dloopMock.maxRedeem(deployer.address)).to.be.gt(0n);

    // ---------------- Artificially increase leverage above upper bound --------------
    // Increase debt token price by 2x so effective debt value in base doubles
    const debtAddr = await debtToken.getAddress();
    await dloopMock.setMockPrice(debtAddr, 140000000); // 1.4 in 8 decimals

    const leverageAfter = await dloopMock.getCurrentLeverageBps();
    expect(leverageAfter).to.be.gt(UPPER_BOUND_BPS);

    return { dloopMock, deployer };
  }

  it("returns 0 when leverage exceeds the upper bound", async function () {
    const { dloopMock, deployer } = await loadFixture(deployAndImbalance);
    const maxRedeem = await dloopMock.maxRedeem(deployer.address);
    expect(maxRedeem).to.equal(0n);
  });
});
