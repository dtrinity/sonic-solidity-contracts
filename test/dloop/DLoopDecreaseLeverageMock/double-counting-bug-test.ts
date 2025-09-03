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
    /**
     * With flash-loan case, we expect no input fund are needed from the caller
     * The helper should therefore flash-loan the required debt token amount
     */

    const fixture = await loadFixture(deployDLoopDecreaseLeverageFixture);
    const { dloopCoreMock, quoter, decreaseLeverageMock, collateralToken, debtToken, user1 } = fixture;

    // Setup test environment
    await testSetup(fixture);

    // 1️⃣ Create initial leveraged position at target leverage
    await createLeveragePosition(fixture, user1, ethers.parseEther("100"));

    // 2️⃣ Move leverage above the target by decreasing collateral price
    const decreasedPrice = ethers.parseUnits("0.8", 8); // 20% price decrease
    await dloopCoreMock.setMockPrice(await collateralToken.getAddress(), decreasedPrice);

    // 3️⃣ Check current leverage and determine direction
    const currentLeverage = await dloopCoreMock.getCurrentLeverageBps();
    const targetLeverage = await dloopCoreMock.targetLeverageBps();
    const upperBound = await dloopCoreMock.upperBoundTargetLeverageBps();

    console.log(`After price decrease: leverage=${currentLeverage}, target=${targetLeverage}, upperBound=${upperBound}`);

    expect(currentLeverage).to.be.gt(targetLeverage);

    // Calculate the amount needed to reach the upper bound (400%)
    // Current leverage is ~600%, target upper bound is 400%
    // We need to reduce leverage from 600% to 400%
    // This requires calculating the debt amount that will achieve this
    const [fullRequiredDebtAmount, , direction] = await quoter.quoteRebalanceAmountToReachTargetLeverage(await dloopCoreMock.getAddress());

    expect(direction).to.equal(-1);
    expect(fullRequiredDebtAmount).to.be.gt(0n);

    // Only use 1/2 of the required debt amount
    const requiredDebtAmount = (fullRequiredDebtAmount + 1n) / 2n;

    // Make sure the periphery has no debt token balance
    // This will trigger flash-loan since periphery has no debt token balance
    const peripheryDebtTokenBalance = await debtToken.balanceOf(await decreaseLeverageMock.getAddress());
    expect(peripheryDebtTokenBalance).to.equal(0n);

    // Make sure caller has 0 debt token balance as well
    // This case, we use another account to call the periphery mock
    // to prove that no input fund are needed from the caller
    const rebalancerCaller = (await ethers.getSigners())[5];
    expect(rebalancerCaller.address).not.to.equal(user1.address);
    const callerDebtTokenBalance = await debtToken.balanceOf(rebalancerCaller.address);
    expect(callerDebtTokenBalance).to.equal(0n);

    // 5️⃣ Capture state before the leverage adjustment
    const leverageBefore = await dloopCoreMock.getCurrentLeverageBps();
    const userCollateralBalanceBefore = await collateralToken.balanceOf(rebalancerCaller.address);

    // 6️⃣ The call should proceed (may revert due to post-execution validation, which is acceptable)
    await decreaseLeverageMock.connect(rebalancerCaller).decreaseLeverage(
      requiredDebtAmount,
      "0x", // swap data (ignored by SimpleDEXMock)
      dloopCoreMock,
    );

    // 7️⃣ Check leverage after the operation (only if operation succeeded)
    const leverageAfter = await dloopCoreMock.getCurrentLeverageBps();

    expect(leverageAfter).to.be.lt(leverageBefore);

    // Leverage must be decreased and not below the target leverage
    expect(leverageAfter).to.gte(await dloopCoreMock.targetLeverageBps());

    // 8️⃣ Check if user received collateral tokens (only if operation succeeded)
    const userCollateralBalanceAfter = await collateralToken.balanceOf(rebalancerCaller.address);

    expect(userCollateralBalanceAfter).to.be.gt(userCollateralBalanceBefore);
  });
});
