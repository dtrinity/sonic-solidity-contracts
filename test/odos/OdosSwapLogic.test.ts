import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockRouter, mint } from "./utils/setup";

const { parseUnits } = ethers;

describe("OdosSwapLogic", function () {
  /**
   *
   */
  async function fixture() {
    const [deployer, receiver] = await ethers.getSigners();
    const tokenIn = await deployMintableERC20("TokenIn", "TIN");
    const tokenOut = await deployMintableERC20("TokenOut", "TOUT");
    const router = await deployMockRouter();

    // Deploy the library first
    const LibraryFactory = await ethers.getContractFactory("OdosSwapLogic");
    const library = await LibraryFactory.deploy();

    // Link the library when deploying the harness
    const HarnessFactory = await ethers.getContractFactory("OdosSwapLogicHarness", {
      libraries: {
        OdosSwapLogic: await library.getAddress(),
      },
    });
    const harness = await HarnessFactory.deploy();

    return { deployer, receiver, tokenIn, tokenOut, router, harness };
  }

  it("swapExactOutput refunds surplus correctly to receiver", async function () {
    const { receiver, tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange
    const amountOut = parseUnits("2000", 18);
    const amountInMaximum = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2500", 18); // More than requested (surplus scenario)

    const harnessAddr = await harness.getAddress();
    const receiverAddr = await receiver.getAddress();

    await mint(tokenIn, harnessAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(await tokenIn.getAddress(), await tokenOut.getAddress(), amountSpent, amountReceived, false);
    const swapData = router.interface.encodeFunctionData("performSwap");

    const receiverBalanceBefore = await tokenOut.balanceOf(receiverAddr);
    const harnessBalanceBefore = await tokenOut.balanceOf(harnessAddr);

    // Act - call swapExactOutput
    await (harness as any).callSwapExactOutput(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountOut,
      amountInMaximum,
      receiverAddr,
      swapData,
      await router.getAddress(),
    );

    // Assert
    const receiverBalanceAfter = await tokenOut.balanceOf(receiverAddr);
    const harnessBalanceAfter = await tokenOut.balanceOf(harnessAddr);

    // After fix, receiver receives surplus 500 tokens; harness keeps requested amount 2000.
    const expectedSurplus = amountReceived - amountOut;
    expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(expectedSurplus);
    expect(harnessBalanceAfter - harnessBalanceBefore).to.equal(amountOut);

    // Input tokens should be spent correctly
    const inputSpent = parseUnits("10000", 18) - (await tokenIn.balanceOf(harnessAddr));
    expect(inputSpent).to.equal(amountSpent);
  });

  it("swapExactOutput handles exact amount without refund", async function () {
    const { receiver, tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange - router delivers exactly what's requested
    const amountOut = parseUnits("2000", 18);
    const amountInMaximum = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2000", 18); // Exactly what's requested

    const harnessAddr = await harness.getAddress();
    const receiverAddr = await receiver.getAddress();

    await mint(tokenIn, harnessAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(await tokenIn.getAddress(), await tokenOut.getAddress(), amountSpent, amountReceived, false);
    const swapData = router.interface.encodeFunctionData("performSwap");

    const receiverBalanceBefore = await tokenOut.balanceOf(receiverAddr);
    const harnessBalanceBefore = await tokenOut.balanceOf(harnessAddr);

    // Act
    await (harness as any).callSwapExactOutput(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountOut,
      amountInMaximum,
      receiverAddr,
      swapData,
      await router.getAddress(),
    );

    // Assert
    const receiverBalanceAfter = await tokenOut.balanceOf(receiverAddr);
    const harnessBalanceAfter = await tokenOut.balanceOf(harnessAddr);

    // No surplus scenario - receiver should get nothing, harness keeps requested amount
    expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(0);
    expect(harnessBalanceAfter - harnessBalanceBefore).to.equal(amountReceived);
  });

  it("reverts when router delivers less than amountOut", async function () {
    const { receiver, tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange - router delivers less than requested
    const amountOut = parseUnits("2000", 18);
    const amountInMaximum = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("1500", 18); // Less than requested

    const harnessAddr = await harness.getAddress();
    const receiverAddr = await receiver.getAddress();

    await mint(tokenIn, harnessAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(await tokenIn.getAddress(), await tokenOut.getAddress(), amountSpent, amountReceived, false);
    const swapData = router.interface.encodeFunctionData("performSwap");

    // Act & Assert
    await expect(
      (harness as any).callSwapExactOutput(
        await tokenIn.getAddress(),
        await tokenOut.getAddress(),
        amountOut,
        amountInMaximum,
        receiverAddr,
        swapData,
        await router.getAddress(),
      ),
    ).to.be.reverted; // Will revert from OdosSwapUtils.executeSwapOperation
  });
});
