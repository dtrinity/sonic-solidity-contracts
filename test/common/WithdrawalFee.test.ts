import { expect } from "chai";
import { ethers } from "hardhat";

const ONE_PERCENT_BPS = 100; // 1%

describe("WithdrawalFee math overflow protection", function () {
  it("_calculateWithdrawalFee handles uint256 max without overflow", async function () {
    const [deployer] = await ethers.getSigners();
    const WithdrawalFeeHarness = await ethers.getContractFactory(
      "WithdrawalFeeHarness",
    );
    const harness = await WithdrawalFeeHarness.deploy(ONE_PERCENT_BPS);
    const maxUint = ethers.MaxUint256;
    // Should not revert
    const fee = await (harness as any).calc(maxUint);
    // Fee should be >0 and <= maxUint
    expect(fee).to.be.gt(0n);
    expect(fee).to.be.lte(maxUint);
  });
});
