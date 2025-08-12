import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployDLoopIncreaseLeverageMockFixture } from "./fixtures";

/**
 * This test verifies that the double-counting bug reported in
 * https://github.com/hats-finance/dTRINITY-0xee5c6f15e8d0b55a5eff84bb66beeee0e6140ffe/issues/192
 * **has been fixed**.
 *
 * Historically the helper double-counted `additionalCollateralFromUser`,
 * thought it had 2× the real balance, skipped the flash-loan path and
 * eventually reverted.  After the fix the helper correctly recognises the
 * amount of collateral at its disposal, takes a flash loan for the shortfall
 * and the transaction succeeds.
 */
describe("DLoopIncreaseLeverageBase – double-counting collateral bug", function () {
  it("Should successfully increase leverage with a flash loan when user supplies exactly the required collateral", async function () {
    const {
      dloopMock,
      increaseLeverageMock,
      collateralToken,
      user1,
      debtToken,
    } = await loadFixture(deployDLoopIncreaseLeverageMockFixture);

    // 1️⃣  Move leverage below the target by increasing collateral price
    const increasedPrice = ethers.parseUnits("1.2", 8); // 20% price increase
    await dloopMock.setMockPrice(
      await collateralToken.getAddress(),
      increasedPrice,
    );

    // 2️⃣  Query how much collateral is actually needed to get back to target
    const [requiredCollateralAmount, direction] =
      await dloopMock.getRebalanceAmountToReachTargetLeverage(true);
    expect(direction).to.equal(1); // We need to increase leverage
    expect(requiredCollateralAmount).to.be.gt(0n);

    /*
     * 3️⃣  Provide *exactly* that amount as user input.
     *     The helper should recognise it still lacks collateral and therefore
     *     take a flash-loan for the shortfall.
     */
    const additionalCollateralFromUser = requiredCollateralAmount;

    // Approve the helper to pull the collateral from the user
    await collateralToken
      .connect(user1)
      .approve(
        await increaseLeverageMock.getAddress(),
        additionalCollateralFromUser,
      );

    // 4️⃣  Capture state before the leverage adjustment
    const leverageBefore = await dloopMock.getCurrentLeverageBps();
    const userDebtTokenBalanceBefore = await debtToken.balanceOf(user1.address);

    // 5️⃣  The call should now succeed (flash-loan branch is taken)
    await expect(
      increaseLeverageMock.connect(user1).increaseLeverage(
        additionalCollateralFromUser,
        0, // minOutputDebtTokenAmount – no slippage protection in this test
        "0x", // swap data (ignored by SimpleDEXMock)
        dloopMock,
      ),
    ).not.to.be.reverted;

    // 6️⃣  Leverage must have increased compared to the pre-call state
    const leverageAfter = await dloopMock.getCurrentLeverageBps();
    expect(leverageAfter).to.be.gt(leverageBefore);

    // 7️⃣  User should have received debt tokens from the operation
    const userDebtTokenBalanceAfter = await debtToken.balanceOf(user1.address);
    expect(userDebtTokenBalanceAfter).to.be.gt(userDebtTokenBalanceBefore);
  });
});
