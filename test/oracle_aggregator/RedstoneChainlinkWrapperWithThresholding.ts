import { expect } from "chai";
import hre, { getNamedAccounts, ethers } from "hardhat";
import { Address } from "hardhat-deploy/types";
import {
  getOracleAggregatorFixture,
  OracleAggregatorFixtureResult,
  getRandomTestAsset,
} from "./fixtures";
import { getConfig } from "../../config/config";
import { RedstoneChainlinkWrapperWithThresholding } from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";

const CHAINLINK_HEARTBEAT_SECONDS = 86400; // 24 hours

describe("RedstoneChainlinkWrapperWithThresholding", () => {
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

async function runTestsForCurrency(
  currency: string,
  {
    deployer,
    user1,
    user2,
  }: { deployer: Address; user1: Address; user2: Address }
) {
  describe(`RedstoneChainlinkWrapperWithThresholding for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let redstoneChainlinkWrapperWithThresholding: RedstoneChainlinkWrapperWithThresholding;

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      redstoneChainlinkWrapperWithThresholding =
        fixtureResult.contracts.redstoneChainlinkWrapperWithThresholding;

      // Set the base currency for use in tests
      this.baseCurrency = currency;

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole =
        await redstoneChainlinkWrapperWithThresholding.ORACLE_MANAGER_ROLE();
      await redstoneChainlinkWrapperWithThresholding.grantRole(
        oracleManagerRole,
        deployer
      );
    });

    describe("Base currency and units", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency =
          await redstoneChainlinkWrapperWithThresholding.BASE_CURRENCY();

        if (currency === "USD") {
          expect(baseCurrency).to.equal(hre.ethers.ZeroAddress);
        } else {
          expect(baseCurrency).to.not.equal(hre.ethers.ZeroAddress);
        }
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        const actualUnit =
          await redstoneChainlinkWrapperWithThresholding.BASE_CURRENCY_UNIT();
        const expectedUnit =
          BigInt(10) ** BigInt(fixtureResult.config.priceDecimals);
        expect(actualUnit).to.equal(expectedUnit);
      });
    });

    describe("Asset pricing with thresholding", () => {
      it("should return original price when no threshold is set", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Deploy a new MockChainlinkFeed for testing
        const mockFeed = await ethers.deployContract("MockChainlinkFeed", [
          deployer,
        ]);

        // Set the feed for our test asset
        await redstoneChainlinkWrapperWithThresholding.setFeed(
          testAsset,
          await mockFeed.getAddress()
        );

        // Set a test price
        const testPrice = ethers.parseUnits(
          "1",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const currentBlock = await ethers.provider.getBlock("latest");
        if (!currentBlock) {
          throw new Error("Failed to get current block");
        }

        await mockFeed.setMock(testPrice, currentBlock.timestamp);

        // Get price info
        const { price: actualPrice, isAlive } =
          await redstoneChainlinkWrapperWithThresholding.getPriceInfo(
            testAsset
          );

        // Verify price and status
        expect(actualPrice).to.equal(testPrice);
        expect(isAlive).to.be.true;

        // Verify getAssetPrice returns the same value
        const directPrice =
          await redstoneChainlinkWrapperWithThresholding.getAssetPrice(
            testAsset
          );
        expect(directPrice).to.equal(testPrice);
      });

      it("should return fixed price when price is above threshold", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Deploy a new MockChainlinkFeed for testing
        const mockFeed = await ethers.deployContract("MockChainlinkFeed", [
          deployer,
        ]);

        // Set the feed for our test asset
        await redstoneChainlinkWrapperWithThresholding.setFeed(
          testAsset,
          await mockFeed.getAddress()
        );

        // Set threshold configuration
        const lowerThreshold = ethers.parseUnits(
          "0.99",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const fixedPrice = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        await redstoneChainlinkWrapperWithThresholding.setThresholdConfig(
          testAsset,
          lowerThreshold,
          fixedPrice
        );

        // Set a price above threshold
        const priceAboveThreshold = ethers.parseUnits(
          "1.02",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const currentBlock = await ethers.provider.getBlock("latest");
        if (!currentBlock) {
          throw new Error("Failed to get current block");
        }

        await mockFeed.setMock(priceAboveThreshold, currentBlock.timestamp);

        // Get price info
        const { price: actualPrice, isAlive } =
          await redstoneChainlinkWrapperWithThresholding.getPriceInfo(
            testAsset
          );

        // Verify price and status
        expect(actualPrice).to.equal(fixedPrice);
        expect(isAlive).to.be.true;

        // Verify getAssetPrice returns the same value
        const directPrice =
          await redstoneChainlinkWrapperWithThresholding.getAssetPrice(
            testAsset
          );
        expect(directPrice).to.equal(fixedPrice);
      });

      it("should handle stale prices correctly", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Deploy a new MockChainlinkFeed for testing
        const mockFeed = await ethers.deployContract("MockChainlinkFeed", [
          deployer,
        ]);

        // Set the feed for our test asset
        await redstoneChainlinkWrapperWithThresholding.setFeed(
          testAsset,
          await mockFeed.getAddress()
        );

        // Set threshold configuration
        const lowerThreshold = ethers.parseUnits(
          "0.99",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const fixedPrice = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        await redstoneChainlinkWrapperWithThresholding.setThresholdConfig(
          testAsset,
          lowerThreshold,
          fixedPrice
        );

        // Set a stale price
        const price = ethers.parseUnits(
          "0.98",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const currentBlock = await ethers.provider.getBlock("latest");
        if (!currentBlock) {
          throw new Error("Failed to get current block");
        }

        const staleTimestamp =
          currentBlock.timestamp - CHAINLINK_HEARTBEAT_SECONDS * 2;
        await mockFeed.setMock(price, staleTimestamp);

        // getPriceInfo should return false for isAlive
        const { isAlive } =
          await redstoneChainlinkWrapperWithThresholding.getPriceInfo(
            testAsset
          );
        expect(isAlive).to.be.false;

        // getAssetPrice should revert
        await expect(
          redstoneChainlinkWrapperWithThresholding.getAssetPrice(testAsset)
        ).to.be.revertedWithCustomError(
          redstoneChainlinkWrapperWithThresholding,
          "PriceIsStale"
        );
      });
    });

    describe("Threshold configuration management", () => {
      it("should allow setting and removing threshold config", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Set threshold configuration
        const lowerThreshold = ethers.parseUnits(
          "0.99",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const fixedPrice = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );

        await expect(
          redstoneChainlinkWrapperWithThresholding.setThresholdConfig(
            testAsset,
            lowerThreshold,
            fixedPrice
          )
        )
          .to.emit(
            redstoneChainlinkWrapperWithThresholding,
            "ThresholdConfigSet"
          )
          .withArgs(testAsset, lowerThreshold, fixedPrice);

        // Verify config
        const config =
          await redstoneChainlinkWrapperWithThresholding.assetThresholds(
            testAsset
          );
        expect(config.lowerThresholdInBase).to.equal(lowerThreshold);
        expect(config.fixedPriceInBase).to.equal(fixedPrice);

        // Remove threshold config
        await expect(
          redstoneChainlinkWrapperWithThresholding.removeThresholdConfig(
            testAsset
          )
        )
          .to.emit(
            redstoneChainlinkWrapperWithThresholding,
            "ThresholdConfigRemoved"
          )
          .withArgs(testAsset);

        // Verify config is removed
        const removedConfig =
          await redstoneChainlinkWrapperWithThresholding.assetThresholds(
            testAsset
          );
        expect(removedConfig.lowerThresholdInBase).to.equal(0);
        expect(removedConfig.fixedPriceInBase).to.equal(0);
      });

      it("should revert when non-ORACLE_MANAGER tries to set threshold config", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        const lowerThreshold = ethers.parseUnits(
          "0.99",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const fixedPrice = ethers.parseUnits(
          "1.00",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );

        const unauthorizedSigner = await ethers.getSigner(user2);
        const oracleManagerRole =
          await redstoneChainlinkWrapperWithThresholding.ORACLE_MANAGER_ROLE();

        await expect(
          redstoneChainlinkWrapperWithThresholding
            .connect(unauthorizedSigner)
            .setThresholdConfig(testAsset, lowerThreshold, fixedPrice)
        )
          .to.be.revertedWithCustomError(
            redstoneChainlinkWrapperWithThresholding,
            "AccessControlUnauthorizedAccount"
          )
          .withArgs(user2, oracleManagerRole);
      });

      it("should revert when non-ORACLE_MANAGER tries to remove threshold config", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        const unauthorizedSigner = await ethers.getSigner(user2);
        const oracleManagerRole =
          await redstoneChainlinkWrapperWithThresholding.ORACLE_MANAGER_ROLE();

        await expect(
          redstoneChainlinkWrapperWithThresholding
            .connect(unauthorizedSigner)
            .removeThresholdConfig(testAsset)
        )
          .to.be.revertedWithCustomError(
            redstoneChainlinkWrapperWithThresholding,
            "AccessControlUnauthorizedAccount"
          )
          .withArgs(user2, oracleManagerRole);
      });
    });
  });
}
