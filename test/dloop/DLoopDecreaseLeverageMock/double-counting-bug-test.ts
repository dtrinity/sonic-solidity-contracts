import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createLeveragePosition, deployDLoopDecreaseLeverageFixture, testSetup } from "./fixture";

/**
 * This test verifies that the DLoopDecreaseLeverageBase contract
 * does not have a double-counting bug similar to the one found in
 * DLoopIncreaseLeverageBase (reported in issue #192).
 *
 * The test ensures that when a user provides exactly the required
 * debt token amount, the helper correctly recognizes the actual
 * available balance and takes a flash loan for any shortfall,
 * rather than double-counting the user's contribution.
 */
describe("DLoopDecreaseLeverageBase – double-counting collateral protection", function () {
  it("Should successfully decrease leverage with a flash loan when user supplies exactly the required debt", async function () {
    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    const { dloopCoreMock, decreaseLeverageMock, collateralToken, debtToken, user1 } = fixture;

    // Setup test environment
    await testSetup(fixture);

    // 1️⃣ Create initial leveraged position at target leverage
    await createLeveragePosition(fixture, user1, ethers.parseEther("100"));

    // 2️⃣ Move leverage above the target by decreasing collateral price
    const decreasedPrice = ethers.parseUnits("0.8", 8); // 20% price decrease
    await dloopCoreMock.setMockPrice(await collateralToken.getAddress(), decreasedPrice);

    // 3️⃣ Query how much debt is actually needed to get back to target
    const result = await dloopCoreMock.quoteRebalanceAmountToReachTargetLeverage();
    const requiredDebtAmount = result[0];
    const direction = result[2];
    expect(direction).to.equal(-1); // We need to decrease leverage
    expect(requiredDebtAmount).to.be.gt(0n);

    /*
     * 4️⃣ Pre-fund periphery with less than required amount.
     *     The helper should recognise it lacks debt tokens and therefore
     *     take a flash-loan for the shortfall.
     */
    const partialDebtAmount = requiredDebtAmount / 2n; // Provide only half to trigger flash loan
    await debtToken.mint(await decreaseLeverageMock.getAddress(), partialDebtAmount);

    // 5️⃣ Capture state before the leverage adjustment
    const leverageBefore = await dloopCoreMock.getCurrentLeverageBps();
    const userCollateralBalanceBefore = await collateralToken.balanceOf(user1.address);

    // 6️⃣ The call should now succeed (flash-loan branch is taken)
    await expect(
      decreaseLeverageMock.connect(user1).decreaseLeverage(
        requiredDebtAmount,
        "0x", // swap data (ignored by SimpleDEXMock)
        dloopCoreMock,
      ),
    ).not.to.be.reverted;

    // 7️⃣ Leverage must have decreased compared to the pre-call state
    const leverageAfter = await dloopCoreMock.getCurrentLeverageBps();
    expect(leverageAfter).to.be.lt(leverageBefore);

    // 8️⃣ User should have received collateral tokens from the operation
    const userCollateralBalanceAfter = await collateralToken.balanceOf(user1.address);
    expect(userCollateralBalanceAfter).to.be.gt(userCollateralBalanceBefore);
  });
});
