import { expect } from "chai";
import { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { ChainlinkCompositeAggregator } from "../../typechain-types";

const CHAINLINK_HEARTBEAT_SECONDS = 86400; // 24 hours

describe("ChainlinkCompositeAggregator", () => {
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  before(async () => {
    ({ deployer, user1, user2 } = await getNamedAccounts());
  });

  describe("Constructor and initialization", () => {
    it("should initialize with correct parameters", async () => {
      // Deploy mock feeds
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Mock Feed 1"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Mock Feed 2"]);

      const primaryThreshold = {
        lowerThresholdInBase: ethers.parseUnits("0.99", 8),
        fixedPriceInBase: ethers.parseUnits("1.00", 8),
      };
      const secondaryThreshold = {
        lowerThresholdInBase: ethers.parseUnits("0.98", 8),
        fixedPriceInBase: ethers.parseUnits("1.00", 8),
      };

      const compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        primaryThreshold,
        secondaryThreshold,
      ]);

      // Verify initialization
      expect(await compositeAggregator.sourceFeed1()).to.equal(await mockFeed1.getAddress());
      expect(await compositeAggregator.sourceFeed2()).to.equal(await mockFeed2.getAddress());
      expect(await compositeAggregator.decimals()).to.equal(8);
      expect(await compositeAggregator.CHAINLINK_BASE_CURRENCY_UNIT()).to.equal(ethers.parseUnits("1", 8));

      const storedPrimaryThreshold = await compositeAggregator.primaryThreshold();
      expect(storedPrimaryThreshold.lowerThresholdInBase).to.equal(primaryThreshold.lowerThresholdInBase);
      expect(storedPrimaryThreshold.fixedPriceInBase).to.equal(primaryThreshold.fixedPriceInBase);

      const storedSecondaryThreshold = await compositeAggregator.secondaryThreshold();
      expect(storedSecondaryThreshold.lowerThresholdInBase).to.equal(secondaryThreshold.lowerThresholdInBase);
      expect(storedSecondaryThreshold.fixedPriceInBase).to.equal(secondaryThreshold.fixedPriceInBase);
    });

    it("should revert with zero feed addresses", async () => {
      const mockFeed = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Mock Feed"]);
      const primaryThreshold = {
        lowerThresholdInBase: 0,
        fixedPriceInBase: 0,
      };
      const secondaryThreshold = {
        lowerThresholdInBase: 0,
        fixedPriceInBase: 0,
      };

      // Get the factory to access the interface
      const ChainlinkCompositeAggregatorFactory = await ethers.getContractFactory("ChainlinkCompositeAggregator");

      // Test zero address for first feed
      await expect(
        ethers.deployContract("ChainlinkCompositeAggregator", [
          ethers.ZeroAddress,
          await mockFeed.getAddress(),
          primaryThreshold,
          secondaryThreshold,
        ]),
      ).to.be.revertedWithCustomError(ChainlinkCompositeAggregatorFactory, "ZeroFeedAddress");

      // Test zero address for second feed
      await expect(
        ethers.deployContract("ChainlinkCompositeAggregator", [
          await mockFeed.getAddress(),
          ethers.ZeroAddress,
          primaryThreshold,
          secondaryThreshold,
        ]),
      ).to.be.revertedWithCustomError(ChainlinkCompositeAggregatorFactory, "ZeroFeedAddress");
    });

    it("should return correct description", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "ETH/USD"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "USD/EUR"]);

      const compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      const description = await compositeAggregator.description();
      expect(description).to.include("ETH/USD");
      expect(description).to.include("USD/EUR");
      expect(description).to.include("Composite");
    });

    it("should return correct version", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      const compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      expect(await compositeAggregator.version()).to.equal(1);
    });
  });

  describe("Price composition without thresholding", () => {
    let compositeAggregator: ChainlinkCompositeAggregator;
    let mockFeed1: any;
    let mockFeed2: any;

    beforeEach(async () => {
      mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 }, // No thresholding
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 }, // No thresholding
      ]);
    });

    it("should correctly compose prices from two feeds", async () => {
      // Set mock prices: feed1 = 2.0, feed2 = 3.0
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeAggregator.latestRoundData();
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("3.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
      expect(roundData.roundId).to.be.gt(0);
      expect(roundData.startedAt).to.be.gt(0);
      expect(roundData.updatedAt).to.be.gt(0);
      expect(roundData.answeredInRound).to.be.gt(0);
    });

    it("should handle different decimal precisions", async () => {
      // Create feeds with different decimals
      const mockFeed1_18 = await ethers.deployContract("MockChainlinkAggregatorV3", [18, "Feed 1"]);
      const mockFeed2_6 = await ethers.deployContract("MockChainlinkAggregatorV3", [6, "Feed 2"]);

      const compositeAggregatorMixed = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1_18.getAddress(),
        await mockFeed2_6.getAddress(),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      // Set mock prices: feed1 = 2.0 (18 decimals), feed2 = 3.0 (6 decimals)
      await mockFeed1_18.setMock(ethers.parseUnits("2.0", 18));
      await mockFeed2_6.setMock(ethers.parseUnits("3.0", 6));

      const roundData = await compositeAggregatorMixed.latestRoundData();
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("3.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });

    it("should handle negative prices by converting to zero", async () => {
      // Set negative prices
      await mockFeed1.setMock(-ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeAggregator.latestRoundData();
      // Negative price should be converted to 0, so result should be 0
      expect(roundData.answer).to.equal(0);
    });

    it("should return latest data for getRoundData regardless of roundId", async () => {
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundId = 123;
      const roundData = await compositeAggregator.getRoundData(roundId);
      const latestRoundData = await compositeAggregator.latestRoundData();

      // getRoundData should return the same as latestRoundData (ignoring roundId)
      expect(roundData.answer).to.equal(latestRoundData.answer);
      expect(roundData.startedAt).to.equal(latestRoundData.startedAt);
      expect(roundData.updatedAt).to.equal(latestRoundData.updatedAt);
    });
  });

  describe("Price composition with thresholding", () => {
    let compositeAggregator: ChainlinkCompositeAggregator;
    let mockFeed1: any;
    let mockFeed2: any;

    beforeEach(async () => {
      mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      const primaryThreshold = {
        lowerThresholdInBase: ethers.parseUnits("1.5", 8),
        fixedPriceInBase: ethers.parseUnits("2.0", 8),
      };
      const secondaryThreshold = {
        lowerThresholdInBase: ethers.parseUnits("2.5", 8),
        fixedPriceInBase: ethers.parseUnits("3.0", 8),
      };

      compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        primaryThreshold,
        secondaryThreshold,
      ]);
    });

    it("should apply thresholds when prices exceed thresholds", async () => {
      // Set prices above thresholds
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8)); // Above 1.5 threshold
      await mockFeed2.setMock(ethers.parseUnits("3.5", 8)); // Above 2.5 threshold

      const roundData = await compositeAggregator.latestRoundData();
      // Both prices should be fixed: 2.0 * 3.0 = 6.0
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("3.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });

    it("should not apply thresholds when prices are below thresholds", async () => {
      // Set prices below thresholds
      await mockFeed1.setMock(ethers.parseUnits("1.0", 8)); // Below 1.5 threshold
      await mockFeed2.setMock(ethers.parseUnits("2.0", 8)); // Below 2.5 threshold

      const roundData = await compositeAggregator.latestRoundData();
      // Original prices should be used: 1.0 * 2.0 = 2.0
      const expectedPrice = (ethers.parseUnits("1.0", 8) * ethers.parseUnits("2.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });

    it("should apply threshold to only one feed when mixed", async () => {
      // Feed1 above threshold, Feed2 below threshold
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8)); // Above 1.5 threshold
      await mockFeed2.setMock(ethers.parseUnits("2.0", 8)); // Below 2.5 threshold

      const roundData = await compositeAggregator.latestRoundData();
      // Feed1 fixed at 2.0, Feed2 original 2.0: 2.0 * 2.0 = 4.0
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("2.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });
  });

  describe("Staleness checks", () => {
    let compositeAggregator: ChainlinkCompositeAggregator;
    let mockFeed1: any;
    let mockFeed2: any;

    beforeEach(async () => {
      mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);
    });

    it("should revert when prices are stale", async () => {
      // Set stale timestamps for both feeds
      const staleTimestamp = Math.floor(Date.now() / 1000) - CHAINLINK_HEARTBEAT_SECONDS - 3600 - 1;
      await mockFeed1.setMockWithTimestamp(ethers.parseUnits("2.0", 8), staleTimestamp);
      await mockFeed2.setMockWithTimestamp(ethers.parseUnits("3.0", 8), staleTimestamp);

      await expect(compositeAggregator.latestRoundData()).to.be.revertedWithCustomError(compositeAggregator, "PriceIsStale");
    });

    it("should work when prices are fresh", async () => {
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeAggregator.latestRoundData();
      expect(roundData.answer).to.be.gt(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero prices", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      const compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      await mockFeed1.setMock(0);
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeAggregator.latestRoundData();
      expect(roundData.answer).to.equal(0);
    });

    it("should handle very large prices", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      const compositeAggregator = await ethers.deployContract("ChainlinkCompositeAggregator", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      const largePrice = ethers.parseUnits("1000000", 8);
      await mockFeed1.setMock(largePrice);
      await mockFeed2.setMock(largePrice);

      const roundData = await compositeAggregator.latestRoundData();
      const expectedPrice = (largePrice * largePrice) / ethers.parseUnits("1", 8);
      expect(roundData.answer).to.equal(expectedPrice);
    });
  });
});
