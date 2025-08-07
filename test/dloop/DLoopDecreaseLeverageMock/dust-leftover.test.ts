import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  createImbalancedLeveragePosition,
  deployDLoopDecreaseLeverageFixture,
  testSetup,
} from "./fixture";

/**
 * Issue #324 Fix Verification - Dust Leftover
 * Tests the case where minimal (dust) leftover remains after user payout
 */
describe("DLoopDecreaseLeverageMock - Dust Leftover Case", function () {
  it("handles dust leftover (1 wei) correctly without reverting", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const {
      dloopCoreMock,
      decreaseLeverageMock,
      collateralToken,
      debtToken,
      user1,
    } = fixture;

    // Create imbalanced position that needs decrease leverage
    const depositAmount = ethers.parseEther("100");
    await createImbalancedLeveragePosition(fixture, user1, depositAmount);

    // Set very low minimum leftover threshold so even 1 wei gets transferred
    await decreaseLeverageMock.setMinLeftoverCollateralTokenAmount(
      await dloopCoreMock.getAddress(),
      await collateralToken.getAddress(),
      1n, // 1 wei threshold
    );

    // Record balances
    const userCollateralBefore = await collateralToken.balanceOf(user1.address);
    const coreCollateralBefore = await collateralToken.balanceOf(
      await dloopCoreMock.getAddress(),
    );

    // Execute decrease leverage
    const additionalDebtFromUser = ethers.parseEther("15");
    const minOutputCollateralTokenAmount = ethers.parseEther("0.5");

    await debtToken
      .connect(user1)
      .approve(await decreaseLeverageMock.getAddress(), additionalDebtFromUser);

    const tx = await decreaseLeverageMock
      .connect(user1)
      .decreaseLeverage(
        additionalDebtFromUser,
        minOutputCollateralTokenAmount,
        "0x",
        await dloopCoreMock.getAddress(),
      );

    const receipt = await tx.wait();

    // Verify balances
    const userCollateralAfter = await collateralToken.balanceOf(user1.address);
    const coreCollateralAfter = await collateralToken.balanceOf(
      await dloopCoreMock.getAddress(),
    );
    const peripheryCollateralAfter = await collateralToken.balanceOf(
      await decreaseLeverageMock.getAddress(),
    );

    // Assertions
    expect(userCollateralAfter).to.be.gt(
      userCollateralBefore,
      "User should receive collateral",
    );
    expect(peripheryCollateralAfter).to.equal(
      0n,
      "Periphery should have no balance",
    );

    // Check if dust was transferred to core (may or may not happen depending on final leftover amount)
    const coreGained = coreCollateralAfter - coreCollateralBefore;

    if (coreGained > 0n) {
      console.log(`Dust ${coreGained} wei transferred to core`);

      // Verify LeftoverCollateralTokensTransferred event was emitted
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

      expect(leftoverEvents).to.have.length(
        1,
        "One leftover transfer event should be emitted",
      );
    }

    console.log(
      "✅ Dust leftover case verified - transaction completed without revert",
    );
  });
});
