import { expect } from "chai";
import { ethers } from "hardhat";

import { SupportsWithdrawalFeeHarness } from "../../typechain-types";

describe("SupportsWithdrawalFee", function () {
  let harness: SupportsWithdrawalFeeHarness;

  beforeEach(async function () {
    const factory = await ethers.getContractFactory("SupportsWithdrawalFeeHarness");
    harness = (await factory.deploy(0)) as unknown as SupportsWithdrawalFeeHarness;
    await harness.waitForDeployment();
  });

  it("returns the minimal gross amount needed to satisfy a net withdrawal target", async function () {
    const scenarios = [
      { feeBps: 1n, netAmount: 1n },
      { feeBps: 30n, netAmount: 1n },
      { feeBps: 30n, netAmount: 1_000n },
      { feeBps: 50n, netAmount: 10n },
      { feeBps: 500n, netAmount: 123_456_789n },
    ];

    for (const { feeBps, netAmount } of scenarios) {
      await harness.setWithdrawalFeeBps(feeBps);
      const gross = await harness.getGrossAmountRequiredForNet(netAmount);
      const netFromGross = await harness.getNetAmountAfterFee(gross);
      expect(netFromGross).to.be.gte(netAmount);

      if (gross > 0n) {
        const netFromGrossMinusOne = await harness.getNetAmountAfterFee(gross - 1n);
        expect(netFromGrossMinusOne).to.be.lt(netAmount);
      }
    }
  });
});
