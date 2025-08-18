import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreViewStub,
  DLoopRedeemerLogicHarness,
} from "../../../typechain-types";

describe("DLoopRedeemerLogic - encode/decode", () => {
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

  it("round-trip encode/decode - table", async () => {
    const dl = await dloop.getAddress();
    const swapDatas: string[] = [
      "0x",
      ethers.hexlify(ethers.randomBytes(0)),
      ethers.hexlify(ethers.randomBytes(4)),
      ethers.hexlify(ethers.randomBytes(16)),
      ethers.hexlify(ethers.randomBytes(32)),
      ethers.hexlify(ethers.randomBytes(64)),
      ethers.hexlify(ethers.randomBytes(96)),
      ethers.hexlify(ethers.randomBytes(128)),
      ethers.hexlify(ethers.randomBytes(192)),
      ethers.hexlify(ethers.randomBytes(256)),
    ];

    const amounts = [
      0n,
      1n,
      2n,
      10n,
      123n,
      9999n,
      1_000_000n,
      2n ** 128n - 1n,
      2n ** 64n - 1n,
      2n ** 32n - 1n,
    ];

    for (let i = 0; i < 10; i++) {
      const shares = amounts[i];
      const data = await harness.encodeFlashLoanParamsPublic(
        shares,
        swapDatas[i],
        dl,
      );
      const decoded = await harness.decodeFlashLoanParamsPublic(data);
      expect(decoded[0]).to.equal(shares);
      expect(decoded[1]).to.equal(swapDatas[i]);
      expect(decoded[2]).to.equal(dl);
    }
  });
});
