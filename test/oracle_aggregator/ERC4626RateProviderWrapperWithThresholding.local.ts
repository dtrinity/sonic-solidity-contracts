import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

describe("ERC4626RateProviderWrapperWithThresholding", () => {
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
  describe(`ERC4626RateProviderWrapperWithThresholding for ${currency}`, () => {
    let wrapper: any;
    let underlying: any;
    let vault: any;
    let rateProvider: any;
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

      // Deploy wrapper
      const Factory = await ethers.getContractFactory(
        "ERC4626SafeRateProviderWrapperWithThresholding",
        signer,
      );
      wrapper = await Factory.deploy(BASE_CURRENCY_EXPECTED, BASE_UNIT);
      await wrapper.waitForDeployment();

      // Random asset key for mapping
      assetKey = ethers.Wallet.createRandom().address;
      await wrapper.setFeed(
        assetKey,
        await vault.getAddress(),
        await rateProvider.getAddress(),
        UNIT,
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

    describe("Asset pricing with thresholding", () => {
      it("composes ERC4626(share->assets) and rate provider into BASE_UNIT", async function () {
        const sharesDec: number = await vault.decimals();
        const sharesUnit = 10n ** BigInt(sharesDec);
        const assetsPerOneShare: bigint = await vault.convertToAssets(sharesUnit);
        const uDec = await (await ethers.getContractAt(
          ["function decimals() view returns (uint8)"],
          await vault.asset(),
        )).decimals();
        const priceInBase1 = (assetsPerOneShare * BASE_UNIT) / (10n ** BigInt(uDec));

        const UNIT: bigint = await rateProvider.UNIT();
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / UNIT;

        const expected = (priceInBase1 * priceInBase2) / BASE_UNIT;
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

        const UNIT: bigint = await rateProvider.UNIT();
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / UNIT;

        const fixed1 = priceInBase1;
        const lower1 = priceInBase1 - 1n;
        await wrapper.updateFeed(assetKey, UNIT, lower1, fixed1, 0, 0);

        const expected = (fixed1 * priceInBase2) / BASE_UNIT;
        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });

      it("applies secondary threshold (rate leg)", async function () {
        const sharesDec: number = await vault.decimals();
        const sharesUnit = 10n ** BigInt(sharesDec);
        const assetsPerOneShare: bigint = await vault.convertToAssets(sharesUnit);
        const uDec = await (await ethers.getContractAt(
          ["function decimals() view returns (uint8)"],
          await vault.asset(),
        )).decimals();
        const priceInBase1 = (assetsPerOneShare * BASE_UNIT) / (10n ** BigInt(uDec));

        const UNIT: bigint = await rateProvider.UNIT();
        const rp: bigint = await rateProvider.getRate();
        const priceInBase2 = (rp * BASE_UNIT) / UNIT;

        const fixed2 = priceInBase2;
        const lower2 = priceInBase2 - 1n;
        await wrapper.updateFeed(assetKey, UNIT, 0, 0, lower2, fixed2);

        const expected = (priceInBase1 * fixed2) / BASE_UNIT;
        const { price } = await wrapper.getPriceInfo(assetKey);
        expect(price).to.equal(expected);
      });
    });

    describe("Feed management", () => {
      it("should allow adding and removing feeds", async function () {
        const UNIT = 10n ** 6n;
        const RATE = 980_150n;
        const newAsset = ethers.Wallet.createRandom().address;

        // Emit FeedSet
        await expect(
          wrapper.setFeed(
            newAsset,
            await vault.getAddress(),
            await rateProvider.getAddress(),
            UNIT,
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
            UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
            1n * BASE_UNIT,
          );

        // Verify config in storage
        const feed = await wrapper.feeds(newAsset);
        expect(feed.erc4626Vault).to.equal(await vault.getAddress());
        expect(feed.rateProvider).to.equal(await rateProvider.getAddress());
        expect(feed.rateProviderUnit).to.equal(UNIT);
        expect(feed.primaryThreshold.lowerThresholdInBase).to.equal(1n * BASE_UNIT);
        expect(feed.primaryThreshold.fixedPriceInBase).to.equal(1n * BASE_UNIT);
        expect(feed.secondaryThreshold.lowerThresholdInBase).to.equal(1n * BASE_UNIT);
        expect(feed.secondaryThreshold.fixedPriceInBase).to.equal(1n * BASE_UNIT);

        // Remove and verify
        await expect(wrapper.removeFeed(newAsset))
          .to.emit(wrapper, "FeedRemoved")
          .withArgs(newAsset);
        const removed = await wrapper.feeds(newAsset);
        expect(removed.erc4626Vault).to.equal(ethers.ZeroAddress);
        expect(removed.rateProvider).to.equal(ethers.ZeroAddress);
      });

      it("should allow updating feed thresholds and unit", async function () {
        const UNIT = 10n ** 6n;
        const newUnit = 10n ** 6n; // keep same for simplicity
        const lower1 = 5n * (BASE_UNIT / 10n);
        const fixed1 = 1n * BASE_UNIT;
        const lower2 = 4n * (BASE_UNIT / 10n);
        const fixed2 = 1n * BASE_UNIT;

        await expect(wrapper.updateFeed(assetKey, newUnit, lower1, fixed1, lower2, fixed2))
          .to.emit(wrapper, "FeedUpdated")
          .withArgs(assetKey, newUnit, lower1, fixed1, lower2, fixed2);

        const feed = await wrapper.feeds(assetKey);
        expect(feed.rateProviderUnit).to.equal(newUnit);
        expect(feed.primaryThreshold.lowerThresholdInBase).to.equal(lower1);
        expect(feed.primaryThreshold.fixedPriceInBase).to.equal(fixed1);
        expect(feed.secondaryThreshold.lowerThresholdInBase).to.equal(lower2);
        expect(feed.secondaryThreshold.fixedPriceInBase).to.equal(fixed2);
      });

      it("should revert when non-ORACLE_MANAGER tries to manage feeds", async function () {
        const [, unauthorized] = await ethers.getSigners();
        const role = await wrapper.ORACLE_MANAGER_ROLE();
        const newAsset = ethers.Wallet.createRandom().address;

        await expect(
          wrapper
            .connect(unauthorized)
            .setFeed(newAsset, await vault.getAddress(), await rateProvider.getAddress(), 10n ** 6n, 0, 0, 0, 0),
        )
          .to.be.revertedWithCustomError(wrapper, "AccessControlUnauthorizedAccount")
          .withArgs(await unauthorized.getAddress(), role);

        await expect(
          wrapper.connect(unauthorized).updateFeed(assetKey, 10n ** 6n, 0, 0, 0, 0),
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
  });
}


