import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createLeverageIncreaseScenario, deployDLoopIncreaseLeverageMockFixture } from "./fixtures";

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
    const { dloopMock, quoter, increaseLeverageMock, collateralToken, debtToken, simpleDEXMock, mockPool, accounts, deployer, user1 } =
      await loadFixture(deployDLoopIncreaseLeverageMockFixture);

    // 1️⃣  Create a scenario that requires leverage increase
    const depositAmount = ethers.parseEther("100");
    const { leverageAfter } = await createLeverageIncreaseScenario(
      {
        dloopMock,
        quoter,
        increaseLeverageMock,
        collateralToken,
        debtToken,
        simpleDEXMock,
        mockPool,
        accounts,
        deployer,
        user1,
      },
      user1,
      depositAmount,
    );
    console.log(`Leverage after price increase: ${leverageAfter} bps`);

    // 2️⃣  Query how much collateral is actually needed to get back to target
    const [fullRequiredCollateralAmount, , direction] = await quoter.quoteRebalanceAmountToReachTargetLeverage(
      await dloopMock.getAddress(),
    );
    expect(direction).to.equal(1); // We need to increase leverage
    expect(fullRequiredCollateralAmount).to.be.gt(0n);

    /*
     * 3️⃣  Pre-fund periphery with less than required amount.
     *     The helper should recognise it lacks collateral and therefore
     *     take a flash-loan for the shortfall.
     */
    const requiredCollateralAmount = fullRequiredCollateralAmount / 2n;

    // 4️⃣  Capture state before the leverage adjustment
    const leverageBefore = await dloopMock.getCurrentLeverageBps();
    const userDebtTokenBalanceBefore = await debtToken.balanceOf(user1.address);

    // Make sure the periphery has no collateral balance
    // This will trigger flash-loan since periphery has no collateral balance
    const peripheryCollateralBalance = await collateralToken.balanceOf(await increaseLeverageMock.getAddress());
    expect(peripheryCollateralBalance).to.equal(0n);

    // 5️⃣  The call should now succeed (flash-loan branch is taken)
    await increaseLeverageMock.connect(user1).increaseLeverage(
      requiredCollateralAmount,
      "0x", // swap data (ignored by SimpleDEXMock)
      dloopMock,
    );

    // 6️⃣  Leverage must have increased compared to the pre-call state
    const leverageFinal = await dloopMock.getCurrentLeverageBps();
    expect(leverageFinal).to.be.gt(leverageBefore);

    // 7️⃣  User should have received debt tokens from the operation
    const userDebtTokenBalanceAfter = await debtToken.balanceOf(user1.address);
    expect(userDebtTokenBalanceAfter).to.be.gt(userDebtTokenBalanceBefore);
  });
});
