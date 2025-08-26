import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockRouter, mint } from "./utils/setup";

const { parseUnits } = ethers;

describe("BaseOdosSellAdapter - Surplus Handling", function () {
  /**
   *
   */
  async function fixture() {
    const [deployer] = await ethers.getSigners();
    const tokenIn = await deployMintableERC20("TokenIn", "TIN");
    const tokenOut = await deployMintableERC20("TokenOut", "TOUT");
    const router = await deployMockRouter();

    // Deploy test sell adapter
    const TestSellAdapterFactory =
      await ethers.getContractFactory("TestSellAdapter");
    const adapter = await TestSellAdapterFactory.deploy(
      await router.getAddress(),
    );

    return { deployer, tokenIn, tokenOut, router, adapter };
  }

  it("[NEED-TO-FIX-AUDIT-ISSUE] should handle surplus correctly when router delivers more than minimum", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange
    const amountToSell = parseUnits("1000", 18); // Amount to sell
    const minAmountToReceive = parseUnits("1500", 18); // Minimum expected
    const amountSpent = parseUnits("1000", 18); // Actual amount spent by router (should equal amountToSell)
    const amountReceived = parseUnits("2000", 18); // Router delivers MORE than minimum (surplus)

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

    // Act - call sell function
    const swapData = router.interface.encodeFunctionData("performSwap");
    const result = await adapter.sell(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountToSell,
      minAmountToReceive,
      swapData,
    );

    // Assert
    const adapterBalanceAfter = await tokenOut.balanceOf(adapterAddr);

    // Currently the adapter will receive ALL tokens from router (2000)
    // But it should ideally handle the surplus properly - either:
    // 1. Only keep what was expected/minimum and refund surplus elsewhere, OR
    // 2. Have a mechanism to track and handle surplus tokens
    // THIS TEST CAPTURES THE CURRENT BEHAVIOR - adapter gets all surplus
    expect(adapterBalanceAfter - adapterBalanceBefore).to.equal(
      amountReceived,
      "Adapter currently keeps all tokens including surplus (demonstrates audit issue)",
    );

    // Function should return the amount received - but we need to await the call properly
    // Note: The current implementation will return amount received correctly

    // Verify input tokens were spent correctly
    const inputSpent =
      parseUnits("10000", 18) - (await tokenIn.balanceOf(adapterAddr));
    expect(inputSpent).to.equal(
      amountSpent,
      "Correct amount of input tokens should be spent",
    );
  });

  it("[NEED-TO-FIX-AUDIT-ISSUE] demonstrates large surplus accumulation in sell operations", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange - router delivers much more than minimum
    const amountToSell = parseUnits("500", 18); // Amount to sell
    const minAmountToReceive = parseUnits("800", 18); // Minimum expected
    const amountSpent = parseUnits("500", 18); // Actual amount spent
    const amountReceived = parseUnits("4000", 18); // Router delivers 5x more than minimum (large surplus)

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
    await adapter.sell(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountToSell,
      minAmountToReceive,
      swapData,
    );

    // Assert
    const adapterBalanceAfter = await tokenOut.balanceOf(adapterAddr);

    // This demonstrates the audit issue - adapter accumulates large surplus
    const surplus = amountReceived - minAmountToReceive; // 3200 tokens
    expect(adapterBalanceAfter - adapterBalanceBefore).to.equal(
      amountReceived,
      "Adapter accumulates large surplus tokens in sell operations (demonstrates audit issue)",
    );

    // The surplus should be handled properly but currently isn't
    expect(surplus).to.equal(
      parseUnits("3200", 18),
      "Large surplus demonstrates potential for token accumulation in sell operations",
    );
  });

  it("[NEED-TO-FIX-AUDIT-ISSUE] surplus handling should be consistent across multiple operations", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange - simulate multiple sell operations with surplus
    const adapterAddr = await adapter.getAddress();
    await mint(tokenIn, adapterAddr, parseUnits("10000", 18));

    let totalSurplus = BigInt(0);
    const swapData = router.interface.encodeFunctionData("performSwap");

    // First operation
    const amountToSell1 = parseUnits("500", 18);
    const minAmount1 = parseUnits("800", 18);
    const amountReceived1 = parseUnits("1200", 18); // 400 surplus

    await mint(tokenOut, await router.getAddress(), amountReceived1);
    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountToSell1,
      amountReceived1,
      false,
    );

    const balanceBefore1 = await tokenOut.balanceOf(adapterAddr);
    await adapter.sell(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountToSell1,
      minAmount1,
      swapData,
    );
    const balanceAfter1 = await tokenOut.balanceOf(adapterAddr);
    totalSurplus += amountReceived1 - minAmount1;

    // Second operation
    const amountToSell2 = parseUnits("300", 18);
    const minAmount2 = parseUnits("500", 18);
    const amountReceived2 = parseUnits("900", 18); // 400 surplus

    await mint(tokenOut, await router.getAddress(), amountReceived2);
    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountToSell2,
      amountReceived2,
      false,
    );

    await adapter.sell(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountToSell2,
      minAmount2,
      swapData,
    );
    const balanceAfter2 = await tokenOut.balanceOf(adapterAddr);
    totalSurplus += amountReceived2 - minAmount2;

    // Assert
    const totalReceived = amountReceived1 + amountReceived2;
    expect(balanceAfter2 - balanceBefore1).to.equal(
      totalReceived,
      "Adapter accumulates surplus from multiple operations",
    );

    expect(totalSurplus).to.equal(
      parseUnits("800", 18),
      "Total surplus accumulation demonstrates the audit issue",
    );
  });

  it("works correctly when exact minimum amount received", async function () {
    const { tokenIn, tokenOut, router, adapter } = await fixture();

    // Arrange - router delivers exactly the minimum (no surplus)
    const amountToSell = parseUnits("1000", 18);
    const minAmountToReceive = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("1500", 18); // Exactly the minimum

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
    await adapter.sell(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountToSell,
      minAmountToReceive,
      swapData,
    );

    // Assert
    const adapterBalanceAfter = await tokenOut.balanceOf(adapterAddr);

    // No surplus case works correctly
    expect(adapterBalanceAfter - adapterBalanceBefore).to.equal(
      amountReceived,
      "Adapter receives exactly minimum when no surplus",
    );
  });
});
