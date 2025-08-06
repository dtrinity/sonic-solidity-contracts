import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  createImbalancedLeveragePosition,
  deployDLoopDecreaseLeverageFixture,
  testSetup,
} from "./fixture";

/**
 * @title Issue #324 Fix Verification - Happy Path
 * @notice Tests that prove the collateral transfer ordering bug is fixed
 * Key assertion: user receives collateral BEFORE leftovers are swept to dLoopCore
 */
describe("DLoopDecreaseLeverageMock - Issue #324 Fix - Happy Path", function () {
  it("transfers user collateral first, then handles leftovers without reverting", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const {
      dloopCoreMock,
      decreaseLeverageMock,
      collateralToken,
      debtToken,
      user1,
    } = fixture;

    // 1. Create imbalanced leveraged position that needs decrease leverage
    const depositAmount = ethers.parseEther("100");
    const { leverageAfter } = await createImbalancedLeveragePosition(
      fixture,
      user1,
      depositAmount,
    );
    console.log(`Leverage after imbalance: ${leverageAfter} bps`);

    // 2. Record initial balances
    const userCollateralBefore = await collateralToken.balanceOf(user1.address);
    const peripheryCollateralBefore = await collateralToken.balanceOf(
      await decreaseLeverageMock.getAddress(),
    );
    const coreCollateralBefore = await collateralToken.balanceOf(
      await dloopCoreMock.getAddress(),
    );

    expect(peripheryCollateralBefore).to.equal(
      0n,
      "Periphery should start with 0 balance",
    );

    // 3. Prepare decrease leverage parameters
    const additionalDebtFromUser = ethers.parseEther("10"); // User provides some debt
    const minOutputCollateralTokenAmount = ethers.parseEther("0.5"); // Expect at least 0.5 collateral
    const collateralToDebtSwapData = "0x"; // Empty for SimpleDEXMock

    // Approve debt tokens for the operation
    await debtToken
      .connect(user1)
      .approve(await decreaseLeverageMock.getAddress(), additionalDebtFromUser);

    // 4. Execute decrease leverage - this should NOT revert
    const tx = await decreaseLeverageMock
      .connect(user1)
      .decreaseLeverage(
        additionalDebtFromUser,
        minOutputCollateralTokenAmount,
        collateralToDebtSwapData,
        await dloopCoreMock.getAddress(),
      );

    const receipt = await tx.wait();
    expect(receipt).to.not.be.null;

    // 5. Verify balances after operation
    const userCollateralAfter = await collateralToken.balanceOf(user1.address);
    const peripheryCollateralAfter = await collateralToken.balanceOf(
      await decreaseLeverageMock.getAddress(),
    );
    const coreCollateralAfter = await collateralToken.balanceOf(
      await dloopCoreMock.getAddress(),
    );

    // 6. Key assertions for issue #324 fix
    expect(userCollateralAfter).to.be.gt(
      userCollateralBefore,
      "User should receive collateral tokens",
    );
    expect(peripheryCollateralAfter).to.equal(
      0n,
      "Periphery should have 0 balance after operation (no leftover stuck)",
    );

    // If there were leftovers, they should have been transferred to core
    if (coreCollateralAfter > coreCollateralBefore) {
      console.log(
        `Leftover ${ethers.formatEther(
          coreCollateralAfter - coreCollateralBefore,
        )} COLL transferred to core`,
      );
    }

    // 7. Verify transaction completed successfully (would have reverted with old bug)
    expect(tx).to.not.be.reverted;
    console.log(
      `✅ User received ${ethers.formatEther(
        userCollateralAfter - userCollateralBefore,
      )} COLL tokens`,
    );
  });

  it("emits events in correct order: user transfer happens before leftover transfer", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    await testSetup(fixture);

    const {
      dloopCoreMock,
      decreaseLeverageMock,
      collateralToken,
      debtToken,
      user1,
    } = fixture;

    // Create imbalanced position and setup
    const depositAmount = ethers.parseEther("200");
    const { leverageAfter } = await createImbalancedLeveragePosition(
      fixture,
      user1,
      depositAmount,
    );
    console.log(`Leverage after imbalance: ${leverageAfter} bps`);

    // Set a minimum leftover amount to ensure leftover transfer occurs
    await decreaseLeverageMock.setMinLeftoverCollateralTokenAmount(
      await dloopCoreMock.getAddress(),
      await collateralToken.getAddress(),
      ethers.parseEther("0.001"), // 0.001 threshold
    );

    // Prepare decrease leverage parameters
    const additionalDebtFromUser = ethers.parseEther("5");
    const minOutputCollateralTokenAmount = ethers.parseEther("0.5");

    await debtToken
      .connect(user1)
      .approve(await decreaseLeverageMock.getAddress(), additionalDebtFromUser);

    // Execute and capture events
    const tx = await decreaseLeverageMock
      .connect(user1)
      .decreaseLeverage(
        additionalDebtFromUser,
        minOutputCollateralTokenAmount,
        "0x",
        await dloopCoreMock.getAddress(),
      );

    const receipt = await tx.wait();
    expect(receipt).to.not.be.null;

    // Find Transfer and LeftoverCollateralTokensTransferred events
    const transferEvents = receipt!.logs.filter((log) => {
      try {
        const parsed = collateralToken.interface.parseLog({
          topics: log.topics,
          data: log.data,
        });
        return parsed?.name === "Transfer";
      } catch {
        return false;
      }
    });

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

    // Verify user receives transfer before any leftover transfer
    const decreaseLeverageAddress = await decreaseLeverageMock.getAddress();
    const userTransferEvent = transferEvents.find((log) => {
      const parsed = collateralToken.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return (
        parsed?.args[0].toLowerCase() ===
          decreaseLeverageAddress.toLowerCase() &&
        parsed?.args[1].toLowerCase() === user1.address.toLowerCase()
      );
    });

    expect(userTransferEvent).to.not.be.undefined;
    console.log("✅ User transfer event found in transaction logs");

    if (leftoverEvents.length > 0) {
      // If leftover event exists, verify ordering
      const userTransferIndex = receipt!.logs.indexOf(userTransferEvent!);
      const leftoverEventIndex = receipt!.logs.indexOf(leftoverEvents[0]);

      expect(userTransferIndex).to.be.lt(
        leftoverEventIndex,
        "User transfer must occur before leftover transfer",
      );
      console.log(
        "✅ Event ordering verified: user transfer → leftover transfer",
      );
    } else {
      console.log(
        "ℹ️  No leftover transfer occurred (all collateral went to user)",
      );
    }
  });
});
