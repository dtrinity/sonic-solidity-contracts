import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockRouter, mint } from "./utils/setup";

const { parseUnits } = ethers;

describe("BaseOdosBuyAdapter", function () {
  /**
   *
   */
  async function fixture() {
    const [deployer] = await ethers.getSigners();
    const tokenIn = await deployMintableERC20("TokenIn", "TIN");
    const tokenOut = await deployMintableERC20("TokenOut", "TOUT");
    const router = await deployMockRouter();

    const AdapterFactory = await ethers.getContractFactory("TestBuyAdapter");
    const adapter = await AdapterFactory.deploy(await router.getAddress());

    return { deployer, tokenIn, tokenOut, router, adapter };
  }

  it("executes happy-path buy with correct amounts and event", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2000", 18);
    const maxAmountToSwap = parseUnits("1500", 18);

    const adapterAddr = await adapter.getAddress();
    await mint(tokenIn, adapterAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(await tokenIn.getAddress(), await tokenOut.getAddress(), amountSpent, amountReceived, false);
    const swapData = router.interface.encodeFunctionData("performSwap");

    const balanceInBefore = await tokenIn.balanceOf(adapterAddr);
    const balanceOutBefore = await tokenOut.balanceOf(adapterAddr);

    // Act
    const tx = await (adapter as any).buy(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      maxAmountToSwap,
      amountReceived,
      swapData,
    );

    // Assert
    const balanceInAfter = await tokenIn.balanceOf(adapterAddr);
    const balanceOutAfter = await tokenOut.balanceOf(adapterAddr);

    expect(balanceInBefore - balanceInAfter).to.equal(amountSpent);
    expect(balanceOutAfter - balanceOutBefore).to.equal(amountReceived);

    // Check event emission
    await expect(tx)
      .to.emit(adapter, "Bought")
      .withArgs(await tokenIn.getAddress(), await tokenOut.getAddress(), amountSpent, amountReceived);
  });

  it("reverts when adapter has insufficient balance", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2000", 18);
    const maxAmountToSwap = parseUnits("1500", 18);

    // Only mint 500 tokens but try to swap 1500
    await mint(tokenIn, await adapter.getAddress(), parseUnits("500", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(await tokenIn.getAddress(), await tokenOut.getAddress(), amountSpent, amountReceived, false);
    const swapData = router.interface.encodeFunctionData("performSwap");

    await expect(
      (adapter as any).buy(await tokenIn.getAddress(), await tokenOut.getAddress(), maxAmountToSwap, amountReceived, swapData),
    ).to.be.revertedWithCustomError(adapter, "InsufficientBalanceBeforeSwap");
  });

  it("reverts when router delivers less than requested", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("1500", 18); // Less than requested 2000
    const maxAmountToSwap = parseUnits("1500", 18);

    await mint(tokenIn, await adapter.getAddress(), parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(await tokenIn.getAddress(), await tokenOut.getAddress(), amountSpent, amountReceived, false);
    const swapData = router.interface.encodeFunctionData("performSwap");

    await expect(
      (adapter as any).buy(
        await tokenIn.getAddress(),
        await tokenOut.getAddress(),
        maxAmountToSwap,
        parseUnits("2000", 18), // Requesting more than router will deliver
        swapData,
      ),
    ).to.be.revertedWithCustomError(adapter, "InsufficientOutput");
  });
});
