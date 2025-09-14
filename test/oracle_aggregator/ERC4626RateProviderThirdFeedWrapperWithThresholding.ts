import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

describe("ERC4626RateProviderThirdFeedWrapperWithThresholding", () => {
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

async function runTestsForCurrency(
  currency: string,
  { deployer }: { deployer: Address },
) {
  describe(`ERC4626RateProviderThirdFeedWrapperWithThresholding for ${currency}`, () => {
    let wrapper: any;
    let underlying: any;
    let vault: any;
    let rateProvider: any;
    let thirdFeed: any;
    let assetKey: string;
    let BASE_UNIT: bigint;
    let PRICE_DECIMALS: number;
    let BASE_CURRENCY_EXPECTED: string;

    beforeEach(async function () {
      const [signer] = await ethers.getSigners();
      const cfg = (await getConfig(hre)).oracleAggregators[currency];
      PRICE_DECIMALS = cfg.priceDecimals;
      BASE_UNIT = 10n ** BigInt(PRICE_DECIMALS);
      BASE_CURRENCY_EXPECTED = cfg.baseCurrency;

      // Underlying with 6 decimals to match UNIT=1e6 math
      underlying = await ethers.deployContract("TestERC20", ["Underlying", "UND", 6]);

      // Vault mock: UNIT=1e6, rate set to ~1.020459
      const VAULT_UNIT = 10n ** 6n;
      const VAULT_RATE = 1_020_459n;
      vault = await ethers.deployContract(
        "MockERC4626FixedRate",
        [await underlying.getAddress(), VAULT_UNIT, VAULT_RATE],
      );

      // Rate provider mock: UNIT=1e6, rate=980150
      const UNIT = 10n ** 6n;
      const RATE = 980_150n;
      rateProvider = await ethers.deployContract("MockRateProvider", [UNIT, RATE]);

      // Third feed mock: UNIT=1e8, price=100000000 (1.0 USD)
      const THIRD_FEED_UNIT = 10n ** 8n;
      const THIRD_FEED_PRICE = 100_000_000n;
      thirdFeed = await ethers.deployContract("MockPriceFeed", [THIRD_FEED_UNIT, THIRD_FEED_PRICE]);

      // Deploy wrapper
      const Factory = await ethers.getContractFactory(
        "ERC4626RateProviderThirdFeedWrapperWithThresholding",
        signer,
      );
      wrapper = await Factory.deploy(BASE_CURRENCY_EXPECTED, BASE_UNIT);
      await wrapper.waitForDeployment();

      // Deploy a mock ERC20 token to use as asset
      const MockToken = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockToken.deploy("Mock Asset", "MOCK", 18);
      assetKey = await mockToken.getAddress();
      await wrapper.setFeed(
        assetKey,
        await vault.getAddress(),
        await rateProvider.getAddress(),
        await thirdFeed.getAddress(),
        0,
        0,
        0,
        0,
        0,
        0,
      );
    });

    describe("Base currency and units", () => {
      it("returns correct BASE_CURRENCY and BASE_CURRENCY_UNIT", async function () {
        const base = await wrapper.BASE_CURRENCY();
        const unit = await wrapper.BASE_CURRENCY_UNIT();
        expect(base).to.equal(BASE_CURRENCY_EXPECTED);
        expect(unit).to.equal(BASE_UNIT);
      });
    });

    describe("Three-feed pricing composition", () => {
      it("composes ERC4626, rate provider, and third feed into BASE_UNIT", async function () {
        const sharesDec: number = await vault.decimals();
        const sharesUnit = 10n ** BigInt(sharesDec);
        const assetsPerOneShare: bigint = await vault.convertToAssets(sharesUnit);
        const uDec = await (await ethers.getContractAt(
          ["function decimals() view returns (uint8)"],
          await vault.asset(),
        )).decimals();
        const priceInBase1 = (assetsPerOneShare * BASE_UNIT) / (10n ** BigInt(uDec));

        const assetUnit = 10n ** 18n; // Asset has 18 decimals
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;

        const thirdFeedUnit = 10n ** 8n; // Third feed has 8 decimals
        const thirdFeedPrice: bigint = await thirdFeed.latestAnswer();
        const priceInBase3 = (thirdFeedPrice * BASE_UNIT) / thirdFeedUnit;

        // Three-leg composition: (leg1 * leg2 * leg3) / (BASE_UNIT * BASE_UNIT)
        const intermediatePrice = (priceInBase1 * priceInBase2) / BASE_UNIT;
        const expected = (intermediatePrice * priceInBase3) / BASE_UNIT;

        const { price, isAlive } = await wrapper.getPriceInfo(assetKey);
        expect(isAlive).to.equal(true);
        expect(price).to.equal(expected);
      });

      it("applies primary threshold (ERC4626 leg)", async function () {
        const sharesDec: number = await vault.decimals();
        const sharesUnit = 10n ** BigInt(sharesDec);
        const assetsPerOneShare: bigint = await vault.convertToAssets(sharesUnit);
        const uDec = await (await ethers.getContractAt(
          ["function decimals() view returns (uint8)"],
          await vault.asset(),
        )).decimals();
        const priceInBase1 = (assetsPerOneShare * BASE_UNIT) / (10n ** BigInt(uDec));

        const assetUnit = 10n ** 18n;
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;

        const thirdFeedUnit = 10n ** 8n;
        const thirdFeedPrice: bigint = await thirdFeed.latestAnswer();
        const priceInBase3 = (thirdFeedPrice * BASE_UNIT) / thirdFeedUnit;

        const fixed1 = priceInBase1;
        const lower1 = priceInBase1 - 1n;
        await wrapper.updateFeed(assetKey, lower1, fixed1, 0, 0, 0, 0);

        const intermediatePrice = (fixed1 * priceInBase2) / BASE_UNIT;
        const expected = (intermediatePrice * priceInBase3) / BASE_UNIT;

        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });

      it("applies secondary threshold (rate provider leg)", async function () {
        const sharesDec: number = await vault.decimals();
        const sharesUnit = 10n ** BigInt(sharesDec);
        const assetsPerOneShare: bigint = await vault.convertToAssets(sharesUnit);
        const uDec = await (await ethers.getContractAt(
          ["function decimals() view returns (uint8)"],
          await vault.asset(),
        )).decimals();
        const priceInBase1 = (assetsPerOneShare * BASE_UNIT) / (10n ** BigInt(uDec));

        const assetUnit = 10n ** 18n;
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;

        const thirdFeedUnit = 10n ** 8n;
        const thirdFeedPrice: bigint = await thirdFeed.latestAnswer();
        const priceInBase3 = (thirdFeedPrice * BASE_UNIT) / thirdFeedUnit;

        const fixed2 = priceInBase2;
        const lower2 = priceInBase2 - 1n;
        await wrapper.updateFeed(assetKey, 0, 0, lower2, fixed2, 0, 0);

        const intermediatePrice = (priceInBase1 * fixed2) / BASE_UNIT;
        const expected = (intermediatePrice * priceInBase3) / BASE_UNIT;

        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });

      it("applies tertiary threshold (third feed leg)", async function () {
        const sharesDec: number = await vault.decimals();
        const sharesUnit = 10n ** BigInt(sharesDec);
        const assetsPerOneShare: bigint = await vault.convertToAssets(sharesUnit);
        const uDec = await (await ethers.getContractAt(
          ["function decimals() view returns (uint8)"],
          await vault.asset(),
        )).decimals();
        const priceInBase1 = (assetsPerOneShare * BASE_UNIT) / (10n ** BigInt(uDec));

        const assetUnit = 10n ** 18n;
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / assetUnit;

        const thirdFeedUnit = 10n ** 8n;
        const thirdFeedPrice: bigint = await thirdFeed.latestAnswer();
        const priceInBase3 = (thirdFeedPrice * BASE_UNIT) / thirdFeedUnit;

        const fixed3 = priceInBase3;
        const lower3 = priceInBase3 - 1n;
        await wrapper.updateFeed(assetKey, 0, 0, 0, 0, lower3, fixed3);

        const intermediatePrice = (priceInBase1 * priceInBase2) / BASE_UNIT;
        const expected = (intermediatePrice * fixed3) / BASE_UNIT;

        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });
    });

    describe("Feed management", () => {
      it("should allow adding and removing feeds", async function () {
        // Deploy a mock ERC20 token to use as new asset
        const MockToken = await ethers.getContractFactory("MockERC20");
        const newMockToken = await MockToken.deploy("New Mock Asset", "NMOCK", 18);
        const newAsset = await newMockToken.getAddress();

        // Emit FeedSet
        await expect(
          wrapper.setFeed(
            newAsset,
            await vault.getAddress(),
            await rateProvider.getAddress(),
            await thirdFeed.getAddress(),
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
          ),
        )
          .to.emit(wrapper, "FeedSet")
          .withArgs(
            newAsset,
            await vault.getAddress(),
            await rateProvider.getAddress(),
            await thirdFeed.getAddress(),
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
          );

        // Verify config in storage
        const feed = await wrapper.feeds(newAsset);
        expect(feed.erc4626Vault).to.equal(await vault.getAddress());
        expect(feed.rateProvider).to.equal(await rateProvider.getAddress());
        expect(feed.thirdFeed).to.equal(await thirdFeed.getAddress());
        expect(feed.rateProviderUnit).to.equal(10n ** 18n); // Asset has 18 decimals
        expect(feed.thirdFeedUnit).to.equal(10n ** 8n); // Third feed has 8 decimals
        expect(feed.primaryThreshold.lowerThresholdInBase).to.equal(1n * BASE_UNIT);
        expect(feed.primaryThreshold.fixedPriceInBase).to.equal(1n * BASE_UNIT);
        expect(feed.secondaryThreshold.lowerThresholdInBase).to.equal(1n * BASE_UNIT);
        expect(feed.secondaryThreshold.fixedPriceInBase).to.equal(1n * BASE_UNIT);
        expect(feed.tertiaryThreshold.lowerThresholdInBase).to.equal(1n * BASE_UNIT);
        expect(feed.tertiaryThreshold.fixedPriceInBase).to.equal(1n * BASE_UNIT);

        // Remove and verify
        await expect(wrapper.removeFeed(newAsset))
          .to.emit(wrapper, "FeedRemoved")
          .withArgs(newAsset);
        const removed = await wrapper.feeds(newAsset);
        expect(removed.erc4626Vault).to.equal(ethers.ZeroAddress);
        expect(removed.rateProvider).to.equal(ethers.ZeroAddress);
        expect(removed.thirdFeed).to.equal(ethers.ZeroAddress);
      });

      it("should allow updating feed thresholds and units", async function () {
        const lower1 = 5n * (BASE_UNIT / 10n);
        const fixed1 = 1n * BASE_UNIT;
        const lower2 = 4n * (BASE_UNIT / 10n);
        const fixed2 = 1n * BASE_UNIT;
        const lower3 = 3n * (BASE_UNIT / 10n);
        const fixed3 = 1n * BASE_UNIT;

        await expect(wrapper.updateFeed(assetKey, lower1, fixed1, lower2, fixed2, lower3, fixed3))
          .to.emit(wrapper, "FeedUpdated")
          .withArgs(assetKey, lower1, fixed1, lower2, fixed2, lower3, fixed3);

        const feed = await wrapper.feeds(assetKey);
        expect(feed.rateProviderUnit).to.equal(10n ** 18n); // Asset has 18 decimals
        expect(feed.thirdFeedUnit).to.equal(10n ** 8n); // Third feed has 8 decimals
        expect(feed.primaryThreshold.lowerThresholdInBase).to.equal(lower1);
        expect(feed.primaryThreshold.fixedPriceInBase).to.equal(fixed1);
        expect(feed.secondaryThreshold.lowerThresholdInBase).to.equal(lower2);
        expect(feed.secondaryThreshold.fixedPriceInBase).to.equal(fixed2);
        expect(feed.tertiaryThreshold.lowerThresholdInBase).to.equal(lower3);
        expect(feed.tertiaryThreshold.fixedPriceInBase).to.equal(fixed3);
      });

      it("should revert when non-ORACLE_MANAGER tries to manage feeds", async function () {
        const [, unauthorized] = await ethers.getSigners();
        const role = await wrapper.ORACLE_MANAGER_ROLE();
        const newAsset = ethers.Wallet.createRandom().address;

        await expect(
          wrapper
            .connect(unauthorized)
            .setFeed(newAsset, await vault.getAddress(), await rateProvider.getAddress(), await thirdFeed.getAddress(), 0, 0, 0, 0, 0, 0),
        )
          .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
          .withArgs(await unauthorized.getAddress(), role);

        await expect(
          wrapper.connect(unauthorized).updateFeed(assetKey, 0, 0, 0, 0, 0, 0),
        )
          .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
          .withArgs(await unauthorized.getAddress(), role);

        await expect(wrapper.connect(unauthorized).removeFeed(assetKey))
          .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
          .withArgs(await unauthorized.getAddress(), role);
      });

      it("should revert when getting price for non-existent asset", async function () {
        const nonExistentAsset = "0x000000000000000000000000000000000000dEaD";
        await expect(wrapper.getPriceInfo(nonExistentAsset))
          .to.be.revertedWithCustomError(wrapper, "FeedNotSet")
          .withArgs(nonExistentAsset);
        await expect(wrapper.getAssetPrice(nonExistentAsset))
          .to.be.revertedWithCustomError(wrapper, "FeedNotSet")
          .withArgs(nonExistentAsset);
      });
    });

    describe("Liveness checks", () => {
      it("should detect stale third feed with default timeout", async function () {
        // Set third feed to be stale (updated more than 1 hour ago)
        const staleTimestamp = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
        await thirdFeed.setUpdatedAt(staleTimestamp);

        const { isAlive } = await wrapper.getPriceInfo(assetKey);
        expect(isAlive).to.equal(false);
      });

      it("should allow stale third feed when timeout is increased", async function () {
        // Increase stale timeout to 1 day
        await wrapper.setStaleTimeout(24 * 3600); // 24 hours
        
        // Set third feed to be stale (updated 2 hours ago, but within 24 hour limit)
        const staleTimestamp = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
        await thirdFeed.setUpdatedAt(staleTimestamp);

        const { isAlive } = await wrapper.getPriceInfo(assetKey);
        expect(isAlive).to.equal(true);
      });

      it("should disable stale checks when timeout is set to 0", async function () {
        // Disable stale checks
        await wrapper.setStaleTimeout(0);
        
        // Set third feed to be very stale (updated 1 week ago)
        const staleTimestamp = Math.floor(Date.now() / 1000) - (7 * 24 * 3600); // 1 week ago
        await thirdFeed.setUpdatedAt(staleTimestamp);

        const { isAlive } = await wrapper.getPriceInfo(assetKey);
        expect(isAlive).to.equal(true);
      });

      it("should detect zero third feed price", async function () {
        await thirdFeed.setPrice(0);

        const { isAlive } = await wrapper.getPriceInfo(assetKey);
        expect(isAlive).to.equal(false);
      });

      it("should detect zero rate provider rate", async function () {
        await rateProvider.setRate(0);

        const { isAlive } = await wrapper.getPriceInfo(assetKey);
        expect(isAlive).to.equal(false);
      });
    });

    describe("Stale timeout management", () => {
      it("should allow ORACLE_MANAGER to update stale timeout", async function () {
        const newTimeout = 12 * 3600; // 12 hours
        
        await expect(wrapper.setStaleTimeout(newTimeout))
          .to.emit(wrapper, "StaleTimeoutUpdated")
          .withArgs(3600, newTimeout); // Default is 3600 (1 hour)
        
        expect(await wrapper.staleTimeoutSeconds()).to.equal(newTimeout);
      });

      it("should revert when non-ORACLE_MANAGER tries to update stale timeout", async function () {
        const [, unauthorized] = await ethers.getSigners();
        const role = await wrapper.ORACLE_MANAGER_ROLE();
        
        await expect(wrapper.connect(unauthorized).setStaleTimeout(7200))
          .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
          .withArgs(await unauthorized.getAddress(), role);
      });

      it("should revert when setting timeout greater than 30 days", async function () {
        const tooLongTimeout = 31 * 24 * 3600; // 31 days
        
        await expect(wrapper.setStaleTimeout(tooLongTimeout))
          .to.be.revertedWithCustomError(wrapper, "InvalidStaleTimeout");
      });

      it("should allow setting timeout to 0 to disable stale checks", async function () {
        await expect(wrapper.setStaleTimeout(0))
          .to.emit(wrapper, "StaleTimeoutUpdated")
          .withArgs(3600, 0);
        
        expect(await wrapper.staleTimeoutSeconds()).to.equal(0);
      });
    });
  });
}
