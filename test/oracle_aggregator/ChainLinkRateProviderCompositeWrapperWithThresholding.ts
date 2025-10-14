import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";
import { getConfig } from "../../config/config";

const BASE_DECIMALS = 18n;
const BASE_UNIT = 10n ** BASE_DECIMALS;

describe("ChainlinkRateProviderCompositeWrapperWithThresholding (config-driven)", () => {
  let deployer: Address;

  before(async () => {
    ({ deployer } = await getNamedAccounts());
  });

  it("should run tests for each oracle aggregator", async () => {
    const config = await getConfig(hre);
    const currencies = Object.keys(config.oracleAggregators);
    for (const currency of currencies) {
      await runTestsForCurrency(currency, { deployer });
    }
  });
});

async function runTestsForCurrency(currency: string, { deployer }: { deployer: Address }) {
  describe(`ChainlinkRateProviderCompositeWrapperWithThresholding for ${currency}`, () => {
    let wrapper: any;
    let feed: any;
    let rateProvider: any;
    let assetKey: string;

    beforeEach(async function () {
      const [signer] = await ethers.getSigners();
      const Factory = await ethers.getContractFactory("ChainlinkSafeRateProviderCompositeWrapperWithThresholding", signer);
      wrapper = await Factory.deploy(ethers.ZeroAddress, BASE_UNIT);
      await wrapper.waitForDeployment();

      // Chainlink mock with 8 decimals
      feed = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "MOCK/BASE"]);
      await feed.setMock(ethers.parseUnits("1.0", 8));
      // Mock rate provider with UNIT=1e6 (6 decimals), rate=980150
      const UNIT = 10n ** 6n;
      const rate = 980_150n;
      rateProvider = await ethers.deployContract("MockRateProvider", [UNIT, rate]);

      // Deploy a mock ERC20 token to use as asset
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy("Mock Asset", "MOCK", 18);
      assetKey = await mockToken.getAddress();

      await wrapper.addCompositeFeed(assetKey, await feed.getAddress(), await rateProvider.getAddress(), 0, 0, 0, 0);
    });

    describe("Base currency and units", () => {
      it("returns correct BASE_CURRENCY and BASE_CURRENCY_UNIT", async function () {
        const base = await wrapper.BASE_CURRENCY();
        const unit = await wrapper.BASE_CURRENCY_UNIT();
        expect(base).to.equal(ethers.ZeroAddress);
        expect(unit).to.equal(BASE_UNIT);
      });
    });

    describe("Asset pricing with thresholding", () => {
      it("composes Chainlink(8) and 6-decimal rate provider to BASE_UNIT", async function () {
        await feed.setMock(ethers.parseUnits("1.0", 8));
        const [, answer1] = await feed.latestRoundData();
        const cl1 = answer1 > 0 ? (answer1 as unknown as bigint) : 0n;
        const priceInBase1 = (cl1 * BASE_UNIT) / 10n ** 8n;
        const rp: bigint = await rateProvider.getRate();
        const assetUnit = 10n ** 18n; // Asset has 18 decimals
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;
        const expected = (priceInBase1 * priceInBase2) / BASE_UNIT;
        const { price, isAlive } = await wrapper.getPriceInfo(assetKey);
        expect(isAlive).to.equal(true);
        expect(price).to.equal(expected);
      });

      it("returns original composed price when no thresholds are set", async function () {
        await feed.setMock(ethers.parseUnits("0.97", 8));
        const [, answer1] = await feed.latestRoundData();
        const cl1 = answer1 > 0 ? (answer1 as unknown as bigint) : 0n;
        const priceInBase1 = (cl1 * BASE_UNIT) / 10n ** 8n;
        const rp: bigint = await rateProvider.getRate();
        const assetUnit = 10n ** 18n; // Asset has 18 decimals
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;
        const expected = (priceInBase1 * priceInBase2) / BASE_UNIT;
        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
        const direct = await wrapper.getAssetPrice(assetKey);
        expect(direct).to.equal(expected);
      });

      it("applies primary threshold (CL leg)", async function () {
        await feed.setMock(ethers.parseUnits("0.96", 8));
        const fixed1 = ethers.parseUnits("1.00", 18);
        const lower1 = ethers.parseUnits("0.95", 18);
        await wrapper.updateCompositeFeed(assetKey, lower1, fixed1, 0, 0);
        const rp: bigint = await rateProvider.getRate();
        const assetUnit = 10n ** 18n; // Asset has 18 decimals
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;
        const expected = (fixed1 * priceInBase2) / BASE_UNIT;
        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });

      it("applies secondary threshold (rate leg)", async function () {
        await feed.setMock(ethers.parseUnits("1.00", 8));
        const fixed2 = ethers.parseUnits("1.00", 18);
        const rp: bigint = await rateProvider.getRate();
        const assetUnit = 10n ** 18n; // Asset has 18 decimals
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;
        const lower2 = priceInBase2 - 1n;
        await wrapper.updateCompositeFeed(assetKey, 0, 0, lower2, fixed2);
        const priceInBase1 = ethers.parseUnits("1.00", 18);
        const expected = priceInBase1;
        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });

      it("returns original price when CL leg is below threshold", async function () {
        await feed.setMock(ethers.parseUnits("0.98", 8));
        const fixed1 = ethers.parseUnits("1.00", 18);
        const lower1 = ethers.parseUnits("0.99", 18);
        await wrapper.updateCompositeFeed(assetKey, lower1, fixed1, 0, 0);
        const [, answer1] = await feed.latestRoundData();
        const cl1 = answer1 > 0 ? (answer1 as unknown as bigint) : 0n;
        const priceInBase1 = (cl1 * BASE_UNIT) / 10n ** 8n;
        const rp: bigint = await rateProvider.getRate();
        const assetUnit = 10n ** 18n; // Asset has 18 decimals
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;
        const expected = (priceInBase1 * priceInBase2) / BASE_UNIT;
        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });
    });

    describe("Threshold configuration management", () => {
      it("allows updating thresholds via updateCompositeFeed and reflects in storage", async function () {
        const lower1 = ethers.parseUnits("0.99", 18);
        const fixed1 = ethers.parseUnits("1.00", 18);
        const lower2 = ethers.parseUnits("0.98", 18);
        const fixed2 = ethers.parseUnits("1.00", 18);
        await wrapper.updateCompositeFeed(assetKey, lower1, fixed1, lower2, fixed2);
        const cfg = await wrapper.compositeFeeds(assetKey);
        expect(cfg.rateProviderUnit).to.equal(10n ** 18n); // Asset has 18 decimals
        expect(cfg.feed1Decimals).to.equal(8);
        expect(cfg.feed1Unit).to.equal(10n ** 8n);
        expect(cfg.primaryThreshold.lowerThresholdInBase).to.equal(lower1);
        expect(cfg.primaryThreshold.fixedPriceInBase).to.equal(fixed1);
        expect(cfg.secondaryThreshold.lowerThresholdInBase).to.equal(lower2);
        expect(cfg.secondaryThreshold.fixedPriceInBase).to.equal(fixed2);
      });

      it("only ORACLE_MANAGER can update or remove feeds", async function () {
        const [, unauthorized] = await ethers.getSigners();
        const oracleManagerRole = await wrapper.ORACLE_MANAGER_ROLE();
        await expect(wrapper.connect(unauthorized).updateCompositeFeed(assetKey, 0, 0, 0, 0))
          .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
          .withArgs(await unauthorized.getAddress(), oracleManagerRole);
        await expect(wrapper.connect(unauthorized).removeCompositeFeed(assetKey))
          .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
          .withArgs(await unauthorized.getAddress(), oracleManagerRole);
      });

      it("removes a feed and then getPriceInfo reverts with FeedNotSet", async function () {
        await wrapper.removeCompositeFeed(assetKey);
        await expect(wrapper.getPriceInfo(assetKey)).to.be.revertedWithCustomError(wrapper, "FeedNotSet").withArgs(assetKey);
      });
    });

    describe("Configuration guards", () => {
      it("reverts when adding a feed with non-positive price", async function () {
        const otherFeed = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "ZERO/BASE"]);
        await otherFeed.setMock(0);
        const MockToken = await ethers.getContractFactory("MockERC20");
        const mockToken = await MockToken.deploy("Guard Asset", "GUARD", 18);
        await expect(
          wrapper.addCompositeFeed(await mockToken.getAddress(), await otherFeed.getAddress(), await rateProvider.getAddress(), 0, 0, 0, 0),
        )
          .to.be.revertedWithCustomError(wrapper, "FeedPriceNotPositive")
          .withArgs(await otherFeed.getAddress());
      });

      it("reverts when chainlink feed decimals are zero", async function () {
        const zeroDecimalFeed = await ethers.deployContract("MockChainlinkAggregatorV3", [0, "ZERO/BASE"]);
        await zeroDecimalFeed.setMock(ethers.parseUnits("1", 0));
        const MockToken = await ethers.getContractFactory("MockERC20");
        const mockToken = await MockToken.deploy("Zero Dec", "ZERO", 18);
        await expect(
          wrapper.addCompositeFeed(
            await mockToken.getAddress(),
            await zeroDecimalFeed.getAddress(),
            await rateProvider.getAddress(),
            0,
            0,
            0,
            0,
          ),
        )
          .to.be.revertedWithCustomError(wrapper, "InvalidFeedDecimals")
          .withArgs(await zeroDecimalFeed.getAddress(), 0);
      });

      it("scales feeds that report 18 decimals", async function () {
        const highPrecisionFeed = await ethers.deployContract("MockChainlinkAggregatorV3", [18, "MOCK18/BASE"]);
        await highPrecisionFeed.setMock(ethers.parseUnits("1.01", 18));
        const MockToken = await ethers.getContractFactory("MockERC20");
        const mockToken = await MockToken.deploy("High Precision Asset", "HPREC", 18);
        await wrapper.addCompositeFeed(
          await mockToken.getAddress(),
          await highPrecisionFeed.getAddress(),
          await rateProvider.getAddress(),
          0,
          0,
          0,
          0,
        );
        const { price: price18, isAlive } = await wrapper.getPriceInfo(await mockToken.getAddress());
        expect(isAlive).to.equal(true);
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / 10n ** 18n;
        const expected = (ethers.parseUnits("1.01", 18) * priceInBase2) / BASE_UNIT;
        expect(price18).to.equal(expected);
      });
    });
  });
}
