import { expect } from "chai";
import { ethers } from "hardhat";

import { deployMintableERC20, deployMockRouter, mint } from "./utils/setup";

const { parseUnits } = ethers;

describe("OdosSwapUtils", function () {
  /**
   *
   */
  async function fixture() {
    const [deployer] = await ethers.getSigners();
    const tokenIn = await deployMintableERC20("TokenIn", "TIN");
    const tokenOut = await deployMintableERC20("TokenOut", "TOUT");
    const router = await deployMockRouter();
    const HarnessFactory = await ethers.getContractFactory(
      "OdosSwapUtilsHarness",
    );
    const harness = await HarnessFactory.deploy();
    return { deployer, tokenIn, tokenOut, router, harness };
  }

  it("executes happy-path swap", async function () {
    const { deployer, tokenIn, tokenOut, router, harness } = await fixture();

    // Arrange
    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("2000", 18);

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

    // Act
    await (harness as any).callExecuteSwap(
      await router.getAddress(),
      await tokenIn.getAddress(),
      await tokenOut.getAddress(),
      parseUnits("1500", 18),
      amountReceived,
      swapData,
    );

    // Assert output balance & allowance checks
    expect(await tokenOut.balanceOf(harnessAddr)).to.equal(amountReceived);
    expect(
      await tokenIn.allowance(harnessAddr, await router.getAddress()),
    ).to.equal(0);
  });

  it("reverts when received < exactOut", async function () {
    const { tokenIn, tokenOut, router, harness } = await fixture();

    const amountSpent = parseUnits("1000", 18);
    const amountReceived = parseUnits("1500", 18); // lower than expected 2000
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

    await expect(
      (harness as any).callExecuteSwap(
        await router.getAddress(),
        await tokenIn.getAddress(),
        await tokenOut.getAddress(),
        parseUnits("1500", 18),
        parseUnits("2000", 18),
        swapData,
      ),
    ).to.be.revertedWithCustomError(harness, "InsufficientOutput");
  });
});
