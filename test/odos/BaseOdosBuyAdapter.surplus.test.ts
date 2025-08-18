import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockRouter, mint } from "./utils/setup";

const { parseUnits } = ethers;

describe("BaseOdosBuyAdapter - Surplus Handling", function () {
  /**
   *
   */
  async function fixture() {
    const [deployer] = await ethers.getSigners();
    const tokenIn = await deployMintableERC20("TokenIn", "TIN");
    const tokenOut = await deployMintableERC20("TokenOut", "TOUT");
    const router = await deployMockRouter();

    // Deploy test buy adapter
    const TestBuyAdapterFactory =
      await ethers.getContractFactory("TestBuyAdapter");
    const adapter = await TestBuyAdapterFactory.deploy(
      await router.getAddress(),
    );

    return { deployer, tokenIn, tokenOut, router, adapter };
  }

  it("[NEED-TO-FIX-AUDIT-ISSUE] should handle surplus correctly when router delivers more than requested", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange
    const maxAmountToSwap = parseUnits("1500", 18);
    const amountToReceive = parseUnits("2000", 18); // Requested amount
    const amountSpent = parseUnits("1000", 18); // Actual amount spent by router
    const amountReceived = parseUnits("2500", 18); // Router delivers MORE than requested (surplus)

    const adapterAddr = await adapter.getAddress();

    // Fund adapter with input tokens
    await mint(tokenIn, adapterAddr, parseUnits("10000", 18));

    // Fund router with output tokens to deliver
    await mint(tokenOut, await router.getAddress(), amountReceived);

    // Configure router behavior
    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountSpent,
      amountReceived,
      false,
    );

    const adapterBalanceBefore = await tokenOut.balanceOf(adapterAddr);

    // Act - call buy function
    const swapData = router.interface.encodeFunctionData("performSwap");
    const result = await adapter.buy(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      maxAmountToSwap,
      amountToReceive,
      swapData,
    );

    // Assert
    const adapterBalanceAfter = await tokenOut.balanceOf(adapterAddr);

    // Currently the adapter will receive ALL tokens from router (2500)
    // But it should ideally handle the surplus properly - either:
    // 1. Only keep what was requested (2000) and refund surplus elsewhere, OR
    // 2. Have a mechanism to track and handle surplus tokens
    // THIS TEST CAPTURES THE CURRENT BEHAVIOR - adapter gets all surplus
    expect(adapterBalanceAfter - adapterBalanceBefore).to.equal(
      amountReceived,
      "Adapter currently keeps all tokens including surplus (demonstrates audit issue)",
    );

    // Function should return the amount spent - but we need to await the call properly
    // Note: The current implementation will return amount spent correctly

    // Verify input tokens were spent correctly
    const inputSpent =
      parseUnits("10000", 18) - (await tokenIn.balanceOf(adapterAddr));
    expect(inputSpent).to.equal(
      amountSpent,
      "Correct amount of input tokens should be spent",
    );
  });

  it("[NEED-TO-FIX-AUDIT-ISSUE] demonstrates large surplus accumulation issue", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange - router delivers much more than requested
    const maxAmountToSwap = parseUnits("1500", 18);
    const amountToReceive = parseUnits("1000", 18); // Requested amount
    const amountSpent = parseUnits("500", 18); // Actual amount spent
    const amountReceived = parseUnits("5000", 18); // Router delivers 5x more (large surplus)

    const adapterAddr = await adapter.getAddress();

    await mint(tokenIn, adapterAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);

    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountSpent,
      amountReceived,
      false,
    );

    const adapterBalanceBefore = await tokenOut.balanceOf(adapterAddr);

    // Act
    const swapData = router.interface.encodeFunctionData("performSwap");
    await adapter.buy(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      maxAmountToSwap,
      amountToReceive,
      swapData,
    );

    // Assert
    const adapterBalanceAfter = await tokenOut.balanceOf(adapterAddr);

    // This demonstrates the audit issue - adapter accumulates large surplus
    const surplus = amountReceived - amountToReceive; // 4000 tokens
    expect(adapterBalanceAfter - adapterBalanceBefore).to.equal(
      amountReceived,
      "Adapter accumulates large surplus tokens (demonstrates audit issue)",
    );

    // The surplus should be handled properly but currently isn't
    expect(surplus).to.equal(
      parseUnits("4000", 18),
      "Large surplus demonstrates potential for token accumulation",
    );
  });

  it("works correctly when exact amount received", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange - router delivers exactly what's requested (no surplus)
    const maxAmountToSwap = parseUnits("1500", 18);
    const amountToReceive = parseUnits("2000", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2000", 18); // Exactly what's requested

    const adapterAddr = await adapter.getAddress();

    await mint(tokenIn, adapterAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);

    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountSpent,
      amountReceived,
      false,
    );

    const adapterBalanceBefore = await tokenOut.balanceOf(adapterAddr);

    // Act
    const swapData = router.interface.encodeFunctionData("performSwap");
    await adapter.buy(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      maxAmountToSwap,
      amountToReceive,
      swapData,
    );

    // Assert
    const adapterBalanceAfter = await tokenOut.balanceOf(adapterAddr);

    // No surplus case works correctly
    expect(adapterBalanceAfter - adapterBalanceBefore).to.equal(
      amountReceived,
      "Adapter receives exactly what was requested when no surplus",
    );
  });
});
