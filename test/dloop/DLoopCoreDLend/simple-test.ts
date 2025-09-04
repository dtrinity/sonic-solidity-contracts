import { expect } from "chai";
import { deployments, ethers } from "hardhat";

import { DLoopCoreDLend } from "../../../typechain-types";
import { DLOOP_CORE_DLEND_ID } from "../../../typescript/deploy-ids";

describe("DLoopCoreDLend simple test", () => {
  let vault: DLoopCoreDLend;

  before(async () => {
    // Single deployment pass to avoid double-initialization
    await deployments.fixture([
      "local-setup",
      "dusd",
      "dlend",
      "dlend-static-wrapper-factory",
      "dUSD-aTokenWrapper",
      "dS-aTokenWrapper",
      "dloop",
      "core",
      "dlend",
    ]);

    // Get DLoop core vault instance (3X-sfrxUSD)
    const dloopVaultAddr = (await deployments.get(`${DLOOP_CORE_DLEND_ID}-3X-sfrxUSD`)).address;
    console.log(`DLoopCoreDLend address: ${dloopVaultAddr}`);

    vault = (await ethers.getContractAt("DLoopCoreDLend", dloopVaultAddr)) as DLoopCoreDLend;
  });

  it("should be able to get the vault name", async () => {
    const name = await vault.name();
    console.log(`Vault name: ${name}`);
    expect(name).to.be.a("string");
  });
});
