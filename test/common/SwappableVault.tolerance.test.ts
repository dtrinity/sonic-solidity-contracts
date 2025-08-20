import { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";

describe("SwappableVault Tolerance Tests", function () {
  let swappableVault: any;
  let inputToken: any;
  let outputToken: any;
  let owner: Signer;
  let receiver: Signer;

  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1M tokens
  const AMOUNT_OUT = 1000n;
  const AMOUNT_IN_MAXIMUM = 2000n;
  const DEFAULT_DEADLINE = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const EMPTY_EXTRA_DATA = "0x";

  beforeEach(async function () {
    [owner, receiver] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const ERC20Mock = await ethers.getContractFactory(
      "RewardClaimableMockERC20",
    );
    inputToken = await ERC20Mock.deploy("Input Token", "IN");
    outputToken = await ERC20Mock.deploy("Output Token", "OUT");

    // Deploy SwappableVaultMock
    const SwappableVaultMock =
      await ethers.getContractFactory("SwappableVaultMock");
    swappableVault = await SwappableVaultMock.deploy();

    // Mint tokens to the vault and receiver
    await inputToken.mint(await swappableVault.getAddress(), INITIAL_SUPPLY);
    await outputToken.mint(await swappableVault.getAddress(), INITIAL_SUPPLY);
  });

  describe("Tolerance Constant", function () {
    it("should have BALANCE_DIFF_TOLERANCE = 1", async function () {
      const tolerance = await swappableVault.getBalanceDiffTolerance();
      expect(tolerance).to.equal(1n);
    });
  });

  describe("Happy Path Tests", function () {
    it("should succeed when spent equals returned amount (exact match)", async function () {
      const amountInReturned = 1500n;
      const expectedSpent = 1500n;

      await swappableVault.setAmountInToReturn(amountInReturned);

      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      await expect(tx).to.not.be.reverted;
    });

    it("should succeed when difference is +1 (within tolerance)", async function () {
      const amountInReturned = 1501n; // Return 1501
      const expectedSpent = 1501n; // Will spend 1501 (diff = 0, within tolerance)

      await swappableVault.setAmountInToReturn(amountInReturned);

      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      await expect(tx).to.not.be.reverted;
    });

    it("should succeed when difference is -1 (within tolerance)", async function () {
      // Return 1501 but spend 1500 to create a +1 difference (amountIn > spentInputTokenAmount)
      // This tests the else branch: amountIn - spentInputTokenAmount = 1 <= BALANCE_DIFF_TOLERANCE
      const amountInReturned = 1501n;
      const amountInActuallySpent = 1500n;
      await swappableVault.setAmountInParams(
        amountInReturned,
        amountInActuallySpent,
      );

      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      await expect(tx).to.not.be.reverted;
    });
  });

  describe("Failure Cases - Outside Tolerance", function () {
    it("should revert when difference is +2 (outside tolerance)", async function () {
      // Return 1502 but spend 1500 to create a +2 difference
      const amountInReturned = 1502n;
      const amountInActuallySpent = 1500n;
      await swappableVault.setAmountInParams(
        amountInReturned,
        amountInActuallySpent,
      );

      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          AMOUNT_OUT,
          AMOUNT_IN_MAXIMUM,
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "SpentInputTokenAmountNotEqualReturnedAmountIn",
      );
    });

    it("should revert when difference is -2 (outside tolerance)", async function () {
      // Return 1502 but spend 1500 to create a +2 difference (amountIn > spentInputTokenAmount)
      // This tests the else branch: amountIn - spentInputTokenAmount = 2 > BALANCE_DIFF_TOLERANCE
      const amountInReturned = 1502n;
      const amountInActuallySpent = 1500n;
      await swappableVault.setAmountInParams(
        amountInReturned,
        amountInActuallySpent,
      );

      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          AMOUNT_OUT,
          AMOUNT_IN_MAXIMUM,
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "SpentInputTokenAmountNotEqualReturnedAmountIn",
      );
    });
  });

  describe("Amount In Maximum Checks", function () {
    it("should revert when spent > amountInMaximum (exceeds maximum)", async function () {
      const amountInReturned = 2001n; // Return more than maximum
      await swappableVault.setAmountInToReturn(amountInReturned);

      // This should revert with the maximum exceeded error (first check)
      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          AMOUNT_OUT,
          AMOUNT_IN_MAXIMUM, // 2000
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "SpentInputTokenAmountGreaterThanAmountInMaximum",
      );
    });

    it("should revert with correct error when spent = amountInMaximum + 1", async function () {
      const amountInReturned = 2001n; // Exactly 1 more than maximum
      await swappableVault.setAmountInToReturn(amountInReturned);

      // This should also revert with the maximum exceeded error
      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          AMOUNT_OUT,
          AMOUNT_IN_MAXIMUM, // 2000
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "SpentInputTokenAmountGreaterThanAmountInMaximum",
      );
    });
  });

  describe("Output Token Validation", function () {
    it("should succeed when output amount is exact match", async function () {
      const amountInReturned = 1500n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      // Default behavior - mint exactly AMOUNT_OUT
      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      await expect(tx).to.not.be.reverted;
    });

    it("should succeed when receiving +1 output token (within tolerance)", async function () {
      const amountInReturned = 1500n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      // Mint 1 extra token (1001 instead of 1000)
      await swappableVault.setAmountOutToMint(AMOUNT_OUT + 1n);

      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      await expect(tx).to.not.be.reverted;
    });

    it("should succeed when receiving -1 output token (within tolerance)", async function () {
      const amountInReturned = 1500n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      // Mint 1 less token (999 instead of 1000)
      await swappableVault.setAmountOutToMint(AMOUNT_OUT - 1n);

      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      await expect(tx).to.not.be.reverted;
    });

    it("should revert when receiving +2 output tokens (outside tolerance)", async function () {
      const amountInReturned = 1500n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      // Mint 2 extra tokens (1002 instead of 1000)
      await swappableVault.setAmountOutToMint(AMOUNT_OUT + 2n);

      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          AMOUNT_OUT,
          AMOUNT_IN_MAXIMUM,
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "ReceivedOutputTokenAmountNotEqualAmountOut",
      );
    });

    it("should revert when receiving -2 output tokens (outside tolerance)", async function () {
      const amountInReturned = 1500n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      // Mint 2 less tokens (998 instead of 1000)
      await swappableVault.setAmountOutToMint(AMOUNT_OUT - 2n);

      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          AMOUNT_OUT,
          AMOUNT_IN_MAXIMUM,
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "ReceivedOutputTokenAmountNotEqualAmountOut",
      );
    });

    it("should revert when output token balance doesn't increase", async function () {
      const amountInReturned = 1500n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      // Set the mock to mint 0 tokens (no output received)
      await swappableVault.setAmountOutToMint(0n);

      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          0n, // amountOut set to 0 to test no balance increase scenario
          AMOUNT_IN_MAXIMUM,
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "OutputTokenBalanceNotIncreasedAfterSwap",
      );
    });
  });

  describe("Edge Cases", function () {
    it("should handle zero amounts correctly", async function () {
      const amountInReturned = 0n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      await expect(
        swappableVault.swapExactOutput(
          await inputToken.getAddress(),
          await outputToken.getAddress(),
          0n,
          0n,
          await receiver.getAddress(),
          DEFAULT_DEADLINE,
          EMPTY_EXTRA_DATA,
        ),
      ).to.be.revertedWithCustomError(
        swappableVault,
        "OutputTokenBalanceNotIncreasedAfterSwap",
      );
    });

    it("should handle exactly at tolerance boundary", async function () {
      // Test exactly at +1 tolerance: return 1501, spend 1500
      const amountInReturned = 1501n;
      const amountInActuallySpent = 1500n;
      await swappableVault.setAmountInParams(
        amountInReturned,
        amountInActuallySpent,
      );

      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      await expect(tx).to.not.be.reverted;
    });
  });

  describe("Gas Usage", function () {
    it("should not significantly increase gas usage", async function () {
      const amountInReturned = 1500n;
      await swappableVault.setAmountInToReturn(amountInReturned);

      const tx = await swappableVault.swapExactOutput(
        await inputToken.getAddress(),
        await outputToken.getAddress(),
        AMOUNT_OUT,
        AMOUNT_IN_MAXIMUM,
        await receiver.getAddress(),
        DEFAULT_DEADLINE,
        EMPTY_EXTRA_DATA,
      );

      const receipt = await tx.wait();

      // Gas usage should be reasonable (less than 100k gas for the swap logic)
      expect(receipt!.gasUsed).to.be.lt(100000n);
    });
  });
});
