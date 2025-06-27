import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployDLoopIncreaseLeverageMockFixture } from "./fixtures";

/**
 * This test demonstrates the double-counting bug reported in
 * https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/192
 *
 * The bug makes the periphery helper believe it has twice as much collateral
 * as it actually owns, causing it to skip the flash-loan branch and later
 * revert when the core vault tries to supply collateral it never received.
 *
 * REPRODUCTION:
 * 1. User provides exactly `requiredCollateralAmount` as input
 * 2. Helper calculates: `collateralFromUser = additionalCollateralFromUser + balanceOf(this)`
 * 3. Since the user's transfer is already included in balanceOf(this), this double-counts
 * 4. Helper thinks it has 2×requiredCollateralAmount, skips flash-loan path
 * 5. Core vault tries to supply requiredCollateralAmount but helper only has requiredCollateralAmount
 * 6. Transaction reverts with ERC20InsufficientBalance
 *
 * AFTER FIX:
 * This test should fail because the helper will correctly use flash loans
 * when it doesn't have enough collateral, preventing the insufficient balance error.
 */
describe("DLoopIncreaseLeverageBase – double-counting collateral bug", function () {
  it("Should revert due to insufficient collateral in core after skipping flash-loan path", async function () {
    const { dloopMock, increaseLeverageMock, collateralToken, user1 } =
      await loadFixture(deployDLoopIncreaseLeverageMockFixture);

    // 1️⃣  Move leverage below the target by increasing collateral price
    const increasedPrice = ethers.parseUnits("1.2", 8); // 20% price increase
    await dloopMock.setMockPrice(
      await collateralToken.getAddress(),
      increasedPrice
    );

    // 2️⃣  Query how much collateral is actually needed to get back to target
    const [requiredCollateralAmount, direction] =
      await dloopMock.getAmountToReachTargetLeverage(true);
    expect(direction).to.equal(1); // We need to increase leverage
    expect(requiredCollateralAmount).to.be.gt(0n);

    /*
     * 3️⃣  Provide *exactly* that amount as user input.
     *     Because the helper adds the transferred amount to its own balance
     *     again, it will think it has 2×requiredCollateralAmount and will
     *     skip the flash-loan path.
     */
    const additionalCollateralFromUser = requiredCollateralAmount;

    // Approve the helper to pull the collateral from the user
    await collateralToken
      .connect(user1)
      .approve(
        await increaseLeverageMock.getAddress(),
        additionalCollateralFromUser
      );

    // 4️⃣  The call is expected to revert due to insufficient balance
    //     This proves the double-counting bug: the helper thinks it has
    //     2×requiredCollateralAmount but actually only has requiredCollateralAmount
    await expect(
      increaseLeverageMock.connect(user1).increaseLeverage(
        additionalCollateralFromUser,
        0, // minOutputDebtTokenAmount
        "0x", // swap data – not used because flash-loan branch is skipped
        dloopMock
      )
    ).to.be.revertedWithCustomError(
      collateralToken,
      "ERC20InsufficientBalance"
    );
  });
});
