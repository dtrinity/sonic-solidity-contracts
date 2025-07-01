import { expect } from "chai";
import hre, { getNamedAccounts, ethers } from "hardhat";
import { Address } from "hardhat-deploy/types";
import { ChainlinkCompositeWrapper } from "../../typechain-types";

const CHAINLINK_HEARTBEAT_SECONDS = 86400; // 24 hours

describe("ChainlinkCompositeWrapper", () => {
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  before(async () => {
    ({ deployer, user1, user2 } = await getNamedAccounts());
  });

  describe("Constructor and initialization", () => {
    it("should initialize with correct parameters", async () => {
      // Deploy mock feeds
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [
        8,
        "Mock Feed 1",
      ]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [
        8,
        "Mock Feed 2",
      ]);

      const targetDecimals = 8;
      const baseCurrencyUnit = ethers.parseUnits("1", targetDecimals);
      const primaryThreshold = {
        lowerThresholdInBase: ethers.parseUnits("0.99", targetDecimals),
        fixedPriceInBase: ethers.parseUnits("1.00", targetDecimals),
      };
      const secondaryThreshold = {
        lowerThresholdInBase: ethers.parseUnits("0.98", targetDecimals),
        fixedPriceInBase: ethers.parseUnits("1.00", targetDecimals),
      };

      const compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        targetDecimals,
        baseCurrencyUnit,
        primaryThreshold,
        secondaryThreshold,
      ]);

      // Verify initialization
      expect(await compositeWrapper.sourceFeed1()).to.equal(await mockFeed1.getAddress());
      expect(await compositeWrapper.sourceFeed2()).to.equal(await mockFeed2.getAddress());
      expect(await compositeWrapper.decimals()).to.equal(targetDecimals);
      expect(await compositeWrapper.baseCurrencyUnit()).to.equal(baseCurrencyUnit);

      const storedPrimaryThreshold = await compositeWrapper.primaryThreshold();
      expect(storedPrimaryThreshold.lowerThresholdInBase).to.equal(primaryThreshold.lowerThresholdInBase);
      expect(storedPrimaryThreshold.fixedPriceInBase).to.equal(primaryThreshold.fixedPriceInBase);

      const storedSecondaryThreshold = await compositeWrapper.secondaryThreshold();
      expect(storedSecondaryThreshold.lowerThresholdInBase).to.equal(secondaryThreshold.lowerThresholdInBase);
      expect(storedSecondaryThreshold.fixedPriceInBase).to.equal(secondaryThreshold.fixedPriceInBase);
    });

    it("should return correct description", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [
        8,
        "ETH/USD",
      ]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [
        8,
        "USD/EUR",
      ]);

      const compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        8,
        ethers.parseUnits("1", 8),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      const description = await compositeWrapper.description();
      expect(description).to.include("ETH/USD");
      expect(description).to.include("USD/EUR");
      expect(description).to.include("Composite");
    });

    it("should return correct version", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      const compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        8,
        ethers.parseUnits("1", 8),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      expect(await compositeWrapper.version()).to.equal(1);
    });
  });

  describe("Price composition without thresholding", () => {
    let compositeWrapper: ChainlinkCompositeWrapper;
    let mockFeed1: any;
    let mockFeed2: any;

    beforeEach(async () => {
      mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        8,
        ethers.parseUnits("1", 8),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 }, // No thresholding
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 }, // No thresholding
      ]);
    });

    it("should correctly compose prices from two feeds", async () => {
      // Set mock prices: feed1 = 2.0, feed2 = 3.0
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeWrapper.latestRoundData();
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

      const compositeWrapperMixed = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1_18.getAddress(),
        await mockFeed2_6.getAddress(),
        8, // Target decimals
        ethers.parseUnits("1", 8),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      // Set mock prices: feed1 = 2.0 (18 decimals), feed2 = 3.0 (6 decimals)
      await mockFeed1_18.setMock(ethers.parseUnits("2.0", 18));
      await mockFeed2_6.setMock(ethers.parseUnits("3.0", 6));

      const roundData = await compositeWrapperMixed.latestRoundData();
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("3.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });

    it("should handle negative prices by converting to zero", async () => {
      // Set negative prices
      await mockFeed1.setMock(-ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeWrapper.latestRoundData();
      // Negative price should be converted to 0, so result should be 0
      expect(roundData.answer).to.equal(0);
    });

    it("should return correct getRoundData", async () => {
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundId = 123;
      const roundData = await compositeWrapper.getRoundData(roundId);
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("3.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.roundId).to.equal(roundId);
      expect(roundData.answer).to.equal(expectedPrice);
    });
  });

  describe("Price composition with thresholding", () => {
    let compositeWrapper: ChainlinkCompositeWrapper;
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

      compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        8,
        ethers.parseUnits("1", 8),
        primaryThreshold,
        secondaryThreshold,
      ]);
    });

    it("should apply thresholds when prices exceed thresholds", async () => {
      // Set prices above thresholds
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8)); // Above 1.5 threshold
      await mockFeed2.setMock(ethers.parseUnits("3.5", 8)); // Above 2.5 threshold

      const roundData = await compositeWrapper.latestRoundData();
      // Both prices should be fixed: 2.0 * 3.0 = 6.0
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("3.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });

    it("should not apply thresholds when prices are below thresholds", async () => {
      // Set prices below thresholds
      await mockFeed1.setMock(ethers.parseUnits("1.0", 8)); // Below 1.5 threshold
      await mockFeed2.setMock(ethers.parseUnits("2.0", 8)); // Below 2.5 threshold

      const roundData = await compositeWrapper.latestRoundData();
      // Original prices should be used: 1.0 * 2.0 = 2.0
      const expectedPrice = (ethers.parseUnits("1.0", 8) * ethers.parseUnits("2.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });

    it("should apply threshold to only one feed when mixed", async () => {
      // Feed1 above threshold, Feed2 below threshold
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8)); // Above 1.5 threshold
      await mockFeed2.setMock(ethers.parseUnits("2.0", 8)); // Below 2.5 threshold

      const roundData = await compositeWrapper.latestRoundData();
      // Feed1 fixed at 2.0, Feed2 original 2.0: 2.0 * 2.0 = 4.0
      const expectedPrice = (ethers.parseUnits("2.0", 8) * ethers.parseUnits("2.0", 8)) / ethers.parseUnits("1", 8);

      expect(roundData.answer).to.equal(expectedPrice);
    });
  });

  describe("Staleness checks", () => {
    let compositeWrapper: ChainlinkCompositeWrapper;
    let mockFeed1: any;
    let mockFeed2: any;

    beforeEach(async () => {
      mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        8,
        ethers.parseUnits("1", 8),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);
    });

    it("should revert when prices are stale", async () => {
      // Set stale timestamps for both feeds
      const staleTimestamp = Math.floor(Date.now() / 1000) - CHAINLINK_HEARTBEAT_SECONDS - 3600 - 1;
      await mockFeed1.setMockWithTimestamp(ethers.parseUnits("2.0", 8), staleTimestamp);
      await mockFeed2.setMockWithTimestamp(ethers.parseUnits("3.0", 8), staleTimestamp);

      await expect(compositeWrapper.latestRoundData()).to.be.revertedWithCustomError(
        compositeWrapper,
        "PriceIsStale"
      );
    });

    it("should work when prices are fresh", async () => {
      await mockFeed1.setMock(ethers.parseUnits("2.0", 8));
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeWrapper.latestRoundData();
      expect(roundData.answer).to.be.gt(0);
    });
  });

  describe("Edge cases", () => {
    it("should handle zero prices", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      const compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        8,
        ethers.parseUnits("1", 8),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      await mockFeed1.setMock(0);
      await mockFeed2.setMock(ethers.parseUnits("3.0", 8));

      const roundData = await compositeWrapper.latestRoundData();
      expect(roundData.answer).to.equal(0);
    });

    it("should handle very large prices", async () => {
      const mockFeed1 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 1"]);
      const mockFeed2 = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "Feed 2"]);

      const compositeWrapper = await ethers.deployContract("ChainlinkCompositeWrapper", [
        await mockFeed1.getAddress(),
        await mockFeed2.getAddress(),
        8,
        ethers.parseUnits("1", 8),
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
        { lowerThresholdInBase: 0, fixedPriceInBase: 0 },
      ]);

      const largePrice = ethers.parseUnits("1000000", 8);
      await mockFeed1.setMock(largePrice);
      await mockFeed2.setMock(largePrice);

      const roundData = await compositeWrapper.latestRoundData();
      const expectedPrice = (largePrice * largePrice) / ethers.parseUnits("1", 8);
      expect(roundData.answer).to.equal(expectedPrice);
    });
  });
}); 