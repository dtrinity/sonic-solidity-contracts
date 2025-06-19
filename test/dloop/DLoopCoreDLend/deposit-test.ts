import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreDLend, ERC20 } from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import {
  prepareDLoopCoreDLendFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixture";

describe("DLoopCoreDLend Deposit Tests", function () {
  // Contract instances and addresses
  let dloopCoreDLend: DLoopCoreDLend;
  let collateralToken: ERC20;
  let debtToken: ERC20;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLoop deployment before each test
    const fixture = await prepareDLoopCoreDLendFixture();
    await testSetup(fixture);

    dloopCoreDLend = fixture.dloopCoreDLend;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    accounts = fixture.accounts;
  });

  describe("I. Basic Deposit Functionality", function () {
    const basicDepositTests = [
      {
        // First deposit establishes target leverage position
        name: "Should handle first deposit with target leverage",
        assets: ethers.parseEther("100"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
      {
        // Small deposits should work correctly
        name: "Should handle small deposit amounts",
        assets: ethers.parseEther("1"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
      {
        // Large deposits should work correctly
        name: "Should handle large deposit amounts",
        assets: ethers.parseEther("1000"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
    ];

    for (const testCase of basicDepositTests) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const userAddress = user.address;

        // Make sure initial leverage before deposit is 0
        const initialLeverage = await dloopCoreDLend.getCurrentLeverageBps();
        expect(initialLeverage).to.equal(0);

        // Check initial state
        expect(await dloopCoreDLend.totalSupply()).to.equal(0);
        expect(await dloopCoreDLend.totalAssets()).to.equal(0);
        expect(await dloopCoreDLend.balanceOf(userAddress)).to.equal(0);

        // Calculate expected values
        const expectedShares = await dloopCoreDLend.previewDeposit(
          testCase.assets,
        );

        // Approve to allow the dloopCoreDLend to spend user's tokens
        await collateralToken
          .connect(user)
          .approve(await dloopCoreDLend.getAddress(), testCase.assets);

        // Perform deposit
        const tx = await dloopCoreDLend
          .connect(user)
          .deposit(testCase.assets, userAddress);

        // Verify shares minted
        expect(await dloopCoreDLend.balanceOf(userAddress)).to.equal(
          expectedShares,
        );
        expect(await dloopCoreDLend.totalSupply()).to.equal(expectedShares);

        // Verify debt tokens transferred to user (should be > 0)
        const userDebtBalance = await debtToken.balanceOf(userAddress);
        expect(userDebtBalance).to.be.gt(0);

        // Verify leverage is correct (should be close to target)
        const currentLeverage = await dloopCoreDLend.getCurrentLeverageBps();
        expect(currentLeverage).to.be.closeTo(
          BigInt(testCase.expectedLeverage),
          BigInt(5 * ONE_PERCENT_BPS), // Allow 5% tolerance due to dLend rounding
        );

        // Verify event emission
        await expect(tx)
          .to.emit(dloopCoreDLend, "Deposit")
          .withArgs(userAddress, userAddress, testCase.assets, expectedShares);

        // Verify total assets increased
        const totalAssets = await dloopCoreDLend.totalAssets();
        expect(totalAssets).to.be.gte(testCase.assets);
      });
    }
  });

  // describe("II. Multiple Deposits", function () {
  //   it("Should handle multiple deposits from same user", async function () {
  //     const user = accounts[1];
  //     const firstDeposit = ethers.parseEther("100");
  //     const secondDeposit = ethers.parseEther("50");

  //     // First deposit
  //     await collateralToken
  //       .connect(user)
  //       .approve(await dloopCoreDLend.getAddress(), firstDeposit);
  //     await dloopCoreDLend.connect(user).deposit(firstDeposit, user.address);

  //     const sharesAfterFirst = await dloopCoreDLend.balanceOf(user.address);

  //     // Second deposit
  //     await collateralToken
  //       .connect(user)
  //       .approve(await dloopCoreDLend.getAddress(), secondDeposit);
  //     const leverageBeforeSecond = await dloopCoreDLend.getCurrentLeverageBps();

  //     await dloopCoreDLend.connect(user).deposit(secondDeposit, user.address);

  //     const leverageAfterSecond = await dloopCoreDLend.getCurrentLeverageBps();
  //     const sharesAfterSecond = await dloopCoreDLend.balanceOf(user.address);

  //     // Verify leverage is preserved (deposits should maintain leverage)
  //     expect(leverageAfterSecond).to.be.closeTo(
  //       leverageBeforeSecond,
  //       BigInt(2 * ONE_PERCENT_BPS), // Allow 2% tolerance
  //     );

  //     // Verify shares increased
  //     expect(sharesAfterSecond).to.be.gt(sharesAfterFirst);

  //     // Verify total assets
  //     const totalAssets = await dloopCoreDLend.totalAssets();
  //     expect(totalAssets).to.be.gte(firstDeposit + secondDeposit);
  //   });

  //   it("Should handle deposits from multiple users", async function () {
  //     const user1 = accounts[1];
  //     const user2 = accounts[2];
  //     const user3 = accounts[3];
  //     const depositAmount = ethers.parseEther("100");

  //     // User 1 deposit
  //     await collateralToken
  //       .connect(user1)
  //       .approve(await dloopCoreDLend.getAddress(), depositAmount);
  //     await dloopCoreDLend.connect(user1).deposit(depositAmount, user1.address);

  //     const leverageAfterUser1 = await dloopCoreDLend.getCurrentLeverageBps();

  //     // User 2 deposit (should preserve leverage)
  //     await collateralToken
  //       .connect(user2)
  //       .approve(await dloopCoreDLend.getAddress(), depositAmount);
  //     await dloopCoreDLend.connect(user2).deposit(depositAmount, user2.address);

  //     const leverageAfterUser2 = await dloopCoreDLend.getCurrentLeverageBps();

  //     // User 3 deposit
  //     await collateralToken
  //       .connect(user3)
  //       .approve(await dloopCoreDLend.getAddress(), depositAmount);
  //     await dloopCoreDLend.connect(user3).deposit(depositAmount, user3.address);

  //     const leverageAfterUser3 = await dloopCoreDLend.getCurrentLeverageBps();

  //     // Verify leverage is preserved across users
  //     expect(leverageAfterUser2).to.be.closeTo(
  //       leverageAfterUser1,
  //       BigInt(2 * ONE_PERCENT_BPS),
  //     );
  //     expect(leverageAfterUser3).to.be.closeTo(
  //       leverageAfterUser2,
  //       BigInt(2 * ONE_PERCENT_BPS),
  //     );

  //     // Verify all users have shares
  //     expect(await dloopCoreDLend.balanceOf(user1.address)).to.be.gt(0);
  //     expect(await dloopCoreDLend.balanceOf(user2.address)).to.be.gt(0);
  //     expect(await dloopCoreDLend.balanceOf(user3.address)).to.be.gt(0);

  //     // Verify total assets
  //     const totalAssets = await dloopCoreDLend.totalAssets();
  //     expect(totalAssets).to.be.gte(depositAmount * 3n);
  //   });
  // });

  // describe("III. Edge Cases and Error Conditions", function () {
  //   it("Should reject zero amount deposits", async function () {
  //     const user = accounts[1];

  //     await expect(
  //       dloopCoreDLend.connect(user).deposit(0, user.address),
  //     ).to.be.revertedWithCustomError(
  //       dloopCoreDLend,
  //       "ERC4626ExceededMaxDeposit",
  //     );
  //   });

  //   it("Should reject deposits when insufficient allowance", async function () {
  //     const user = accounts[1];
  //     const depositAmount = ethers.parseEther("100");

  //     // Don't set allowance
  //     await expect(
  //       dloopCoreDLend.connect(user).deposit(depositAmount, user.address),
  //     ).to.be.reverted; // Should revert due to insufficient allowance
  //   });

  //   it("Should reject deposits when insufficient balance", async function () {
  //     const user = accounts[9]; // User with no tokens
  //     const depositAmount = ethers.parseEther("100");

  //     // Set allowance but user has no tokens
  //     await collateralToken
  //       .connect(user)
  //       .approve(await dloopCoreDLend.getAddress(), depositAmount);

  //     await expect(
  //       dloopCoreDLend.connect(user).deposit(depositAmount, user.address),
  //     ).to.be.reverted; // Should revert due to insufficient balance
  //   });

  //   it("Should handle maximum deposit limits", async function () {
  //     const user = accounts[1];

  //     // Get max deposit amount
  //     const maxDeposit = await dloopCoreDLend.maxDeposit(user.address);
  //     expect(maxDeposit).to.be.gt(0);

  //     // Try to deposit more than max should fail
  //     const excessiveAmount = maxDeposit + ethers.parseEther("1");
  //     await collateralToken
  //       .connect(user)
  //       .approve(await dloopCoreDLend.getAddress(), excessiveAmount);

  //     await expect(
  //       dloopCoreDLend.connect(user).deposit(excessiveAmount, user.address),
  //     ).to.be.revertedWithCustomError(
  //       dloopCoreDLend,
  //       "ERC4626ExceededMaxDeposit",
  //     );
  //   });
  // });

  // describe("IV. Leverage Boundaries and Imbalance", function () {
  //   it("Should reject deposits when vault becomes too imbalanced", async function () {
  //     const user = accounts[1];
  //     const initialDeposit = ethers.parseEther("100");

  //     // Make initial deposit to establish position
  //     await collateralToken
  //       .connect(user)
  //       .approve(await dloopCoreDLend.getAddress(), initialDeposit);
  //     await dloopCoreDLend.connect(user).deposit(initialDeposit, user.address);

  //     // Check if we can simulate imbalance (this depends on dLend oracle behavior)
  //     // In a real scenario, price changes in the oracle would make the vault imbalanced
  //     // For now, we'll check that the imbalance check exists
  //     const isImbalanced = await dloopCoreDLend.isTooImbalanced();
  //     const maxDepositWhenImbalanced = await dloopCoreDLend.maxDeposit(
  //       user.address,
  //     );

  //     // If vault is imbalanced, maxDeposit should be 0
  //     if (isImbalanced) {
  //       expect(maxDepositWhenImbalanced).to.equal(0);
  //     } else {
  //       expect(maxDepositWhenImbalanced).to.be.gt(0);
  //     }
  //   });

  //   it("Should maintain leverage within bounds", async function () {
  //     const user = accounts[1];
  //     const depositAmount = ethers.parseEther("100");

  //     await collateralToken
  //       .connect(user)
  //       .approve(await dloopCoreDLend.getAddress(), depositAmount);
  //     await dloopCoreDLend.connect(user).deposit(depositAmount, user.address);

  //     const currentLeverage = await dloopCoreDLend.getCurrentLeverageBps();
  //     const lowerBound = await dloopCoreDLend.lowerBoundTargetLeverageBps();
  //     const upperBound = await dloopCoreDLend.upperBoundTargetLeverageBps();

  //     // After deposit, leverage should be close to target (which is within bounds)
  //     expect(currentLeverage).to.be.gte(lowerBound);
  //     expect(currentLeverage).to.be.lte(upperBound);
  //   });
  // });

  // describe("V. Integration with dLend", function () {
  //   it("Should correctly interact with dLend lending pool", async function () {
  //     const user = accounts[1];
  //     const depositAmount = ethers.parseEther("100");

  //     // Get initial pool state
  //     const poolAddress = await dloopCoreDLend.getLendingPoolAddress();
  //     expect(poolAddress).to.not.equal(ethers.ZeroAddress);

  //     // Make deposit
  //     await collateralToken
  //       .connect(user)
  //       .approve(await dloopCoreDLend.getAddress(), depositAmount);
  //     await dloopCoreDLend.connect(user).deposit(depositAmount, user.address);

  //     // Verify the vault has positions in dLend
  //     const [totalCollateral, totalDebt] =
  //       await dloopCoreDLend.getTotalCollateralAndDebtOfUserInBase(
  //         await dloopCoreDLend.getAddress(),
  //       );

  //     expect(totalCollateral).to.be.gt(0);
  //     expect(totalDebt).to.be.gt(0);

  //     // Verify leverage calculation
  //     const leverage = await dloopCoreDLend.getCurrentLeverageBps();
  //     const expectedLeverage =
  //       (totalCollateral * 10000n) / (totalCollateral - totalDebt);

  //     expect(leverage).to.be.closeTo(
  //       expectedLeverage,
  //       BigInt(ONE_PERCENT_BPS), // 1% tolerance
  //     );
  //   });
  // });
});
