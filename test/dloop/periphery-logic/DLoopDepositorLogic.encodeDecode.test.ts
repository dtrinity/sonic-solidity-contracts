import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreViewStub,
  DLoopDepositorLogicHarness,
} from "../../../typechain-types";

describe("DLoopDepositorLogic - encode/decode", () => {
  let harness: DLoopDepositorLogicHarness;
  let dloop: DLoopCoreViewStub;

  beforeEach(async () => {
    const Stub = await ethers.getContractFactory("DLoopCoreViewStub");
    dloop = (await Stub.deploy()) as unknown as DLoopCoreViewStub;
    const Harness = await ethers.getContractFactory(
      "DLoopDepositorLogicHarness",
    );
    harness = (await Harness.deploy()) as unknown as DLoopDepositorLogicHarness;
  });

  it("round-trip encode/decode - table", async () => {
    const user = (await ethers.getSigners())[1];
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
      const dep = amounts[i];
      const lev = amounts[9 - i];
      const data = await harness.encodeFlashLoanParamsPublic(
        user.address,
        dep,
        lev,
        swapDatas[i],
        dl,
      );
      const decoded = await harness.decodeFlashLoanParamsPublic(data);
      expect(decoded[0]).to.equal(user.address);
      expect(decoded[1]).to.equal(dep);
      expect(decoded[2]).to.equal(lev);
      expect(decoded[3]).to.equal(swapDatas[i]);
      expect(decoded[4]).to.equal(dl);
    }
  });
});
