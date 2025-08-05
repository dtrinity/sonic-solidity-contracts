import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { RedstoneChainlinkCompositeWrapperWithThresholding } from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getOracleAggregatorFixture,
  getRandomItemFromList,
  OracleAggregatorFixtureResult,
} from "./fixtures";

const CHAINLINK_HEARTBEAT_SECONDS = 86400; // 24 hours
const CHAINLINK_FEED_DECIMALS = 8;

describe("RedstoneChainlinkCompositeWrapperWithThresholding", () => {
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
async function runTestsForCurrency(
  currency: string,
  {
    deployer,
    user1,
    user2,
  }: { deployer: Address; user1: Address; user2: Address },
) {
  describe(`RedstoneChainlinkCompositeWrapperWithThresholding for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let redstoneChainlinkCompositeWrapperWithThresholding: RedstoneChainlinkCompositeWrapperWithThresholding;

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      redstoneChainlinkCompositeWrapperWithThresholding =
        fixtureResult.contracts
          .redstoneChainlinkCompositeWrapperWithThresholding;

      // Set the base currency for use in tests
      this.baseCurrency = currency;

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole =
        await redstoneChainlinkCompositeWrapperWithThresholding.ORACLE_MANAGER_ROLE();
      await redstoneChainlinkCompositeWrapperWithThresholding.grantRole(
        oracleManagerRole,
        deployer,
      );
    });

    describe("Base currency and units", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency =
          await redstoneChainlinkCompositeWrapperWithThresholding.BASE_CURRENCY();

        if (currency === "USD") {
          expect(baseCurrency).to.equal(hre.ethers.ZeroAddress);
        } else {
          expect(baseCurrency).to.not.equal(hre.ethers.ZeroAddress);
        }
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        const actualUnit =
          await redstoneChainlinkCompositeWrapperWithThresholding.BASE_CURRENCY_UNIT();
        const expectedUnit =
          BigInt(10) ** BigInt(fixtureResult.config.priceDecimals);
        expect(actualUnit).to.equal(expectedUnit);
      });
    });

    describe("Asset pricing with composite thresholding", () => {
      it("should correctly price composite assets", async function () {
        for (const [address, asset] of Object.entries(
          fixtureResult.assets.redstoneCompositeAssets,
        )) {
          const { price, isAlive } =
            await redstoneChainlinkCompositeWrapperWithThresholding.getPriceInfo(
              address,
            );

          expect(price).to.be.gt(0);
          expect(isAlive).to.be.true;

          const directPrice =
            await redstoneChainlinkCompositeWrapperWithThresholding.getAssetPrice(
              address,
            );
          expect(directPrice).to.equal(price);
        }
      });

      it("should handle thresholding for both primary and secondary prices", async function () {
        const testAsset = getRandomItemFromList(
          Object.keys(fixtureResult.assets.redstoneCompositeAssets),
        );

        // Deploy mock feeds for testing
        const mockFeed1 = await ethers.deployContract(
          "MockRedstoneChainlinkOracleAlwaysAlive",
        );
        const mockFeed2 = await ethers.deployContract(
          "MockRedstoneChainlinkOracleAlwaysAlive",
        );

        // Set up composite feed with thresholds
        const lowerThreshold1 = ethers.parseUnits(
          "0.99",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
        const fixedPrice1 = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
        const lowerThreshold2 = ethers.parseUnits(
          "0.98",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
        const fixedPrice2 = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );

        await redstoneChainlinkCompositeWrapperWithThresholding.addCompositeFeed(
          testAsset,
          await mockFeed1.getAddress(),
          await mockFeed2.getAddress(),
          lowerThreshold1,
          fixedPrice1,
          lowerThreshold2,
          fixedPrice2,
        );

        // Test when both prices are above thresholds
        const price1Above = ethers.parseUnits(
          "1.02",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
        const price2Above = ethers.parseUnits(
          "1.05",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );

        // Convert to 8 decimals for mock
        const mockPrice1Above8Decimals =
          (price1Above * BigInt(10) ** BigInt(CHAINLINK_FEED_DECIMALS)) /
          BigInt(10) ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const mockPrice2Above8Decimals =
          (price2Above * BigInt(10) ** BigInt(CHAINLINK_FEED_DECIMALS)) /
          BigInt(10) ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS);

        await mockFeed1.setMock(mockPrice1Above8Decimals);
        await mockFeed2.setMock(mockPrice2Above8Decimals);

        const { price: priceWithBothAbove, isAlive: isAliveWithBothAbove } =
          await redstoneChainlinkCompositeWrapperWithThresholding.getPriceInfo(
            testAsset,
          );

        // Both prices should be fixed
        const expectedPriceAbove =
          (fixedPrice1 * fixedPrice2) /
          ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        expect(priceWithBothAbove).to.equal(expectedPriceAbove);
        expect(isAliveWithBothAbove).to.be.true;

        // Test when one price is below threshold
        const price1Below = ethers.parseUnits(
          "0.95",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );

        // Convert to 8 decimals for mock
        const mockPrice1Below8Decimals =
          (price1Below * BigInt(10) ** BigInt(CHAINLINK_FEED_DECIMALS)) /
          BigInt(10) ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS);
        await mockFeed1.setMock(mockPrice1Below8Decimals);

        const { price: priceWithOneBelow } =
          await redstoneChainlinkCompositeWrapperWithThresholding.getPriceInfo(
            testAsset,
          );

        // Price1 should be unchanged (0.95) while price2 is fixed at 1.00
        const expectedPriceOneBelow =
          (price1Below * fixedPrice2) /
          ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        expect(priceWithOneBelow).to.equal(expectedPriceOneBelow);
      });

      it("should handle stale prices correctly", async function () {
        const testAsset = getRandomItemFromList(
          Object.keys(fixtureResult.assets.redstoneCompositeAssets),
        );

        // Deploy mock feeds for testing
        const mockFeed1 = await ethers.deployContract(
          "MockRedstoneChainlinkOracleAlwaysAlive",
        );
        const mockFeed2 = await ethers.deployContract(
          "MockRedstoneChainlinkOracleAlwaysAlive",
        );

        await redstoneChainlinkCompositeWrapperWithThresholding.addCompositeFeed(
          testAsset,
          await mockFeed1.getAddress(),
          await mockFeed2.getAddress(),
          0,
          0,
          0,
          0,
        );
      });

      it("should revert when getting price for non-existent asset", async function () {
        const nonExistentAsset = "0x000000000000000000000000000000000000dEaD";
        await expect(
          redstoneChainlinkCompositeWrapperWithThresholding.getPriceInfo(
            nonExistentAsset,
          ),
        )
          .to.be.revertedWithCustomError(
            redstoneChainlinkCompositeWrapperWithThresholding,
            "FeedNotSet",
          )
          .withArgs(nonExistentAsset);

        await expect(
          redstoneChainlinkCompositeWrapperWithThresholding.getAssetPrice(
            nonExistentAsset,
          ),
        )
          .to.be.revertedWithCustomError(
            redstoneChainlinkCompositeWrapperWithThresholding,
            "FeedNotSet",
          )
          .withArgs(nonExistentAsset);
      });
    });

    describe("Feed management", () => {
      it("should allow adding and removing composite feeds", async function () {
        const testAsset = getRandomItemFromList(
          Object.keys(fixtureResult.assets.redstoneCompositeAssets),
        );
        const feed1 = "0x2345678901234567890123456789012345678901";
        const feed2 = "0x3456789012345678901234567890123456789012";
        const lowerThreshold1 = ethers.parseUnits(
          "0.99",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
        const fixedPrice1 = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
        const lowerThreshold2 = ethers.parseUnits(
          "0.98",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
        const fixedPrice2 = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );

        // Add composite feed
        await expect(
          redstoneChainlinkCompositeWrapperWithThresholding.addCompositeFeed(
            testAsset,
            feed1,
            feed2,
            lowerThreshold1,
            fixedPrice1,
            lowerThreshold2,
            fixedPrice2,
          ),
        )
          .to.emit(
            redstoneChainlinkCompositeWrapperWithThresholding,
            "CompositeFeedAdded",
          )
          .withArgs(
            testAsset,
            feed1,
            feed2,
            lowerThreshold1,
            fixedPrice1,
            lowerThreshold2,
            fixedPrice2,
          );

        // Verify feed configuration
        const feed =
          await redstoneChainlinkCompositeWrapperWithThresholding.compositeFeeds(
            testAsset,
          );
        expect(feed.feed1).to.equal(feed1);
        expect(feed.feed2).to.equal(feed2);
        expect(feed.primaryThreshold.lowerThresholdInBase).to.equal(
          lowerThreshold1,
        );
        expect(feed.primaryThreshold.fixedPriceInBase).to.equal(fixedPrice1);
        expect(feed.secondaryThreshold.lowerThresholdInBase).to.equal(
          lowerThreshold2,
        );
        expect(feed.secondaryThreshold.fixedPriceInBase).to.equal(fixedPrice2);

        // Remove feed
        await expect(
          redstoneChainlinkCompositeWrapperWithThresholding.removeCompositeFeed(
            testAsset,
          ),
        )
          .to.emit(
            redstoneChainlinkCompositeWrapperWithThresholding,
            "CompositeFeedRemoved",
          )
          .withArgs(testAsset);

        // Verify feed is removed
        const removedFeed =
          await redstoneChainlinkCompositeWrapperWithThresholding.compositeFeeds(
            testAsset,
          );
        expect(removedFeed.feed1).to.equal(ethers.ZeroAddress);
        expect(removedFeed.feed2).to.equal(ethers.ZeroAddress);
      });

      it("should revert when non-ORACLE_MANAGER tries to manage feeds", async function () {
        const testAsset = getRandomItemFromList(
          Object.keys(fixtureResult.assets.redstoneCompositeAssets),
        );
        const feed1 = "0x2345678901234567890123456789012345678901";
        const feed2 = "0x3456789012345678901234567890123456789012";

        const unauthorizedSigner = await ethers.getSigner(user2);
        const oracleManagerRole =
          await redstoneChainlinkCompositeWrapperWithThresholding.ORACLE_MANAGER_ROLE();

        await expect(
          redstoneChainlinkCompositeWrapperWithThresholding
            .connect(unauthorizedSigner)
            .addCompositeFeed(testAsset, feed1, feed2, 0, 0, 0, 0),
        )
          .to.be.revertedWithCustomError(
            redstoneChainlinkCompositeWrapperWithThresholding,
            "AccessControlUnauthorizedAccount",
          )
          .withArgs(user2, oracleManagerRole);

        await expect(
          redstoneChainlinkCompositeWrapperWithThresholding
            .connect(unauthorizedSigner)
            .removeCompositeFeed(testAsset),
        )
          .to.be.revertedWithCustomError(
            redstoneChainlinkCompositeWrapperWithThresholding,
            "AccessControlUnauthorizedAccount",
          )
          .withArgs(user2, oracleManagerRole);
      });
    });
  });
}
