import { expect } from "chai";
import { ethers } from "hardhat";

import { deployDLoopMockFixture, testSetup } from "./fixture";

// Regression for HATS-127: redeem should not revert if someone repays a tiny amount on behalf of the vault
describe("DLoopCoreMock – tiny repay on behalf should not DoS redeem", function () {
  it("should redeem successfully even if attacker repaid 2 wei on behalf of the vault", async function () {
    const fixture = await deployDLoopMockFixture();
    await testSetup(fixture);

    const { dloopMock, collateralToken, debtToken, accounts, mockPool } = fixture;
    const user = accounts[1];
    const attacker = accounts[2];

    // User creates a position
    const depositAmount = ethers.parseEther("100");
    await collateralToken
      .connect(user)
      .approve(await dloopMock.getAddress(), depositAmount);
    await dloopMock.connect(user).deposit(depositAmount, user.address);

    // Prepare small redeem
    const shares = await dloopMock.balanceOf(user.address);
    const smallShares = shares / 1000n;

    // Simulate "repay on behalf" by reducing the vault's mock debt by 2 wei directly (attacker action)
    // The mock environment doesn't have a separate lending pool contract entrypoint, so we emulate the effect.
    const vault = await dloopMock.getAddress();
    const debtBefore = await dloopMock.getMockDebt(
      vault,
      await debtToken.getAddress(),
    );
    if (debtBefore > 0n) {
      const donation = 2n;
      await dloopMock.setMockDebt(
        vault,
        await debtToken.getAddress(),
        debtBefore > donation ? debtBefore - donation : 0n,
      );
    }

    // Approve potentially required debt tokens
    const leverageBefore = await dloopMock.getCurrentLeverageBps();
    const expectedAssets = await dloopMock.previewRedeem(smallShares);
    const repayNeeded = await dloopMock.getRepayAmountThatKeepCurrentLeverage(
      await dloopMock.getCollateralTokenAddress(),
      await dloopMock.getDebtTokenAddress(),
      expectedAssets,
      leverageBefore,
    );
    await debtToken
      .connect(user)
      .approve(await dloopMock.getAddress(), repayNeeded);

    // Redeem should not revert
    await expect(
      dloopMock.connect(user).redeem(smallShares, user.address, user.address),
    ).to.not.be.reverted;
  });
});


