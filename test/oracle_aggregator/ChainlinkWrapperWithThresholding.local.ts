import { expect } from "chai";
import { ethers } from "hardhat";

const BASE_UNIT = 10n ** 18n;

describe("ChainlinkWrapperWithThresholding", () => {
  async function fixture() {
    const [deployer, unauthorized] = await ethers.getSigners();
    const wrapper = await ethers.deployContract("ChainlinkWrapperWithThresholding", [ethers.ZeroAddress, BASE_UNIT]);
    const feed18 = await ethers.deployContract("MockChainlinkAggregatorV3", [18, "stS/S"]);
    const feed8 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "S/USD"]);
    const asset = ethers.Wallet.createRandom().address;

    await feed18.setMock(ethers.parseUnits("1.06204735", 18));
    await feed8.setMock(ethers.parseUnits("0.04259", 8));

    return { wrapper, feed18, feed8, asset, deployer, unauthorized };
  }

  it("prices a single 18-decimal Chainlink-compatible feed", async () => {
    const { wrapper, feed18, asset } = await fixture();

    await wrapper.setFeed(asset, await feed18.getAddress());

    const { price, isAlive } = await wrapper.getPriceInfo(asset);
    expect(isAlive).to.equal(true);
    expect(price).to.equal(ethers.parseUnits("1.06204735", 18));
    expect(await wrapper.getAssetPrice(asset)).to.equal(price);
  });

  it("composes mixed 18-decimal and 8-decimal feeds", async () => {
    const { wrapper, feed18, feed8, asset } = await fixture();

    await wrapper.addCompositeFeed(asset, await feed18.getAddress(), await feed8.getAddress(), 0, 0, 0, 0);

    const expected = (ethers.parseUnits("1.06204735", 18) * ethers.parseUnits("0.04259", 18)) / BASE_UNIT;
    const { price, isAlive } = await wrapper.getPriceInfo(asset);

    expect(isAlive).to.equal(true);
    expect(price).to.equal(expected);
  });

  it("removes any active pricing path for an asset", async () => {
    const { wrapper, feed18, feed8, asset } = await fixture();

    await wrapper.addCompositeFeed(asset, await feed18.getAddress(), await feed8.getAddress(), 0, 0, 0, 0);
    await wrapper.removeFeed(asset);
    await expect(wrapper.getPriceInfo(asset)).to.be.revertedWithCustomError(wrapper, "FeedNotSet").withArgs(asset);

    await wrapper.setFeed(asset, await feed18.getAddress());
    await wrapper.removeCompositeFeed(asset);
    await expect(wrapper.getPriceInfo(asset)).to.be.revertedWithCustomError(wrapper, "FeedNotSet").withArgs(asset);
  });

  it("enforces oracle manager role", async () => {
    const { wrapper, feed18, asset, unauthorized } = await fixture();
    const role = await wrapper.ORACLE_MANAGER_ROLE();

    await expect(wrapper.connect(unauthorized).setFeed(asset, await feed18.getAddress()))
      .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
      .withArgs(await unauthorized.getAddress(), role);
  });
});
