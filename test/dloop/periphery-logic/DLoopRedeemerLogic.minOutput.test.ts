import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreViewStub,
  DLoopRedeemerLogicHarness,
} from "../../../typechain-types";
import { ONE_HUNDRED_PERCENT_BPS } from "../../../typescript/common/bps_constants";

describe("DLoopRedeemerLogic - min output", () => {
  let harness: DLoopRedeemerLogicHarness;
  let dloop: DLoopCoreViewStub;

  beforeEach(async () => {
    const Stub = await ethers.getContractFactory("DLoopCoreViewStub");
    dloop = (await Stub.deploy()) as unknown as DLoopCoreViewStub;
    const Harness = await ethers.getContractFactory(
      "DLoopRedeemerLogicHarness",
    );
    harness = (await Harness.deploy()) as unknown as DLoopRedeemerLogicHarness;
  });

  it("calculateMinOutputCollateral - table", async () => {
    const slippageCases = [
      0, 1_000, 10_000, 50_000, 100_000, 123_456, 250_000, 333_333, 500_000,
      750_000, 999_999,
    ];

    for (const shares of [
      1n,
      10n,
      1234n,
      ethers.parseEther("1"),
      ethers.parseEther("10"),
    ]) {
      for (const s of slippageCases) {
        const got = await harness.calculateMinOutputCollateralPublic(
          shares,
          BigInt(s),
          dloop.getAddress(),
        );
        // With zero supply, previewRedeem(shares) == shares
        // Unleveraged = leveraged / 3 (target 3x)
        const unleveraged = shares / 3n;
        const expectedAfter =
          (unleveraged * BigInt(ONE_HUNDRED_PERCENT_BPS - s)) /
          BigInt(ONE_HUNDRED_PERCENT_BPS);
        expect(got).to.equal(expectedAfter);
      }
    }

    await expect(
      harness.calculateMinOutputCollateralPublic(
        1000n,
        BigInt(ONE_HUNDRED_PERCENT_BPS + 1),
        dloop.getAddress(),
      ),
    ).to.be.reverted;
  });
});
