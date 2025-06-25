import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopDepositorOdos,
  TestERC20FlashMintable,
  TestMintableERC20,
} from "../../../typechain-types";

import { deployDLoopMockLogic } from "../DLoopDepositorMock/fixtures";

import {
  ONE_PERCENT_BPS,
  ONE_HUNDRED_PERCENT_BPS,
} from "../../../typescript/common/bps_constants";

/*
 * This test reproduces the DoS bug caused by the mismatched accounting check in
 * `SwappableVault._swapExactOutput`. The Odos implementation returns the *output*
 * token amount, while `SwappableVault` expects the *input* token amount – the
 * invariant therefore fails and the call reverts with
 * `SpentInputTokenAmountNotEqualReturnedAmountIn`.
 */

describe("DLoopDepositorOdos – bug reproduction", function () {
  async function fixture() {
    // Deploy core mock directly (no nested loadFixture)
    const coreFixture = await deployDLoopMockLogic();

    const { dloopMock, collateralToken, debtToken, user1 } =
      coreFixture as unknown as {
        dloopMock: DLoopCoreMock;
        collateralToken: TestMintableERC20;
        debtToken: TestERC20FlashMintable;
        user1: any;
      };

    // ----------------- Set mock prices so that vault math works ----------------
    const DEFAULT_PRICE = 100000000; // 1e8 (same as fixtures)
    await dloopMock.setMockPrice(
      await collateralToken.getAddress(),
      DEFAULT_PRICE
    );
    await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

    // ----------------------- Deploy mock Odos router --------------------------
    const MockRouterFactory = await ethers.getContractFactory("MockOdosRouter");
    const mockRouter = (await MockRouterFactory.deploy()) as any;
    await mockRouter.waitForDeployment();

    // ------------------- Deploy OdosSwapLogic library -------------------------
    const OdosSwapLogicFactory =
      await ethers.getContractFactory("OdosSwapLogic");
    const odosSwapLogic = await OdosSwapLogicFactory.deploy();
    await odosSwapLogic.waitForDeployment();

    // ------------------- Deploy DLoopDepositorOdos (linked) ------------------
    const DepositorFactory = await ethers.getContractFactory(
      "DLoopDepositorOdos",
      {
        libraries: {
          OdosSwapLogic: await odosSwapLogic.getAddress(),
        },
      }
    );

    const depositor = (await DepositorFactory.deploy(
      await debtToken.getAddress(), // flash lender == debt token (flash-mint)
      await mockRouter.getAddress()
    )) as DLoopDepositorOdos;
    await depositor.waitForDeployment();

    return {
      dloopMock,
      collateralToken,
      debtToken,
      depositor,
      mockRouter,
      user: user1,
    };
  }

  it("reverts with SpentInputTokenAmountNotEqualReturnedAmountIn", async function () {
    const {
      dloopMock,
      collateralToken,
      debtToken,
      depositor,
      mockRouter,
      user,
    } = await loadFixture(fixture);

    // --------------------- Prepare test parameters ---------------------------
    const depositAmount = ethers.parseEther("100");
    const slippageBps = 5 * ONE_PERCENT_BPS; // 5%

    // User needs collateral tokens and approval
    await collateralToken.mint(user.address, depositAmount);
    await collateralToken
      .connect(user)
      .approve(await depositor.getAddress(), depositAmount);

    // Compute minOutputShares (contract helper)
    const minOutputShares = await depositor.calculateMinOutputShares(
      depositAmount,
      slippageBps,
      dloopMock
    );

    // Compute requiredAdditionalCollateral to craft swapData & fund router
    const leveragedAssets = await dloopMock.getLeveragedAssets(depositAmount);
    const leveragedAssetsBn = BigInt(leveragedAssets);
    const leveragedCollateralAmount =
      (leveragedAssetsBn * BigInt(ONE_HUNDRED_PERCENT_BPS - slippageBps)) /
      BigInt(ONE_HUNDRED_PERCENT_BPS);
    const requiredAdditionalCollateral =
      leveragedCollateralAmount - depositAmount;

    // Fund the router with enough collateral tokens to send in the swap
    await collateralToken.mint(
      await mockRouter.getAddress(),
      requiredAdditionalCollateral
    );

    // Encode swap data for `swapExactOutput(address,address,uint256)`
    const swapData = mockRouter.interface.encodeFunctionData(
      "swapExactOutput",
      [
        await debtToken.getAddress(),
        await collateralToken.getAddress(),
        requiredAdditionalCollateral,
      ]
    );

    // Perform the leveraged deposit – expect revert with the specific custom error
    await expect(
      depositor
        .connect(user)
        .deposit(
          depositAmount,
          user.address,
          minOutputShares,
          swapData,
          dloopMock
        )
    ).to.be.revertedWithCustomError(
      depositor,
      "SpentInputTokenAmountNotEqualReturnedAmountIn"
    );
  });
});
