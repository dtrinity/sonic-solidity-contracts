import { expect } from "chai";
import { ethers } from "hardhat";

const BASE_UNIT = 10n ** 8n;
const CHAINLINK_HEARTBEAT_SECONDS = 24 * 60 * 60;
const HEARTBEAT_STALE_LIMIT_SECONDS = 30 * 60;

describe("ERC4626RateProviderThirdFeedWrapperWithThresholding", () => {
  async function fixture() {
    const [deployer, unauthorized] = await ethers.getSigners();
    const underlying = await ethers.deployContract("TestERC20", ["Staked scUSD", "stkscUSD", 6]);
    const vault = await ethers.deployContract("MockERC4626FixedRate", [await underlying.getAddress(), 10n ** 6n, 1_020_000n]);
    const rateProvider = await ethers.deployContract("MockRateProvider", [10n ** 6n, 980_000n]);
    const thirdFeed = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "USDC/USD"]);
    await thirdFeed.setMock(ethers.parseUnits("1.001", 8));

    const wrapper = await ethers.deployContract("ERC4626RateProviderThirdFeedWrapperWithThresholding", [ethers.ZeroAddress, BASE_UNIT]);
    const asset = await vault.getAddress();

    await wrapper.setFeed(
      asset,
      await vault.getAddress(),
      await rateProvider.getAddress(),
      await thirdFeed.getAddress(),
      0,
      0,
      0,
      0,
      BASE_UNIT,
      BASE_UNIT,
    );

    return { wrapper, underlying, vault, rateProvider, thirdFeed, asset, deployer, unauthorized };
  }

  it("composes ERC4626, rate provider, and third feed legs", async () => {
    const { wrapper, vault, rateProvider, thirdFeed, asset } = await fixture();

    const sharesUnit = 10n ** BigInt(await vault.decimals());
    const assetsPerOneShare = await vault.convertToAssets(sharesUnit);
    const underlying = await ethers.getContractAt(["function decimals() view returns (uint8)"], await vault.asset());
    const underlyingUnit = 10n ** BigInt(await underlying.decimals());
    const assetUnit = sharesUnit;
    const thirdFeedUnit = 10n ** BigInt(await thirdFeed.decimals());

    const priceInBase1 = (assetsPerOneShare * BASE_UNIT) / underlyingUnit;
    const priceInBase2 = ((await rateProvider.getRateSafe()) * BASE_UNIT) / assetUnit;
    const priceInBase3 = BASE_UNIT; // thresholded from 1.001 to 1.0 by fixture config
    const expected = (((priceInBase1 * priceInBase2) / BASE_UNIT) * priceInBase3) / BASE_UNIT;

    const { price, isAlive } = await wrapper.getPriceInfo(asset);
    expect(isAlive).to.equal(true);
    expect(price).to.equal(expected);
    expect(await wrapper.getAssetPrice(asset)).to.equal(expected);
    expect(thirdFeedUnit).to.equal(BASE_UNIT);
  });

  it("uses Chainlink heartbeat plus stale-time limit for the third feed", async () => {
    const { wrapper, thirdFeed, asset } = await fixture();
    const block = await ethers.provider.getBlock("latest");
    if (!block) throw new Error("latest block not available");

    const staleTimestamp = block.timestamp - CHAINLINK_HEARTBEAT_SECONDS - HEARTBEAT_STALE_LIMIT_SECONDS - 1;
    await thirdFeed.setMockWithTimestamp(ethers.parseUnits("1.0", 8), staleTimestamp);

    const staleInfo = await wrapper.getPriceInfo(asset);
    expect(staleInfo.isAlive).to.equal(false);
    await expect(wrapper.getAssetPrice(asset)).to.be.revertedWithCustomError(wrapper, "PriceIsStale");

    await thirdFeed.setMock(ethers.parseUnits("1.0", 8));

    const freshInfo = await wrapper.getPriceInfo(asset);
    expect(freshInfo.isAlive).to.equal(true);
  });

  it("allows governance-style role holders to update heartbeat stale-time limit", async () => {
    const { wrapper, unauthorized } = await fixture();
    const role = await wrapper.ORACLE_MANAGER_ROLE();

    await expect(wrapper.connect(unauthorized).setHeartbeatStaleTimeLimit(3600))
      .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
      .withArgs(await unauthorized.getAddress(), role);

    await expect(wrapper.setHeartbeatStaleTimeLimit(3600)).to.emit(wrapper, "HeartbeatStaleTimeLimitUpdated").withArgs(1800, 3600);
    expect(await wrapper.heartbeatStaleTimeLimit()).to.equal(3600);
  });
});
