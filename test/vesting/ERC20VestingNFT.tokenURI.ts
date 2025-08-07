import { expect } from "chai";
import { parseEther } from "ethers";
import fs from "fs";
import hre from "hardhat";

const { ethers } = hre;

// Toggle this flag to generate SVG/JSON debug files
const ENABLE_DEBUG_OUTPUT = false;

/**
 *
 * @param prefix
 * @param meta
 */
function saveDebugFiles(prefix: string, meta: any) {
  if (!ENABLE_DEBUG_OUTPUT) return;
  fs.writeFileSync(`./token_${prefix}.json`, JSON.stringify(meta, null, 2));

  try {
    if (typeof meta.image === "string" && meta.image.startsWith("data:image")) {
      const svgData = Buffer.from(meta.image.split(",")[1], "base64").toString(
        "utf8",
      );
      fs.writeFileSync(`./image_${prefix}.svg`, svgData);
    }
  } catch (e) {
    // ignore file writing errors in tests
  }
}

/**
 *
 * @param uri
 */
function decodeTokenURI(uri: string): any {
  const base64Data = uri.split(",")[1];
  const jsonStr = Buffer.from(base64Data, "base64").toString("utf8");
  return JSON.parse(jsonStr);
}

describe("ERC20VestingNFT: tokenURI", function () {
  const ONE_DAY = 24 * 60 * 60;
  const INITIAL_SUPPLY = parseEther("1000000");
  const DEPOSIT_AMOUNT = parseEther("1000");

  let dstake: any;
  let vestingNFT: any;
  let owner: any;
  let user: any;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy mock dSTAKE token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    dstake = await MockERC20.deploy("dSTAKE", "DST", INITIAL_SUPPLY);
    await dstake.waitForDeployment();

    // Deploy vesting NFT (vesting period = 1 day for test)
    const ERC20VestingNFT = await ethers.getContractFactory("ERC20VestingNFT");
    vestingNFT = await ERC20VestingNFT.deploy(
      "dSTAKE Vesting",
      "dSV",
      await dstake.getAddress(),
      ONE_DAY,
      parseEther("10000000"), // max supply
      parseEther("1"), // min deposit
      await owner.getAddress(),
    );
    await vestingNFT.waitForDeployment();

    // Transfer some dSTAKE to user
    await dstake.transfer(await user.getAddress(), DEPOSIT_AMOUNT);

    // User approves and deposits
    await dstake
      .connect(user)
      .approve(await vestingNFT.getAddress(), DEPOSIT_AMOUNT);
    await vestingNFT.connect(user).deposit(DEPOSIT_AMOUNT);
    this.tokenId = 1n; // first token minted has ID 1
  });

  it("returns valid JSON metadata before and after maturity", async function () {
    const tokenId = this.tokenId;

    // BEFORE maturity
    const uri1: string = await vestingNFT.tokenURI(tokenId);
    const meta1 = decodeTokenURI(uri1);

    // Optional debug output
    saveDebugFiles("before", meta1);

    expect(meta1.name).to.equal(`dSTAKE Vesting #${tokenId}`);
    expect(meta1.attributes).to.be.an("array");
    const maturedAttr1 = meta1.attributes.find(
      (a: any) => a.trait_type === "Matured",
    );
    expect(maturedAttr1.value).to.equal("false");
    expect(meta1.image).to.include("data:image/svg+xml;base64,");

    // Fast-forward time to after vesting period
    await ethers.provider.send("evm_increaseTime", [ONE_DAY + 1]);
    await ethers.provider.send("evm_mine", []);

    // Withdraw matured to set soul-bound flag and emit MetadataUpdate
    await vestingNFT.connect(user).withdrawMatured(tokenId);

    const uri2: string = await vestingNFT.tokenURI(tokenId);
    const meta2 = decodeTokenURI(uri2);

    // Optional debug output
    saveDebugFiles("after", meta2);

    const maturedAttr2 = meta2.attributes.find(
      (a: any) => a.trait_type === "Matured",
    );
    expect(maturedAttr2.value).to.equal("true");

    const remainingAttr2 = meta2.attributes.find(
      (a: any) => a.trait_type === "Remaining Seconds",
    );
    expect(remainingAttr2.value).to.equal("0");
  });
});
