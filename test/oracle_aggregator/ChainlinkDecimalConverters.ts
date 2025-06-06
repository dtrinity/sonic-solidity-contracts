import { expect } from "chai";
import { ethers, deployments, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";
import {
  ChainlinkDecimalDownscaler,
  ChainlinkDecimalUpscaler,
  MockChainlinkAggregator,
} from "../../typechain-types";

describe("ChainlinkDecimalConverters", () => {
  let deployer: Address;
  let user1: Address;
  let mockFeed8Decimals: MockChainlinkAggregator;
  let mockFeed18Decimals: MockChainlinkAggregator;
  let downscaler: ChainlinkDecimalDownscaler;
  let upscaler: ChainlinkDecimalUpscaler;

  before(async () => {
    ({ deployer, user1 } = await getNamedAccounts());
  });

  beforeEach(async function () {
    // Deploy mock Chainlink aggregators with different decimals
    const MockChainlinkAggregatorFactory = await ethers.getContractFactory(
      "MockChainlinkAggregator"
    );

    // Create an 8-decimal mock feed (typical Chainlink price feed)
    mockFeed8Decimals = await MockChainlinkAggregatorFactory.deploy(
      "Mock ETH/USD 8 decimals",
      8,
      1 // version
    );

    // Create an 18-decimal mock feed
    mockFeed18Decimals = await MockChainlinkAggregatorFactory.deploy(
      "Mock ETH/USD 18 decimals",
      18,
      1 // version
    );

    // Set up initial price data for testing
    const price8Decimals = 200000000000n; // $2000.00000000 (8 decimals)
    const price18Decimals = 2000000000000000000000n; // $2000.000000000000000000 (18 decimals)
    const timestamp = Math.floor(Date.now() / 1000);

    await mockFeed8Decimals.setLatestRoundData(
      1, // roundId
      price8Decimals,
      timestamp,
      timestamp,
      1 // answeredInRound
    );

    await mockFeed18Decimals.setLatestRoundData(
      1, // roundId
      price18Decimals,
      timestamp,
      timestamp,
      1 // answeredInRound
    );

    // Deploy the downscaler (18 decimals -> 8 decimals)
    const ChainlinkDecimalDownscalerFactory = await ethers.getContractFactory(
      "ChainlinkDecimalDownscaler"
    );
    downscaler = await ChainlinkDecimalDownscalerFactory.deploy(
      await mockFeed18Decimals.getAddress(),
      8 // target decimals
    );

    // Deploy the upscaler (8 decimals -> 18 decimals)
    const ChainlinkDecimalUpscalerFactory = await ethers.getContractFactory(
      "ChainlinkDecimalUpscaler"
    );
    upscaler = await ChainlinkDecimalUpscalerFactory.deploy(
      await mockFeed8Decimals.getAddress(),
      18 // target decimals
    );
  });

  describe("ChainlinkDecimalDownscaler", () => {
    describe("Deployment", () => {
      it("should correctly set source feed and decimals", async () => {
        expect(await downscaler.sourceFeed()).to.equal(
          await mockFeed18Decimals.getAddress()
        );
        expect(await downscaler.sourceDecimals()).to.equal(18);
        expect(await downscaler.decimals()).to.equal(8);
      });

      it("should revert if target decimals > source decimals", async () => {
        const ChainlinkDecimalDownscalerFactory =
          await ethers.getContractFactory("ChainlinkDecimalDownscaler");

        await expect(
          ChainlinkDecimalDownscalerFactory.deploy(
            await mockFeed8Decimals.getAddress(),
            18 // target > source (8)
          )
        ).to.be.revertedWithCustomError(
          downscaler,
          "InvalidDecimalsUpscaleNotSupported"
        );
      });
    });

    describe("Price conversion", () => {
      it("should correctly convert 18-decimal price to 8-decimal price", async () => {
        const { answer } = await downscaler.latestRoundData();

        // Original: 2000000000000000000000n (18 decimals)
        // Expected: 200000000000n (8 decimals)
        expect(answer).to.equal(200000000000n);
      });

      it("should preserve round data except for price", async () => {
        const sourceData = await mockFeed18Decimals.latestRoundData();
        const convertedData = await downscaler.latestRoundData();

        expect(convertedData.roundId).to.equal(sourceData.roundId);
        expect(convertedData.startedAt).to.equal(sourceData.startedAt);
        expect(convertedData.updatedAt).to.equal(sourceData.updatedAt);
        expect(convertedData.answeredInRound).to.equal(
          sourceData.answeredInRound
        );

        // Only answer should be different (converted)
        expect(convertedData.answer).to.equal(
          sourceData.answer / BigInt(10 ** 10)
        );
      });

      it("should correctly handle getRoundData", async () => {
        const { answer } = await downscaler.getRoundData(1);
        expect(answer).to.equal(200000000000n);
      });

      it("should handle different decimal differences", async () => {
        // Test 18 -> 6 conversion
        const ChainlinkDecimalDownscalerFactory =
          await ethers.getContractFactory("ChainlinkDecimalDownscaler");
        const downscaler6 = await ChainlinkDecimalDownscalerFactory.deploy(
          await mockFeed18Decimals.getAddress(),
          6 // target decimals
        );

        const { answer } = await downscaler6.latestRoundData();
        // Original: 2000000000000000000000n (18 decimals)
        // Expected: 2000000000n (6 decimals) - divide by 10^12
        expect(answer).to.equal(2000000000n);
      });
    });

    describe("View functions", () => {
      it("should return correct description", async () => {
        const description = await downscaler.description();
        expect(description).to.equal("Mock ETH/USD 18 decimals");
      });

      it("should return correct version", async () => {
        const version = await downscaler.version();
        expect(version).to.equal(1);
      });
    });
  });

  describe("ChainlinkDecimalUpscaler", () => {
    describe("Deployment", () => {
      it("should correctly set source feed and decimals", async () => {
        expect(await upscaler.sourceFeed()).to.equal(
          await mockFeed8Decimals.getAddress()
        );
        expect(await upscaler.sourceDecimals()).to.equal(8);
        expect(await upscaler.decimals()).to.equal(18);
      });

      it("should revert if target decimals <= source decimals", async () => {
        const ChainlinkDecimalUpscalerFactory = await ethers.getContractFactory(
          "ChainlinkDecimalUpscaler"
        );

        // Test target decimals < source decimals
        await expect(
          ChainlinkDecimalUpscalerFactory.deploy(
            await mockFeed18Decimals.getAddress(),
            8 // target < source (18)
          )
        ).to.be.revertedWithCustomError(
          upscaler,
          "InvalidDecimalsDownscaleNotSupported"
        );

        // Test target decimals = source decimals
        await expect(
          ChainlinkDecimalUpscalerFactory.deploy(
            await mockFeed8Decimals.getAddress(),
            8 // target = source (8)
          )
        ).to.be.revertedWithCustomError(
          upscaler,
          "InvalidDecimalsDownscaleNotSupported"
        );
      });
    });

    describe("Price conversion", () => {
      it("should correctly convert 8-decimal price to 18-decimal price", async () => {
        const { answer } = await upscaler.latestRoundData();

        // Original: 200000000000n (8 decimals)
        // Expected: 2000000000000000000000n (18 decimals)
        expect(answer).to.equal(2000000000000000000000n);
      });

      it("should preserve round data except for price", async () => {
        const sourceData = await mockFeed8Decimals.latestRoundData();
        const convertedData = await upscaler.latestRoundData();

        expect(convertedData.roundId).to.equal(sourceData.roundId);
        expect(convertedData.startedAt).to.equal(sourceData.startedAt);
        expect(convertedData.updatedAt).to.equal(sourceData.updatedAt);
        expect(convertedData.answeredInRound).to.equal(
          sourceData.answeredInRound
        );

        // Only answer should be different (converted)
        expect(convertedData.answer).to.equal(
          sourceData.answer * BigInt(10 ** 10)
        );
      });

      it("should correctly handle getRoundData", async () => {
        const { answer } = await upscaler.getRoundData(1);
        expect(answer).to.equal(2000000000000000000000n);
      });

      it("should handle different decimal differences", async () => {
        // Test 8 -> 12 conversion
        const ChainlinkDecimalUpscalerFactory = await ethers.getContractFactory(
          "ChainlinkDecimalUpscaler"
        );
        const upscaler12 = await ChainlinkDecimalUpscalerFactory.deploy(
          await mockFeed8Decimals.getAddress(),
          12 // target decimals
        );

        const { answer } = await upscaler12.latestRoundData();
        // Original: 200000000000n (8 decimals)
        // Expected: 2000000000000000n (12 decimals) - multiply by 10^4
        expect(answer).to.equal(2000000000000000n);
      });
    });

    describe("View functions", () => {
      it("should return correct description", async () => {
        const description = await upscaler.description();
        expect(description).to.equal("Mock ETH/USD 8 decimals");
      });

      it("should return correct version", async () => {
        const version = await upscaler.version();
        expect(version).to.equal(1);
      });
    });
  });

  describe("Integration tests", () => {
    it("should be compatible when chaining downscaler and upscaler", async () => {
      // Chain: 18 decimals -> downscaler (8 decimals) -> upscaler (18 decimals)
      const ChainlinkDecimalUpscalerFactory = await ethers.getContractFactory(
        "ChainlinkDecimalUpscaler"
      );

      const chainedUpscaler = await ChainlinkDecimalUpscalerFactory.deploy(
        await downscaler.getAddress(),
        18 // target decimals
      );

      const originalPrice = await mockFeed18Decimals.latestRoundData();
      const finalPrice = await chainedUpscaler.latestRoundData();

      // Should be approximately equal (within reasonable rounding)
      expect(finalPrice.answer).to.equal(originalPrice.answer);
    });

    it("should handle edge case: same decimals conversion", async () => {
      const ChainlinkDecimalDownscalerFactory = await ethers.getContractFactory(
        "ChainlinkDecimalDownscaler"
      );

      const sameDecimalConverter =
        await ChainlinkDecimalDownscalerFactory.deploy(
          await mockFeed8Decimals.getAddress(),
          8 // same as source
        );

      const originalPrice = await mockFeed8Decimals.latestRoundData();
      const convertedPrice = await sameDecimalConverter.latestRoundData();

      expect(convertedPrice.answer).to.equal(originalPrice.answer);
    });
  });
});
