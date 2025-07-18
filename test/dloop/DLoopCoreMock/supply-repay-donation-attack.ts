import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_HUNDRED_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, testSetup } from "./fixture";

describe("DLoopCoreMock - Supply/Repay Donation Attack Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    accounts = fixture.accounts;
  });

  describe("Attack Scenario 1: Direct Supply Donation Attack", function () {
    it("Should not allow to deposit or withdraw, and can increase leverage to fix the issue", async function () {
      const victim = accounts[2]; // Will be the "vault user" trying to withdraw

      // Initial setup: ensure vault has no collateral or debt
      const initialCollateral = await dloopMock.getMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
      );
      const initialDebt = await dloopMock.getMockDebt(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
      );

      expect(initialCollateral).to.equal(0n);
      expect(initialDebt).to.equal(0n);

      // Attack: Simulate someone supplying collateral directly to the lending pool on behalf of the vault
      // This bypasses the vault's deposit mechanism and creates a state where vault has collateral but no debt
      const donationAmount = ethers.parseEther("1000");

      // Directly set the vault's collateral state to simulate the attack
      // This simulates what happens when someone calls lendingPool.supply(collateralToken, amount, vaultAddress, 0)
      await dloopMock.setMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
        donationAmount,
      );

      // Verify attack was successful: vault now has collateral but no debt
      const vaultCollateralAfterAttack = await dloopMock.getMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
      );
      const vaultDebtAfterAttack = await dloopMock.getMockDebt(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
      );

      expect(vaultCollateralAfterAttack).to.equal(donationAmount);
      expect(vaultDebtAfterAttack).to.equal(0n);

      // Verify vault leverage is 100% (no debt)
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.equal(ONE_HUNDRED_PERCENT_BPS);

      // Now attempt a normal user deposit to the vault - this should work
      const userDepositAmount = ethers.parseEther("100");
      await collateralToken.mint(victim, userDepositAmount);
      await collateralToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), userDepositAmount);

      // This deposit should be failed as the vault now is too imbalanced
      // which leads to maxDeposit() returns 0
      await expect(
        dloopMock.connect(victim).deposit(userDepositAmount, victim.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxDeposit");

      // Since the vault started with leverage=100%, the withdrawal calculation will fail

      // Give user some debt tokens to satisfy the withdrawal requirements
      await debtToken.mint(victim, ethers.parseEther("10000"));
      await debtToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), ethers.parseEther("10000"));

      // Attempt withdrawal - this should revert as the vault is too imbalanced
      // which leads to maxWithdraw() returns 0
      await expect(
        dloopMock
          .connect(victim)
          .withdraw(userDepositAmount / 2n, victim.address, victim.address),
      ).to.be.revertedWithCustomError(dloopMock, "ERC4626ExceededMaxWithdraw");

      // Approve to increaseLeverage()
      await collateralToken
        .connect(accounts[1])
        .approve(await dloopMock.getAddress(), ethers.parseEther("1000"));

      // Can call increaseLeverage()
      await dloopMock
        .connect(accounts[1])
        .increaseLeverage(ethers.parseEther("1000"), 0n);

      // Check current leverage
      const currentLeverageAfterIncrease =
        await dloopMock.getCurrentLeverageBps();
      expect(currentLeverageAfterIncrease).to.equal(2020202n);
    });
  });

  describe("Attack Scenario 2: Debt Repayment Donation Attack", function () {
    it("Should freeze vault when someone repays all debt directly to lending pool", async function () {
      const attacker = accounts[1];
      const victim = accounts[2];

      // Setup: Create a normal vault position first
      const initialDepositAmount = ethers.parseEther("1000");
      await collateralToken.mint(victim, initialDepositAmount);
      await collateralToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), initialDepositAmount);

      // Normal deposit creates leveraged position
      await dloopMock
        .connect(victim)
        .deposit(initialDepositAmount, victim.address);

      // Verify vault has both collateral and debt after normal deposit
      const vaultCollateral = await dloopMock.getMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
      );
      const vaultDebt = await dloopMock.getMockDebt(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
      );

      expect(vaultCollateral).to.be.gt(0n);
      expect(vaultDebt).to.be.gt(0n);

      // Verify vault has target leverage
      const leverageBeforeAttack = await dloopMock.getCurrentLeverageBps();
      expect(leverageBeforeAttack).to.be.gt(0n);

      // Attack: Simulate someone repaying ALL debt on behalf of the vault directly to the lending pool
      // This creates a state where vault has collateral but no debt (leverage = 0)

      // Directly set the vault's debt to 0 to simulate the attack
      // This simulates what happens when someone calls lendingPool.repay(debtToken, vaultDebt, 2, vaultAddress)
      await dloopMock.setMockDebt(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
        0,
      );

      // Verify attack was successful: vault now has collateral but no debt
      const vaultCollateralAfterAttack = await dloopMock.getMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
      );
      const vaultDebtAfterAttack = await dloopMock.getMockDebt(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
      );

      expect(vaultCollateralAfterAttack).to.equal(vaultCollateral);
      expect(vaultDebtAfterAttack).to.equal(0n);

      // Verify vault leverage is now 0 (no debt)
      const leverageAfterAttack = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterAttack).to.equal(0n);

      // Now the critical part: victim tries to withdraw but hits division by zero
      // Since the vault now has leverage=0, the withdrawal calculation will fail

      const userShares = await dloopMock.balanceOf(victim.address);
      expect(userShares).to.be.gt(0n);

      // Give user some debt tokens to satisfy the withdrawal requirements
      await debtToken.mint(victim, ethers.parseEther("10000"));
      await debtToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), ethers.parseEther("10000"));

      // Attempt withdrawal - this should revert with division by zero error
      // The error occurs in getRepayAmountThatKeepCurrentLeverage when leverageBpsBeforeRepayDebt is 0
      await expect(
        dloopMock
          .connect(victim)
          .withdraw(initialDepositAmount / 2n, victim.address, victim.address),
      ).to.be.revertedWithPanic(0x12); // Division by zero panic code
    });
  });

  describe("Detailed Error Analysis", function () {
    it("Should demonstrate the exact division by zero in getRepayAmountThatKeepCurrentLeverage", async function () {
      const attacker = accounts[1];

      // Setup vault with collateral but no debt (simulate attack scenario)
      const donationAmount = ethers.parseEther("1000");

      // Directly set the vault's collateral state to simulate the attack
      await dloopMock.setMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
        donationAmount,
      );

      // Verify current leverage is 0
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.equal(0n);

      // Try calling getRepayAmountThatKeepCurrentLeverage directly with leverage = 0
      // This should revert with division by zero
      const withdrawAmount = ethers.parseEther("100");

      await expect(
        dloopMock.getRepayAmountThatKeepCurrentLeverage(
          await collateralToken.getAddress(),
          await debtToken.getAddress(),
          withdrawAmount,
          0n, // leverageBpsBeforeRepayDebt = 0, causes division by zero
        ),
      ).to.be.revertedWithPanic(0x12); // Division by zero panic code
    });

    it("Should show the problem persists even with small amounts", async function () {
      const attacker = accounts[1];
      const victim = accounts[2];

      // Attack with minimal amounts to show it's not about amount size
      const smallDonation = 1n; // 1 wei

      // Directly set the vault's collateral state to simulate the attack
      await dloopMock.setMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
        smallDonation,
      );

      // Even with minimal amounts, leverage is still 0
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.equal(0n);

      // Make a normal deposit
      const userDepositAmount = ethers.parseEther("100");
      await collateralToken.mint(victim, userDepositAmount);
      await collateralToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), userDepositAmount);
      await dloopMock
        .connect(victim)
        .deposit(userDepositAmount, victim.address);

      // Try to withdraw - still fails
      await debtToken.mint(victim, ethers.parseEther("10000"));
      await debtToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), ethers.parseEther("10000"));

      await expect(
        dloopMock
          .connect(victim)
          .withdraw(userDepositAmount / 2n, victim.address, victim.address),
      ).to.be.revertedWithPanic(0x12);
    });
  });

  describe("Impact Verification", function () {
    it("Should demonstrate that funds are permanently locked", async function () {
      const attacker = accounts[1];
      const victim = accounts[2];

      // Setup attack scenario
      const donationAmount = ethers.parseEther("1000");

      // Directly set the vault's collateral state to simulate the attack
      await dloopMock.setMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
        donationAmount,
      );

      // User makes deposit
      const userDepositAmount = ethers.parseEther("100");
      await collateralToken.mint(victim, userDepositAmount);
      await collateralToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), userDepositAmount);
      await dloopMock
        .connect(victim)
        .deposit(userDepositAmount, victim.address);

      const userShares = await dloopMock.balanceOf(victim.address);
      expect(userShares).to.be.gt(0n);

      // User has shares but cannot withdraw (funds are locked)
      await debtToken.mint(victim, ethers.parseEther("10000"));
      await debtToken
        .connect(victim)
        .approve(await dloopMock.getAddress(), ethers.parseEther("10000"));

      // All withdrawal attempts fail
      await expect(
        dloopMock.connect(victim).withdraw(1n, victim.address, victim.address),
      ).to.be.revertedWithPanic(0x12);

      await expect(
        dloopMock.connect(victim).redeem(1n, victim.address, victim.address),
      ).to.be.revertedWithPanic(0x12);

      // Even tiny withdrawals fail
      await expect(
        dloopMock.connect(victim).withdraw(1n, victim.address, victim.address),
      ).to.be.revertedWithPanic(0x12);

      // User's funds are effectively locked
      const finalBalance = await collateralToken.balanceOf(victim.address);
      expect(finalBalance).to.equal(0n); // User spent their collateral

      const vaultBalance = await dloopMock.balanceOf(victim.address);
      expect(vaultBalance).to.be.gt(0n); // But has vault shares that can't be redeemed
    });
  });
});
