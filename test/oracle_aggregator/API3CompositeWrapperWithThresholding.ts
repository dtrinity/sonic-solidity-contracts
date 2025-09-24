import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { API3CompositeWrapperWithThresholding } from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { getOracleAggregatorFixture, getRandomItemFromList, OracleAggregatorFixtureResult } from "./fixtures";

const API3_HEARTBEAT_SECONDS = 86400; // 24 hours

describe("API3CompositeWrapperWithThresholding", () => {
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  before(async () => {
    ({ deployer, user1, user2 } = await getNamedAccounts());
  });

  // Run tests for each oracle aggregator configuration
  it("should run tests for each oracle aggregator", async () => {
    const config = await getConfig(hre);
    const currencies = Object.keys(config.oracleAggregators);

    // Run tests for each currency sequentially
    for (const currency of currencies) {
      await runTestsForCurrency(currency, { deployer, user1, user2 });
    }
  });
});

/**
 *
 * @param currency
 * @param root0
 * @param root0.deployer
 * @param root0.user1
 * @param root0.user2
 */
async function runTestsForCurrency(currency: string, { deployer, user1, user2 }: { deployer: Address; user1: Address; user2: Address }) {
  describe(`API3CompositeWrapperWithThresholding for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let api3CompositeWrapperWithThresholding: API3CompositeWrapperWithThresholding;

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      api3CompositeWrapperWithThresholding = fixtureResult.contracts.api3CompositeWrapperWithThresholding;

      // Skip suite if no relevant assets configured for this wrapper type
      if (Object.keys(fixtureResult.assets.api3CompositeAssets).length === 0) {
        this.skip();
      }

      // Set the base currency for use in tests
      this.baseCurrency = currency;

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole = await api3CompositeWrapperWithThresholding.ORACLE_MANAGER_ROLE();
      await api3CompositeWrapperWithThresholding.grantRole(oracleManagerRole, deployer);
    });

    describe("Base currency and units", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency = await api3CompositeWrapperWithThresholding.BASE_CURRENCY();

        if (currency === "USD") {
          expect(baseCurrency).to.equal(hre.ethers.ZeroAddress);
        } else {
          expect(baseCurrency).to.not.equal(hre.ethers.ZeroAddress);
        }
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        const actualUnit = await api3CompositeWrapperWithThresholding.BASE_CURRENCY_UNIT();
        const expectedUnit = BigInt(10) ** BigInt(fixtureResult.config.priceDecimals);
        expect(actualUnit).to.equal(expectedUnit);
      });
    });

    describe("Asset pricing with composite thresholding", () => {
      it("should correctly price composite assets", async function () {
        // NOTE: Keep this check as it iterates directly
        if (Object.keys(fixtureResult.assets.api3CompositeAssets).length === 0) {
          this.skip();
        }

        for (const [address, asset] of Object.entries(fixtureResult.assets.api3CompositeAssets)) {
          const { price, isAlive } = await api3CompositeWrapperWithThresholding.getPriceInfo(address);

          expect(price).to.be.gt(0);
          expect(isAlive).to.be.true;

          const directPrice = await api3CompositeWrapperWithThresholding.getAssetPrice(address);
          expect(directPrice).to.equal(price);
        }
      });

      it("should handle thresholding for both primary and secondary prices", async function () {
        // NOTE: Keep this check as it uses getRandomItemFromList
        const compositeAssets = Object.keys(fixtureResult.assets.api3CompositeAssets);

        if (compositeAssets.length === 0) {
          this.skip();
        }
        const testAsset = getRandomItemFromList(compositeAssets);

        // Deploy mock oracles for testing
        const MockAPI3OracleFactory = await ethers.getContractFactory("MockAPI3Oracle");
        const mockOracle1 = await MockAPI3OracleFactory.deploy(deployer);
        const mockOracle2 = await MockAPI3OracleFactory.deploy(deployer);

        // Set up composite feed with thresholds
        const lowerThreshold1 = ethers.parseUnits("0.99", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const fixedPrice1 = ethers.parseUnits("1.00", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const lowerThreshold2 = ethers.parseUnits("0.98", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const fixedPrice2 = ethers.parseUnits("1.00", ORACLE_AGGREGATOR_PRICE_DECIMALS);

        await api3CompositeWrapperWithThresholding.addCompositeFeed(
          testAsset,
          await mockOracle1.getAddress(),
          await mockOracle2.getAddress(),
          lowerThreshold1,
          fixedPrice1,
          lowerThreshold2,
          fixedPrice2,
        );

        // Test when both prices are above thresholds
        const price1Above = ethers.parseUnits("1.02", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const price2Above = ethers.parseUnits("1.05", ORACLE_AGGREGATOR_PRICE_DECIMALS);

        const currentBlock = await ethers.provider.getBlock("latest");
        if (!currentBlock) throw new Error("Failed to get current block");

        await mockOracle1.setMock(price1Above, currentBlock.timestamp);
        await mockOracle2.setMock(price2Above, currentBlock.timestamp);

        const { price: priceWithBothAbove, isAlive: isAliveWithBothAbove } =
          await api3CompositeWrapperWithThresholding.getPriceInfo(testAsset);

        // Both prices should be fixed
        const expectedPriceAbove = (fixedPrice1 * fixedPrice2) / ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        expect(priceWithBothAbove).to.equal(expectedPriceAbove);
        expect(isAliveWithBothAbove).to.be.true;

        // Test when one price is below threshold
        const price1Below = ethers.parseUnits("0.95", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        await mockOracle1.setMock(price1Below, currentBlock.timestamp);

        const { price: priceWithOneBelow } = await api3CompositeWrapperWithThresholding.getPriceInfo(testAsset);

        // Price1 should be unchanged (0.95) while price2 is fixed at 1.00
        const expectedPriceOneBelow = (price1Below * fixedPrice2) / ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        expect(priceWithOneBelow).to.equal(expectedPriceOneBelow);
      });

      it("should handle stale prices correctly", async function () {
        // NOTE: Keep this check as it uses getRandomItemFromList
        const compositeAssets = Object.keys(fixtureResult.assets.api3CompositeAssets);

        if (compositeAssets.length === 0) {
          this.skip();
        }
        const testAsset = getRandomItemFromList(compositeAssets);

        // Deploy mock oracles for testing
        const MockAPI3OracleFactory = await ethers.getContractFactory("MockAPI3Oracle");
        const mockOracle1 = await MockAPI3OracleFactory.deploy(deployer);
        const mockOracle2 = await MockAPI3OracleFactory.deploy(deployer);

        await api3CompositeWrapperWithThresholding.addCompositeFeed(
          testAsset,
          await mockOracle1.getAddress(),
          await mockOracle2.getAddress(),
          0,
          0,
          0,
          0,
        );

        // Set a stale price for one oracle
        const price = ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const currentBlock = await ethers.provider.getBlock("latest");
        if (!currentBlock) throw new Error("Failed to get current block");

        const staleTimestamp = currentBlock.timestamp - API3_HEARTBEAT_SECONDS * 2;
        await mockOracle1.setMock(price, staleTimestamp);
        await mockOracle2.setMock(price, currentBlock.timestamp);

        // getPriceInfo should return false for isAlive
        const { isAlive } = await api3CompositeWrapperWithThresholding.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;

        // getAssetPrice should revert
        await expect(api3CompositeWrapperWithThresholding.getAssetPrice(testAsset)).to.be.revertedWithCustomError(
          api3CompositeWrapperWithThresholding,
          "PriceIsStale",
        );
      });

      it("should revert when getting price for non-existent asset", async function () {
        const nonExistentAsset = "0x000000000000000000000000000000000000dEaD";
        await expect(api3CompositeWrapperWithThresholding.getPriceInfo(nonExistentAsset))
          .to.be.revertedWithCustomError(api3CompositeWrapperWithThresholding, "FeedNotSet")
          .withArgs(nonExistentAsset);

        await expect(api3CompositeWrapperWithThresholding.getAssetPrice(nonExistentAsset))
          .to.be.revertedWithCustomError(api3CompositeWrapperWithThresholding, "FeedNotSet")
          .withArgs(nonExistentAsset);
      });
    });

    describe("Feed management", () => {
      it("should allow adding and removing composite feeds", async function () {
        // NOTE: Keep this check as it uses getRandomItemFromList
        const compositeAssets = Object.keys(fixtureResult.assets.api3CompositeAssets);

        if (compositeAssets.length === 0) {
          this.skip();
        }
        const testAsset = getRandomItemFromList(compositeAssets);
        const proxy1 = "0x2345678901234567890123456789012345678901";
        const proxy2 = "0x3456789012345678901234567890123456789012";
        const lowerThreshold1 = ethers.parseUnits("0.99", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const fixedPrice1 = ethers.parseUnits("1.00", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const lowerThreshold2 = ethers.parseUnits("0.98", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const fixedPrice2 = ethers.parseUnits("1.00", ORACLE_AGGREGATOR_PRICE_DECIMALS);

        // Add composite feed
        await expect(
          api3CompositeWrapperWithThresholding.addCompositeFeed(
            testAsset,
            proxy1,
            proxy2,
            lowerThreshold1,
            fixedPrice1,
            lowerThreshold2,
            fixedPrice2,
          ),
        )
          .to.emit(api3CompositeWrapperWithThresholding, "CompositeFeedAdded")
          .withArgs(testAsset, proxy1, proxy2, lowerThreshold1, fixedPrice1, lowerThreshold2, fixedPrice2);

        // Verify feed configuration
        const feed = await api3CompositeWrapperWithThresholding.compositeFeeds(testAsset);
        expect(feed.proxy1).to.equal(proxy1);
        expect(feed.proxy2).to.equal(proxy2);
        expect(feed.primaryThreshold.lowerThresholdInBase).to.equal(lowerThreshold1);
        expect(feed.primaryThreshold.fixedPriceInBase).to.equal(fixedPrice1);
        expect(feed.secondaryThreshold.lowerThresholdInBase).to.equal(lowerThreshold2);
        expect(feed.secondaryThreshold.fixedPriceInBase).to.equal(fixedPrice2);

        // Remove feed
        await expect(api3CompositeWrapperWithThresholding.removeCompositeFeed(testAsset))
          .to.emit(api3CompositeWrapperWithThresholding, "CompositeFeedRemoved")
          .withArgs(testAsset);

        // Verify feed is removed
        const removedFeed = await api3CompositeWrapperWithThresholding.compositeFeeds(testAsset);
        expect(removedFeed.proxy1).to.equal(ethers.ZeroAddress);
        expect(removedFeed.proxy2).to.equal(ethers.ZeroAddress);
      });

      it("should revert when non-ORACLE_MANAGER tries to manage feeds", async function () {
        // NOTE: Keep this check as it uses getRandomItemFromList
        const compositeAssets = Object.keys(fixtureResult.assets.api3CompositeAssets);

        if (compositeAssets.length === 0) {
          this.skip();
        }
        const testAsset = getRandomItemFromList(compositeAssets);
        const proxy1 = "0x2345678901234567890123456789012345678901";
        const proxy2 = "0x3456789012345678901234567890123456789012";

        const unauthorizedSigner = await ethers.getSigner(user2);
        const oracleManagerRole = await api3CompositeWrapperWithThresholding.ORACLE_MANAGER_ROLE();

        await expect(
          api3CompositeWrapperWithThresholding.connect(unauthorizedSigner).addCompositeFeed(testAsset, proxy1, proxy2, 0, 0, 0, 0),
        )
          .to.be.revertedWithCustomError(api3CompositeWrapperWithThresholding, "AccessControlUnauthorizedAccount")
          .withArgs(user2, oracleManagerRole);

        await expect(api3CompositeWrapperWithThresholding.connect(unauthorizedSigner).removeCompositeFeed(testAsset))
          .to.be.revertedWithCustomError(api3CompositeWrapperWithThresholding, "AccessControlUnauthorizedAccount")
          .withArgs(user2, oracleManagerRole);
      });
    });
  });
}
