import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
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

describe("DLoopDepositorBase - MinLeftoverDebtTokenAmount", function () {
  let deployer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;

  let dLoopCore: DLoopCoreMock;
  let depositorMock: DLoopDepositorMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestERC20FlashMintable;
  let simpleDEXMock: SimpleDEXMock;
  let flashLender: TestERC20FlashMintable;

  // Additional test tokens
  let tokenA: TestMintableERC20;
  let tokenB: TestMintableERC20;
  let tokenC: TestMintableERC20;

  const TARGET_LEVERAGE_BPS = 300 * ONE_PERCENT_BPS; // 3x leverage
  const LOWER_BOUND_BPS = 200 * ONE_PERCENT_BPS; // 2x leverage
  const UPPER_BOUND_BPS = 400 * ONE_PERCENT_BPS; // 4x leverage
  const MAX_SUBSIDY_BPS = 1 * ONE_PERCENT_BPS; // 1%

  /**
   * Deploy fixture for DLoopDepositorBase tests
   */
  async function deployFixture(): Promise<{
    dLoopCore: DLoopCoreMock;
    depositorMock: DLoopDepositorMock;
    collateralToken: TestMintableERC20;
    debtToken: TestERC20FlashMintable;
    flashLender: TestERC20FlashMintable;
    simpleDEXMock: SimpleDEXMock;
    tokenA: TestMintableERC20;
    tokenB: TestMintableERC20;
    tokenC: TestMintableERC20;
    deployer: HardhatEthersSigner;
    user1: HardhatEthersSigner;
    user2: HardhatEthersSigner;
    nonOwner: HardhatEthersSigner;
  }> {
    const accounts = await ethers.getSigners();
    [deployer, user1, user2, nonOwner] = accounts;

    // Deploy test tokens
    const TestMintableERC20Factory =
      await ethers.getContractFactory("TestMintableERC20");
    collateralToken = await TestMintableERC20Factory.deploy(
      "Collateral Token",
      "COLL",
      18,
    );

    const TestERC20FlashMintableFactory = await ethers.getContractFactory(
      "TestERC20FlashMintable",
    );
    debtToken = await TestERC20FlashMintableFactory.deploy(
      "Debt Token",
      "DEBT",
      18,
    );
    flashLender = await TestERC20FlashMintableFactory.deploy(
      "Flash Lender",
      "FLASH",
      18,
    );

    // Additional tokens for multi-token tests
    tokenA = await TestMintableERC20Factory.deploy("Token A", "TOKA", 18);
    tokenB = await TestMintableERC20Factory.deploy("Token B", "TOKB", 18);
    tokenC = await TestMintableERC20Factory.deploy("Token C", "TOKC", 18);

    // Deploy DLoopCoreMock
    const DLoopCoreMockFactory =
      await ethers.getContractFactory("DLoopCoreMock");
    dLoopCore = await DLoopCoreMockFactory.deploy(
      "DLoop Core Mock",
      "DLM",
      collateralToken.target,
      debtToken.target,
      TARGET_LEVERAGE_BPS,
      LOWER_BOUND_BPS,
      UPPER_BOUND_BPS,
      MAX_SUBSIDY_BPS,
      deployer.address, // mockPool
    );

    // Deploy SimpleDEXMock
    const SimpleDEXMockFactory =
      await ethers.getContractFactory("SimpleDEXMock");
    simpleDEXMock = await SimpleDEXMockFactory.deploy();

    // Deploy DLoopDepositorMock
    const DLoopDepositorMockFactory =
      await ethers.getContractFactory("DLoopDepositorMock");
    depositorMock = await DLoopDepositorMockFactory.deploy(
      flashLender.target,
      simpleDEXMock.target,
    );

    return {
      dLoopCore,
      depositorMock,
      collateralToken,
      debtToken,
      flashLender,
      simpleDEXMock,
      tokenA,
      tokenB,
      tokenC,
      deployer,
      user1,
      user2,
      nonOwner,
    };
  }

  beforeEach(async function () {
    const fixture = await deployFixture();
    dLoopCore = fixture.dLoopCore;
    depositorMock = fixture.depositorMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    flashLender = fixture.flashLender;
    simpleDEXMock = fixture.simpleDEXMock;
    tokenA = fixture.tokenA;
    tokenB = fixture.tokenB;
    tokenC = fixture.tokenC;
    deployer = fixture.deployer;
    user1 = fixture.user1;
    user2 = fixture.user2;
    nonOwner = fixture.nonOwner;
  });

  describe("Access Control", function () {
    it("should revert when non-owner tries to set min leftover amount", async function () {
      await expect(
        depositorMock
          .connect(nonOwner)
          .setMinLeftoverDebtTokenAmount(
            dLoopCore.target,
            debtToken.target,
            100,
          ),
      ).to.be.revertedWithCustomError(
        depositorMock,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("Adding Fresh Token (Baseline Behavior)", function () {
    it("should correctly add a new token with non-zero amount", async function () {
      const minAmount = 100;

      // Check initial state
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
        ),
      ).to.equal(0);

      // Array should be empty - check by trying to access and expecting revert
      await expect(depositorMock.existingDebtTokens(0)).to.be.reverted;

      // Set min leftover amount
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
          minAmount,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountSet")
        .withArgs(dLoopCore.target, debtToken.target, minAmount);

      // Verify state changes
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
        ),
      ).to.equal(minAmount);
      expect(await depositorMock.existingDebtTokens(0)).to.equal(
        debtToken.target,
      );

      // Array should have length 1
      await expect(depositorMock.existingDebtTokens(1)).to.be.reverted;
    });

    it("should update existing token with different non-zero amount", async function () {
      const initialAmount = 100;
      const updatedAmount = 50;

      // Add token initially
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        initialAmount,
      );

      // Update with different amount
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
          updatedAmount,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountSet")
        .withArgs(dLoopCore.target, debtToken.target, updatedAmount);

      // Verify state changes
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
        ),
      ).to.equal(updatedAmount);
      expect(await depositorMock.existingDebtTokens(0)).to.equal(
        debtToken.target,
      );

      // Array should still have length 1 (no duplicates)
      await expect(depositorMock.existingDebtTokens(1)).to.be.reverted;
    });
  });

  describe("Removing Existing Token (New Behavior)", function () {
    beforeEach(async function () {
      // Add token first
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        100,
      );
    });

    it("should correctly remove an existing token when amount is set to 0", async function () {
      // Remove token by setting amount to 0
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
          0,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountRemoved")
        .withArgs(dLoopCore.target, debtToken.target);

      // Verify state changes
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
        ),
      ).to.equal(0);

      // Array should be empty
      await expect(depositorMock.existingDebtTokens(0)).to.be.reverted;
    });

    it("should handle removal from middle of array correctly", async function () {
      // Add multiple tokens (using collateralToken as additional debt token for test)
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenA.target,
        100,
      );
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenB.target,
        200,
      );
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenC.target,
        300,
      );

      // Verify array has 4 elements: [debtToken, tokenA, tokenB, tokenC]
      expect(await depositorMock.existingDebtTokens(0)).to.equal(
        debtToken.target,
      );
      expect(await depositorMock.existingDebtTokens(1)).to.equal(tokenA.target);
      expect(await depositorMock.existingDebtTokens(2)).to.equal(tokenB.target);
      expect(await depositorMock.existingDebtTokens(3)).to.equal(tokenC.target);

      // Remove middle element (tokenB)
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          tokenB.target,
          0,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountRemoved")
        .withArgs(dLoopCore.target, tokenB.target);

      // Verify tokenB is removed and array is properly compacted
      const token0 = await depositorMock.existingDebtTokens(0);
      const token1 = await depositorMock.existingDebtTokens(1);
      const token2 = await depositorMock.existingDebtTokens(2);

      // Array should now contain 3 elements and NOT contain tokenB
      const remainingTokens = [token0, token1, token2];
      expect(remainingTokens).to.include(debtToken.target);
      expect(remainingTokens).to.include(tokenA.target);
      expect(remainingTokens).to.include(tokenC.target);
      expect(remainingTokens).to.not.include(tokenB.target);

      // Array should have exactly 3 elements
      await expect(depositorMock.existingDebtTokens(3)).to.be.reverted;

      // Verify mapping is cleared
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          tokenB.target,
        ),
      ).to.equal(0);
    });
  });

  describe("Removing Non-existing Token (Graceful No-op)", function () {
    it("should handle removal of non-existing token gracefully", async function () {
      // Try to remove a token that was never added
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          tokenA.target,
          0,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountRemoved")
        .withArgs(dLoopCore.target, tokenA.target);

      // Mapping should remain 0
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          tokenA.target,
        ),
      ).to.equal(0);

      // Array should remain empty
      await expect(depositorMock.existingDebtTokens(0)).to.be.reverted;
    });

    it("should handle removal of already removed token gracefully", async function () {
      // Add token
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        100,
      );

      // Remove token
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        0,
      );

      // Try to remove again
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
          0,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountRemoved")
        .withArgs(dLoopCore.target, debtToken.target);

      // State should remain unchanged
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
        ),
      ).to.equal(0);
      await expect(depositorMock.existingDebtTokens(0)).to.be.reverted;
    });
  });

  describe("Setting to Zero then Re-adding", function () {
    it("should behave like fresh add after removal", async function () {
      const initialAmount = 100;
      const newAmount = 200;

      // Add token
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        initialAmount,
      );

      // Remove token
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        0,
      );

      // Re-add token
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
          newAmount,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountSet")
        .withArgs(dLoopCore.target, debtToken.target, newAmount);

      // Verify state
      expect(
        await depositorMock.minLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
        ),
      ).to.equal(newAmount);
      expect(await depositorMock.existingDebtTokens(0)).to.equal(
        debtToken.target,
      );
      await expect(depositorMock.existingDebtTokens(1)).to.be.reverted;
    });
  });

  describe("Integration with Restricted Rescue Tokens", function () {
    it("should return updated array in getRestrictedRescueTokens after modifications", async function () {
      // Initially should be empty array
      const initialTokens = await depositorMock.getRestrictedRescueTokens();
      expect(initialTokens).to.deep.equal([]);

      // Add some tokens
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenA.target,
        100,
      );
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenB.target,
        200,
      );

      // Check restricted tokens
      const tokensAfterAdd = await depositorMock.getRestrictedRescueTokens();
      expect(tokensAfterAdd).to.include(tokenA.target);
      expect(tokensAfterAdd).to.include(tokenB.target);
      expect(tokensAfterAdd.length).to.equal(2);

      // Remove one token
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenA.target,
        0,
      );

      // Check restricted tokens again
      const tokensAfterRemoval =
        await depositorMock.getRestrictedRescueTokens();
      expect(tokensAfterRemoval).to.not.include(tokenA.target);
      expect(tokensAfterRemoval).to.include(tokenB.target);
      expect(tokensAfterRemoval.length).to.equal(1);
    });
  });

  describe("Edge Cases", function () {
    it("should handle multiple removals from different positions", async function () {
      // Add 5 tokens
      const tokens = [debtToken, tokenA, tokenB, tokenC, collateralToken];

      for (let i = 0; i < tokens.length; i++) {
        await depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          tokens[i].target,
          (i + 1) * 100,
        );
      }

      // Verify all tokens are added
      for (let i = 0; i < tokens.length; i++) {
        expect(await depositorMock.existingDebtTokens(i)).to.equal(
          tokens[i].target,
        );
      }

      // Remove first, middle, and last tokens
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        0,
      );
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenB.target,
        0,
      );
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        collateralToken.target,
        0,
      );

      // Should have exactly 2 tokens left
      const remainingTokens = [
        await depositorMock.existingDebtTokens(0),
        await depositorMock.existingDebtTokens(1),
      ];

      expect(remainingTokens).to.include(tokenA.target);
      expect(remainingTokens).to.include(tokenC.target);
      expect(remainingTokens.length).to.equal(2);

      // Array should have exactly 2 elements
      await expect(depositorMock.existingDebtTokens(2)).to.be.reverted;
    });

    it("should handle removal when array has only one element", async function () {
      // Add one token
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        debtToken.target,
        100,
      );

      // Verify array has one element
      expect(await depositorMock.existingDebtTokens(0)).to.equal(
        debtToken.target,
      );
      await expect(depositorMock.existingDebtTokens(1)).to.be.reverted;

      // Remove the only token
      await expect(
        depositorMock.setMinLeftoverDebtTokenAmount(
          dLoopCore.target,
          debtToken.target,
          0,
        ),
      )
        .to.emit(depositorMock, "MinLeftoverDebtTokenAmountRemoved")
        .withArgs(dLoopCore.target, debtToken.target);

      // Array should be empty
      await expect(depositorMock.existingDebtTokens(0)).to.be.reverted;
    });
  });

  describe("Gas Optimization", function () {
    it("should have reasonable gas costs for removal operations", async function () {
      // Add multiple tokens
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenA.target,
        100,
      );
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenB.target,
        200,
      );
      await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenC.target,
        300,
      );

      // Measure gas for removal (should be reasonable, < 50k)
      const tx = await depositorMock.setMinLeftoverDebtTokenAmount(
        dLoopCore.target,
        tokenB.target,
        0,
      );
      const receipt = await tx.wait();
      expect(receipt!.gasUsed).to.be.lessThan(50000);
    });
  });
});
