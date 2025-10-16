import { expect } from "chai";
import { ethers } from "hardhat";

import { WithdrawalFeeHarness } from "../../typechain-types";

const ONE_PERCENT_BPS = 10_000n;
const HUNDRED_PERCENT_BPS = 1_000_000n;

describe("WithdrawalFeeMath", function () {
  let harness: WithdrawalFeeHarness;

  before(async function () {
    const factory = await ethers.getContractFactory("WithdrawalFeeHarness");
    harness = (await factory.deploy()) as unknown as WithdrawalFeeHarness;
  });

  it("calculate handles uint256 max without overflow", async function () {
    const maxUint = ethers.MaxUint256;
    const fee = await harness.calculate(maxUint, ONE_PERCENT_BPS);
    expect(fee).to.be.gt(0n);
    expect(fee).to.be.lte(maxUint);
  });

  it("calculate returns full amount for 100% fee", async function () {
    const gross = 1_234_567n;
    const fee = await harness.calculate(gross, HUNDRED_PERCENT_BPS);
    expect(fee).to.equal(gross);
  });

  it("netAfterFee respects zero inputs and clamps at zero for 100% fee", async function () {
    expect(await harness.netAfterFee(0, ONE_PERCENT_BPS)).to.equal(0n);
    expect(await harness.netAfterFee(1_000n, 0n)).to.equal(1_000n);
    expect(await harness.netAfterFee(1_000n, HUNDRED_PERCENT_BPS)).to.equal(0n);
  });

  it("grossFromNet mirrors netAfterFee for typical fees", async function () {
    const net = 1_000n;
    const gross = await harness.grossFromNet(net, ONE_PERCENT_BPS);
    expect(gross).to.equal(1_010n);
    const netResult = await harness.netAfterFee(gross, ONE_PERCENT_BPS);
    expect(netResult).to.equal(net);
  });

  it("grossFromNet tightens the ceil rounding when one wei suffices", async function () {
    const net = 100n;
    const gross = await harness.grossFromNet(net, ONE_PERCENT_BPS);
    expect(gross).to.equal(101n);
  });

  it("grossFromNet returns zero when fee is 100%", async function () {
    expect(await harness.grossFromNet(1_000n, HUNDRED_PERCENT_BPS)).to.equal(0n);
  });
});
