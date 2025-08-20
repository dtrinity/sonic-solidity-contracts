import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockRouter, mint } from "./utils/setup";

const { parseUnits } = ethers;

describe("OdosSwapLogic - Surplus Refund", function () {
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
    const HarnessFactory = await ethers.getContractFactory(
      "OdosSwapLogicHarness",
      {
        libraries: {
          OdosSwapLogic: await library.getAddress(),
        },
      },
    );
    const harness = await HarnessFactory.deploy();

    return { deployer, receiver, tokenIn, tokenOut, router, harness };
  }

  it("refunds surplus output to receiver", async function () {
    const { receiver, tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange
    const amountOut = parseUnits("2000", 18); // Requested amount
    const amountInMaximum = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2500", 18); // Router delivers MORE than requested (surplus scenario)
    const expectedSurplus = amountReceived - amountOut; // 500 tokens

    const harnessAddr = await harness.getAddress();
    const receiverAddr = await receiver.getAddress();

    await mint(tokenIn, harnessAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountSpent,
      amountReceived,
      false,
    );
    const swapData = router.interface.encodeFunctionData("performSwap");

    const receiverBalanceBefore = await tokenOut.balanceOf(receiverAddr);
    const harnessBalanceBefore = await tokenOut.balanceOf(harnessAddr);

    // Act - call swapExactOutput
    const result = await (harness as any).callSwapExactOutput(
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

    // Receiver should receive the surplus (500 tokens)
    expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(
      expectedSurplus,
    );

    // Harness should retain exactly the requested output amount
    expect(harnessBalanceAfter - harnessBalanceBefore).to.equal(amountOut);

    // Input tokens should be spent correctly
    const inputSpent =
      parseUnits("10000", 18) - (await tokenIn.balanceOf(harnessAddr));
    expect(inputSpent).to.equal(
      amountSpent,
      "Correct amount of input tokens should be spent",
    );
  });

  it("refunds minimal surplus (1 wei) to receiver", async function () {
    const { receiver, tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange - minimal surplus scenario
    const amountOut = parseUnits("2000", 18);
    const amountInMaximum = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = amountOut + BigInt(1); // Just 1 wei surplus
    const expectedSurplus = BigInt(1);

    const harnessAddr = await harness.getAddress();
    const receiverAddr = await receiver.getAddress();

    await mint(tokenIn, harnessAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountSpent,
      amountReceived,
      false,
    );
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

    expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(
      expectedSurplus,
    );
    expect(harnessBalanceAfter - harnessBalanceBefore).to.equal(amountOut);
  });

  it("no refund when receiver is contract itself", async function () {
    const { tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange - receiver is the contract itself (should not transfer to self)
    const amountOut = parseUnits("2000", 18);
    const amountInMaximum = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2500", 18); // Surplus scenario

    const harnessAddr = await harness.getAddress();

    await mint(tokenIn, harnessAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountSpent,
      amountReceived,
      false,
    );
    const swapData = router.interface.encodeFunctionData("performSwap");

    const harnessBalanceBefore = await tokenOut.balanceOf(harnessAddr);

    // Act - receiver is the harness contract itself
    await (harness as any).callSwapExactOutput(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountOut,
      amountInMaximum,
      harnessAddr, // receiver is contract itself
      swapData,
      await router.getAddress(),
    );

    // Assert
    const harnessBalanceAfter = await tokenOut.balanceOf(harnessAddr);

    // When receiver == contract, all tokens should stay with contract
    expect(harnessBalanceAfter - harnessBalanceBefore).to.equal(
      amountReceived,
      "All tokens should remain with contract when receiver is itself",
    );
  });

  it("no surplus refund when exact amount received", async function () {
    const { receiver, tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange - router delivers exactly what's requested (no surplus)
    const amountOut = parseUnits("2000", 18);
    const amountInMaximum = parseUnits("1500", 18);
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2000", 18); // Exactly what's requested

    const harnessAddr = await harness.getAddress();
    const receiverAddr = await receiver.getAddress();

    await mint(tokenIn, harnessAddr, parseUnits("10000", 18));
    await mint(tokenOut, await router.getAddress(), amountReceived);
    await router.setSwapBehaviour(
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      amountSpent,
      amountReceived,
      false,
    );
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

    // No surplus, so receiver should get nothing, harness keeps all
    expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(
      0,
      "Receiver should get nothing when no surplus",
    );
    expect(harnessBalanceAfter - harnessBalanceBefore).to.equal(
      amountReceived,
      "Harness should keep all tokens when no surplus",
    );
  });
});
