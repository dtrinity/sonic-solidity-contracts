import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { createLeverageIncreaseScenario, deployDLoopIncreaseLeverageMockFixture } from "./fixtures";

describe("DLoopIncreaseLeverageMock - Leftover Debt Token Handling", function () {
  it("transfers leftover debt tokens to user and emits event", async function () {
    const { dloopMock, quoter, increaseLeverageMock, collateralToken, debtToken, simpleDEXMock, mockPool, accounts, deployer, user1 } =
      await loadFixture(deployDLoopIncreaseLeverageMockFixture);

    // Simplified test - just pre-fund periphery with some tokens and run the function
    // The goal is to test that any leftover debt tokens are transferred to the user

    // Create a leverage increase scenario
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

    // Query how much collateral is needed to reach target leverage
    const [fullRequiredCollateralAmount, , direction] = await quoter.quoteRebalanceAmountToReachTargetLeverage(
      await dloopMock.getAddress(),
    );
    expect(direction).to.equal(1); // We need to increase leverage
    expect(fullRequiredCollateralAmount).to.be.gt(0n);

    // Use only 1/50 of the required amount to avoid leverage range errors
    const requiredCollateralAmount = fullRequiredCollateralAmount / 50n;

    // Pre-fund periphery with more collateral than needed to create leftovers
    const excessCollateralAmount = requiredCollateralAmount * 2n;
    await collateralToken.mint(await increaseLeverageMock.getAddress(), excessCollateralAmount);

    // Also pre-fund with some debt tokens that should become leftovers
    await debtToken.mint(await increaseLeverageMock.getAddress(), ethers.parseEther("5"));

    const beforeDebt = await debtToken.balanceOf(user1.address);

    // Execute the leverage increase
    const tx = await increaseLeverageMock.connect(user1).increaseLeverage(requiredCollateralAmount, "0x", dloopMock);
    const receipt = await tx.wait();

    // Parse leftover event
    const leftoverEvents = receipt!.logs.filter((log) => {
      const parsed = increaseLeverageMock.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      return parsed?.name === "LeftoverDebtTokensTransferred";
    });

    expect(leftoverEvents.length).to.be.greaterThan(0);

    const parsed = increaseLeverageMock.interface.parseLog({
      topics: leftoverEvents[0].topics,
      data: leftoverEvents[0].data,
    });

    expect(parsed).to.not.be.null;
    expect(parsed!.args[0]).to.equal(await debtToken.getAddress());
    expect(parsed!.args[2]).to.equal(user1.address);
    expect(parsed!.args[1]).to.be.gte(1n);

    const afterDebt = await debtToken.balanceOf(user1.address);
    expect(afterDebt).to.be.gte(beforeDebt);
  });
});
