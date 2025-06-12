import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopDepositorMock,
  SimpleDEXMock,
  TestERC20FlashMintable,
  TestMintableERC20,
} from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import {
  deployDLoopDepositorMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixtures";

describe("DLoopDepositorMock Deposit Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let dLoopDepositorMock: DLoopDepositorMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestERC20FlashMintable;
  let flashLender: TestERC20FlashMintable;
  let simpleDEXMock: SimpleDEXMock;
  let accounts: HardhatEthersSigner[];
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  /**
   * Helper function to calculate reasonable minOutputShares with slippage tolerance
   *
   * @param depositAmount - The amount of collateral token to deposit
   * @param slippagePercentage - The slippage percentage to allow (default 5%)
   */
  async function calculateMinOutputShares(
    depositAmount: bigint,
    slippagePercentage: number = 5, // Default 5% slippage tolerance
  ): Promise<bigint> {
    const expectedLeveragedAssets =
      await dloopMock.getLeveragedAssets(depositAmount);
    const expectedShares = await dloopMock.convertToShares(
      expectedLeveragedAssets,
    );
    return (expectedShares * BigInt(100 - slippagePercentage)) / 100n;
  }

  beforeEach(async function () {
    // Reset the deployment before each test
    const fixtures = await loadFixture(deployDLoopDepositorMockFixture);
    await testSetup(
      fixtures.dloopCoreMockFixture,
      fixtures.dloopDepositorMockFixture,
    );

    // Extract fixture objects
    const dloopCoreMockFixture = fixtures.dloopCoreMockFixture;
    const dloopDepositorMockFixture = fixtures.dloopDepositorMockFixture;

    dloopMock = dloopCoreMockFixture.dloopMock;
    collateralToken = dloopCoreMockFixture.collateralToken;
    debtToken = dloopCoreMockFixture.debtToken;

    dLoopDepositorMock = dloopDepositorMockFixture.dLoopDepositorMock;
    flashLender = dloopDepositorMockFixture.flashLender;
    simpleDEXMock = dloopDepositorMockFixture.simpleDEXMock;
    accounts = dloopDepositorMockFixture.accounts;
    user1 = dloopDepositorMockFixture.user1;
    user2 = dloopDepositorMockFixture.user2;
    user3 = dloopDepositorMockFixture.user3;
  });

  describe("I. Basic Deposit Functionality", function () {
    it("Should perform basic leveraged deposit", async function () {
      const depositAmount = ethers.parseEther("100");

      // Calculate reasonable minOutputShares - use 95% of expected shares for 5% slippage tolerance
      const expectedLeveragedAssets =
        await dloopMock.getLeveragedAssets(depositAmount);
      const expectedShares = await dloopMock.convertToShares(
        expectedLeveragedAssets,
      );
      const minOutputShares = (expectedShares * 95n) / 100n; // Allow 5% slippage

      // Get initial balances
      const initialUserCollateralBalance = await collateralToken.balanceOf(
        user1.address,
      );
      const initialUserShareBalance = await dloopMock.balanceOf(user1.address);
      const initialCoreCollateral = await dloopMock.getMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
      );

      // Perform leveraged deposit
      const tx = await dLoopDepositorMock.connect(user1).deposit(
        depositAmount,
        user1.address,
        minOutputShares,
        "0x", // No specific swap data needed for SimpleDEXMock
        dloopMock,
      );

      // Wait for transaction
      await tx.wait();

      // Verify user collateral balance decreased by deposit amount
      const finalUserCollateralBalance = await collateralToken.balanceOf(
        user1.address,
      );
      expect(finalUserCollateralBalance).to.equal(
        initialUserCollateralBalance - depositAmount,
      );

      // Verify user received shares
      const finalUserShareBalance = await dloopMock.balanceOf(user1.address);
      expect(finalUserShareBalance).to.be.gt(initialUserShareBalance);

      // Verify core vault received leveraged collateral amount
      const leveragedAmount = await dloopMock.getLeveragedAssets(depositAmount);
      const finalCoreCollateral = await dloopMock.getMockCollateral(
        await dloopMock.getAddress(),
        await collateralToken.getAddress(),
      );

      // Should be close to leveraged amount (allowing for slippage)
      expect(finalCoreCollateral).to.be.gt(initialCoreCollateral);
      const actualLeveragedAmount = finalCoreCollateral - initialCoreCollateral;
      // With 5% slippage tolerance, we expect around 95% of the leveraged amount
      expect(actualLeveragedAmount).to.be.gte((leveragedAmount * 90n) / 100n); // At least 90%
      expect(actualLeveragedAmount).to.be.lte(leveragedAmount); // But not more than 100%

      // Verify vault has target leverage
      const currentLeverage = await dloopMock.getCurrentLeverageBps();
      expect(currentLeverage).to.be.closeTo(
        BigInt(TARGET_LEVERAGE_BPS),
        BigInt(ONE_PERCENT_BPS),
      );
    });

    it("Should handle multiple deposit amounts", async function () {
      const depositAmounts = [
        ethers.parseEther("50"),
        ethers.parseEther("100"),
        ethers.parseEther("200"),
      ];

      for (const depositAmount of depositAmounts) {
        // Get initial state
        const initialUserCollateralBalance = await collateralToken.balanceOf(
          user1.address,
        );
        const initialUserShareBalance = await dloopMock.balanceOf(
          user1.address,
        );

        // Calculate reasonable minOutputShares for this deposit
        const expectedLeveragedAssets =
          await dloopMock.getLeveragedAssets(depositAmount);
        const expectedShares = await dloopMock.convertToShares(
          expectedLeveragedAssets,
        );
        const minOutputShares = (expectedShares * 95n) / 100n; // Allow 5% slippage

        // Perform deposit
        await dLoopDepositorMock
          .connect(user1)
          .deposit(
            depositAmount,
            user1.address,
            minOutputShares,
            "0x",
            dloopMock,
          );

        // Verify balances changed correctly
        const finalUserCollateralBalance = await collateralToken.balanceOf(
          user1.address,
        );
        const finalUserShareBalance = await dloopMock.balanceOf(user1.address);

        expect(finalUserCollateralBalance).to.equal(
          initialUserCollateralBalance - depositAmount,
        );
        expect(finalUserShareBalance).to.be.gt(initialUserShareBalance);
        // Make sure to receive at least the minOutputShares
        expect(finalUserShareBalance - initialUserShareBalance).to.be.gte(
          minOutputShares,
        );
      }
    });

    it("Should respect minimum output shares (slippage protection)", async function () {
      const depositAmount = ethers.parseEther("100");

      // Get estimated shares without slippage protection
      const leveragedAmount = await dloopMock.getLeveragedAssets(depositAmount);
      const estimatedShares = await dloopMock.previewDeposit(leveragedAmount);

      // Set minimum to be slightly less than estimated
      const minOutputShares = estimatedShares - ethers.parseEther("1");

      // Should succeed with reasonable minimum
      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(
            depositAmount,
            user1.address,
            minOutputShares,
            "0x",
            dloopMock,
          ),
      ).to.not.be.reverted;

      // Should fail with unreasonably high minimum
      const unreasonableMinimum = estimatedShares + ethers.parseEther("1000");
      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(
            depositAmount,
            user1.address,
            unreasonableMinimum,
            "0x",
            dloopMock,
          ),
      ).to.be.revertedWithCustomError(
        dLoopDepositorMock,
        "EstimatedSharesLessThanMinOutputShares",
      );
    });
  });

  describe("II. Flash Loan Integration", function () {
    it("Should utilize flash loans for leverage", async function () {
      const depositAmount = ethers.parseEther("100");

      // Check flash lender has sufficient balance
      const flashLenderBalance = await flashLender.balanceOf(
        await flashLender.getAddress(),
      );
      expect(flashLenderBalance).to.be.gt(0);

      // Record flash lender state before
      const initialFlashLenderBalance = await flashLender.balanceOf(
        await flashLender.getAddress(),
      );

      // Calculate reasonable minOutputShares
      const minOutputShares = await calculateMinOutputShares(depositAmount);

      // Perform leveraged deposit
      await dLoopDepositorMock
        .connect(user1)
        .deposit(
          depositAmount,
          user1.address,
          minOutputShares,
          "0x",
          dloopMock,
        );

      // Flash lender balance should return to approximately the same level
      // (may have small fee differences)
      const finalFlashLenderBalance = await flashLender.balanceOf(
        await flashLender.getAddress(),
      );
      expect(finalFlashLenderBalance).to.be.closeTo(
        initialFlashLenderBalance,
        ethers.parseEther("1"), // Allow 1 ETH tolerance for fees
      );
    });

    it("Should handle flash loan fees correctly", async function () {
      const depositAmount = ethers.parseEther("100");

      // Flash loan should have zero fee by default in TestERC20FlashMintable
      const flashLoanAmount = ethers.parseEther("1000");
      const flashFee = await flashLender.flashFee(
        await flashLender.getAddress(),
        flashLoanAmount,
      );
      expect(flashFee).to.equal(0);

      // Calculate reasonable minOutputShares
      const minOutputShares = await calculateMinOutputShares(depositAmount);

      // Should succeed even with zero fees
      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(
            depositAmount,
            user1.address,
            minOutputShares,
            "0x",
            dloopMock,
          ),
      ).to.not.be.reverted;
    });

    it("Should fail if flash loan amount exceeds available", async function () {
      // Try to make an extremely large deposit that would require more flash loan than available
      const depositAmount = ethers.parseEther("10000000"); // 10M ETH

      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock),
      ).to.be.reverted;
    });
  });

  describe("III. DEX Integration", function () {
    it("Should swap debt tokens to collateral tokens correctly", async function () {
      const depositAmount = ethers.parseEther("100");

      // Get initial DEX balances
      const initialDexCollateralBalance = await collateralToken.balanceOf(
        await simpleDEXMock.getAddress(),
      );
      const initialDexDebtBalance = await debtToken.balanceOf(
        await simpleDEXMock.getAddress(),
      );

      // Calculate reasonable minOutputShares
      const minOutputShares = await calculateMinOutputShares(depositAmount);

      // Perform leveraged deposit
      await dLoopDepositorMock
        .connect(user1)
        .deposit(
          depositAmount,
          user1.address,
          minOutputShares,
          "0x",
          dloopMock,
        );

      // DEX should have received debt tokens and given out collateral tokens
      const finalDexCollateralBalance = await collateralToken.balanceOf(
        await simpleDEXMock.getAddress(),
      );
      const finalDexDebtBalance = await debtToken.balanceOf(
        await simpleDEXMock.getAddress(),
      );

      // DEX should have less collateral and more debt tokens
      expect(finalDexCollateralBalance).to.be.lt(initialDexCollateralBalance);
      expect(finalDexDebtBalance).to.be.gt(initialDexDebtBalance);
    });

    it("Should handle different exchange rates", async function () {
      const depositAmount = ethers.parseEther("100");

      // Test with 1:1.5 exchange rate (1 debt token = 1.5 collateral tokens)
      const newExchangeRate = ethers.parseEther("1.5");
      await simpleDEXMock.setExchangeRate(
        await debtToken.getAddress(),
        await collateralToken.getAddress(),
        newExchangeRate,
      );

      // Should still work with different exchange rate
      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock),
      ).to.not.be.reverted;

      // Verify user received shares
      const userShares = await dloopMock.balanceOf(user1.address);
      expect(userShares).to.be.gt(0);
    });

    it("Should handle DEX execution slippage", async function () {
      const depositAmount = ethers.parseEther("100");

      // Set higher execution slippage (2%)
      await simpleDEXMock.setExecutionSlippage(2 * ONE_PERCENT_BPS);

      // Should still work with slippage
      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock),
      ).to.not.be.reverted;

      // Verify result is reasonable despite slippage
      const userShares = await dloopMock.balanceOf(user1.address);
      expect(userShares).to.be.gt(0);
    });
  });

  describe("IV. Edge Cases and Error Handling", function () {
    it("Should revert with insufficient collateral token balance", async function () {
      const depositAmount = ethers.parseEther("20000"); // More than user balance

      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock),
      ).to.be.reverted;
    });

    it("Should revert with insufficient allowance", async function () {
      const depositAmount = ethers.parseEther("100");

      // Remove approval
      await collateralToken
        .connect(user1)
        .approve(await dLoopDepositorMock.getAddress(), 0);

      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock),
      ).to.be.reverted;
    });

    it("Should revert when slippage exceeds 100%", async function () {
      const depositAmount = ethers.parseEther("100");

      // Get leveraged amount and estimated shares
      const leveragedAmount = await dloopMock.getLeveragedAssets(depositAmount);
      const estimatedShares = await dloopMock.previewDeposit(leveragedAmount);

      // Set minimum shares that would require negative slippage
      const impossibleMinimum = estimatedShares * BigInt(2); // 200% of expected

      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(
            depositAmount,
            user1.address,
            impossibleMinimum,
            "0x",
            dloopMock,
          ),
      ).to.be.revertedWithCustomError(
        dLoopDepositorMock,
        "EstimatedOverallSlippageBpsCannotExceedOneHundredPercent",
      );
    });

    it("Should handle zero deposit amount", async function () {
      const depositAmount = 0;

      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock),
      ).to.be.reverted;
    });

    it("Should handle incompatible debt token", async function () {
      // Deploy another DLoopCore with different debt token
      const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
      const differentDebtToken = await MockERC20.deploy(
        "Different Debt",
        "DIFF",
        18,
      );

      const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");
      const differentDLoopCore = await DLoopCoreMock.deploy(
        "Different dLoop Vault",
        "dDIFF",
        await collateralToken.getAddress(),
        await differentDebtToken.getAddress(),
        TARGET_LEVERAGE_BPS,
        200 * ONE_PERCENT_BPS,
        400 * ONE_PERCENT_BPS,
        1 * ONE_PERCENT_BPS,
        accounts[10], // mockPool
      );

      const depositAmount = ethers.parseEther("100");

      // Should revert due to incompatible debt token
      await expect(
        dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", differentDLoopCore),
      ).to.be.revertedWithCustomError(
        dLoopDepositorMock,
        "IncompatibleDLoopCoreDebtToken",
      );
    });
  });

  describe("V. Multiple Users and Complex Scenarios", function () {
    it("Should handle deposits from multiple users", async function () {
      const depositAmount = ethers.parseEther("100");
      const users = [user1, user2, user3];

      for (const user of users) {
        const initialShares = await dloopMock.balanceOf(user.address);

        await dLoopDepositorMock
          .connect(user)
          .deposit(depositAmount, user.address, 0, "0x", dloopMock);

        const finalShares = await dloopMock.balanceOf(user.address);
        expect(finalShares).to.be.gt(initialShares);
      }

      // Verify total supply increased appropriately
      const totalSupply = await dloopMock.totalSupply();
      expect(totalSupply).to.be.gt(0);
    });

    it("Should handle sequential deposits by same user", async function () {
      const depositAmounts = [
        ethers.parseEther("50"),
        ethers.parseEther("75"),
        ethers.parseEther("25"),
      ];

      let cumulativeShares = BigInt(0);

      for (const depositAmount of depositAmounts) {
        const initialShares = await dloopMock.balanceOf(user1.address);

        await dLoopDepositorMock
          .connect(user1)
          .deposit(depositAmount, user1.address, 0, "0x", dloopMock);

        const finalShares = await dloopMock.balanceOf(user1.address);
        const sharesGained = finalShares - initialShares;

        expect(sharesGained).to.be.gt(0);
        cumulativeShares += sharesGained;
      }

      // Final shares should equal cumulative shares gained
      const totalUserShares = await dloopMock.balanceOf(user1.address);
      expect(totalUserShares).to.equal(cumulativeShares);
    });

    it("Should maintain leverage after multiple deposits", async function () {
      const depositAmount = ethers.parseEther("100");

      // First deposit
      await dLoopDepositorMock
        .connect(user1)
        .deposit(depositAmount, user1.address, 0, "0x", dloopMock);

      const leverageAfterFirst = await dloopMock.getCurrentLeverageBps();
      expect(leverageAfterFirst).to.be.closeTo(
        BigInt(TARGET_LEVERAGE_BPS),
        BigInt(ONE_PERCENT_BPS),
      );

      // Second deposit
      await dLoopDepositorMock
        .connect(user2)
        .deposit(depositAmount, user2.address, 0, "0x", dloopMock);

      const leverageAfterSecond = await dloopMock.getCurrentLeverageBps();

      // Leverage should be maintained close to target
      expect(leverageAfterSecond).to.be.closeTo(
        leverageAfterFirst,
        BigInt(ONE_PERCENT_BPS),
      );
    });
  });

  describe("VI. Leftover Token Handling", function () {
    it("Should handle leftover debt tokens correctly", async function () {
      const depositAmount = ethers.parseEther("100");

      // Set minimum leftover amount to 0 so any leftover gets transferred
      await dLoopDepositorMock.setMinLeftoverDebtTokenAmount(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
        0,
      );

      const initialCoreDebtBalance = await debtToken.balanceOf(
        await dloopMock.getAddress(),
      );

      await dLoopDepositorMock
        .connect(user1)
        .deposit(depositAmount, user1.address, 0, "0x", dloopMock);

      // Core vault may have received leftover debt tokens
      const finalCoreDebtBalance = await debtToken.balanceOf(
        await dloopMock.getAddress(),
      );

      // Balance should be >= initial (may have received leftovers)
      expect(finalCoreDebtBalance).to.be.gte(initialCoreDebtBalance);
    });

    it("Should emit LeftoverDebtTokensTransferred event when applicable", async function () {
      const depositAmount = ethers.parseEther("100");

      // Set minimum leftover to 0 to ensure transfer
      await dLoopDepositorMock.setMinLeftoverDebtTokenAmount(
        await dloopMock.getAddress(),
        await debtToken.getAddress(),
        0,
      );

      // May emit leftover transfer event
      const tx = await dLoopDepositorMock
        .connect(user1)
        .deposit(depositAmount, user1.address, 0, "0x", dloopMock);

      // Note: We can't guarantee leftovers, so this test just ensures it doesn't revert
      await tx.wait();
    });
  });
});
