import { expect } from "chai";
import hre, { ethers, deployments, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { ChainlinkDecimalConverterV2 } from "../../typechain-types";

// Mock AggregatorV3Interface implementation
interface MockAggregatorData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

describe("ChainlinkDecimalConverterV2", () => {
  let deployer: Address;
  let user1: Address;
  let mockAggregator: any;
  let mockAggregatorWithLegacy: any;
  let converter: ChainlinkDecimalConverterV2;

  const MOCK_DECIMALS = 8;
  const MOCK_DESCRIPTION = "Mock ETH/USD Price Feed";
  const MOCK_VERSION = 1n;
  const MOCK_ROUND_DATA: MockAggregatorData = {
    roundId: 1000n,
    answer: 200000000000n, // $2000.00000000 (8 decimals)
    startedAt: 1640000000n,
    updatedAt: 1640000001n,
    answeredInRound: 1000n,
  };

  before(async () => {
    ({ deployer, user1 } = await getNamedAccounts());
  });

  beforeEach(async () => {
    await deployments.fixture(["local-setup"]);

    // Deploy mock aggregator with both interfaces
    const MockAggregatorFactory = await ethers.getContractFactory("MockDecimalConverterAggregatorWithLegacy");
    mockAggregatorWithLegacy = await MockAggregatorFactory.deploy(
      MOCK_DECIMALS,
      MOCK_DESCRIPTION,
      MOCK_VERSION,
      MOCK_ROUND_DATA.roundId,
      MOCK_ROUND_DATA.answer,
      MOCK_ROUND_DATA.startedAt,
      MOCK_ROUND_DATA.updatedAt,
      MOCK_ROUND_DATA.answeredInRound
    );

    // Deploy mock aggregator without legacy interface
    const MockAggregatorV3Factory = await ethers.getContractFactory("MockDecimalConverterAggregator");
    mockAggregator = await MockAggregatorV3Factory.deploy(
      MOCK_DECIMALS,
      MOCK_DESCRIPTION,
      MOCK_VERSION,
      MOCK_ROUND_DATA.roundId,
      MOCK_ROUND_DATA.answer,
      MOCK_ROUND_DATA.startedAt,
      MOCK_ROUND_DATA.updatedAt,
      MOCK_ROUND_DATA.answeredInRound
    );
  });

  describe("Constructor and initialization", () => {
    it("should initialize correctly for downscaling (8 to 6 decimals)", async () => {
      const targetDecimals = 6;
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), targetDecimals);

      expect(await converter.sourceDecimals()).to.equal(MOCK_DECIMALS);
      expect(await converter.decimals()).to.equal(targetDecimals);
      expect(await converter.isUpscaling()).to.equal(false);
      expect(await converter.sourceFeed()).to.equal(await mockAggregator.getAddress());
    });

    it("should initialize correctly for upscaling (8 to 12 decimals)", async () => {
      const targetDecimals = 12;
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), targetDecimals);

      expect(await converter.sourceDecimals()).to.equal(MOCK_DECIMALS);
      expect(await converter.decimals()).to.equal(targetDecimals);
      expect(await converter.isUpscaling()).to.equal(true);
      expect(await converter.sourceFeed()).to.equal(await mockAggregator.getAddress());
    });

    it("should initialize correctly for no scaling (8 to 8 decimals)", async () => {
      const targetDecimals = 8;
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), targetDecimals);

      expect(await converter.sourceDecimals()).to.equal(MOCK_DECIMALS);
      expect(await converter.decimals()).to.equal(targetDecimals);
      expect(await converter.isUpscaling()).to.equal(false);
      expect(await converter.sourceFeed()).to.equal(await mockAggregator.getAddress());
    });

    it("should handle legacy interface correctly with runtime fallback", async () => {
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");

      // Test with legacy support - sourceFeedLegacy should point to source feed
      const converterWithLegacy = await ConverterFactory.deploy(
        await mockAggregatorWithLegacy.getAddress(),
        6
      );
      expect(await converterWithLegacy.sourceFeedLegacy()).to.equal(await mockAggregatorWithLegacy.getAddress());

      // Legacy methods should work by calling source feed directly
      const legacyRound = await converterWithLegacy.latestRound();
      const legacyAnswer = await converterWithLegacy.latestAnswer();
      expect(legacyRound).to.equal(MOCK_ROUND_DATA.roundId);
      expect(legacyAnswer).to.equal(MOCK_ROUND_DATA.answer / 100n); // Scaled down 8->6 decimals

      // Test without legacy support - sourceFeedLegacy should still point to source feed
      const converterWithoutLegacy = await ConverterFactory.deploy(
        await mockAggregator.getAddress(),
        6
      );
      expect(await converterWithoutLegacy.sourceFeedLegacy()).to.equal(await mockAggregator.getAddress());

      // Legacy methods should work by falling back to latestRoundData()
      const fallbackRound = await converterWithoutLegacy.latestRound();
      const fallbackAnswer = await converterWithoutLegacy.latestAnswer();
      expect(fallbackRound).to.equal(MOCK_ROUND_DATA.roundId);
      expect(fallbackAnswer).to.equal(MOCK_ROUND_DATA.answer / 100n); // Scaled down 8->6 decimals
    });
  });

  describe("AggregatorV3Interface functions", () => {
    beforeEach(async () => {
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 6); // Downscale from 8 to 6
    });

    it("should return correct description", async () => {
      expect(await converter.description()).to.equal(MOCK_DESCRIPTION);
    });

    it("should return correct version", async () => {
      expect(await converter.version()).to.equal(MOCK_VERSION);
    });

    it("should return correct decimals", async () => {
      expect(await converter.decimals()).to.equal(6);
    });

    it("should return scaled getRoundData for downscaling", async () => {
      const result = await converter.getRoundData(MOCK_ROUND_DATA.roundId);

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer / 100n); // 8->6 decimals: divide by 100
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });

    it("should return scaled latestRoundData for downscaling", async () => {
      const result = await converter.latestRoundData();

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer / 100n); // 8->6 decimals: divide by 100
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });
  });

  describe("Upscaling tests", () => {
    beforeEach(async () => {
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 12); // Upscale from 8 to 12
    });

    it("should return scaled getRoundData for upscaling", async () => {
      const result = await converter.getRoundData(MOCK_ROUND_DATA.roundId);

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer * 10000n); // 8->12 decimals: multiply by 10000
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });

    it("should return scaled latestRoundData for upscaling", async () => {
      const result = await converter.latestRoundData();

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer * 10000n); // 8->12 decimals: multiply by 10000
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });
  });

  describe("No scaling tests", () => {
    beforeEach(async () => {
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 8); // No scaling: 8 to 8
    });

    it("should return unmodified getRoundData for no scaling", async () => {
      const result = await converter.getRoundData(MOCK_ROUND_DATA.roundId);

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer); // No scaling
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });

    it("should return unmodified latestRoundData for no scaling", async () => {
      const result = await converter.latestRoundData();

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer); // No scaling
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });
  });

  describe("IPriceFeedLegacy functions", () => {
    describe("With legacy interface support", () => {
      beforeEach(async () => {
        const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
        converter = await ConverterFactory.deploy(await mockAggregatorWithLegacy.getAddress(), 6); // Downscale from 8 to 6
      });

      it("should return correct latestRound from legacy interface", async () => {
        const result = await converter.latestRound();
        expect(result).to.equal(MOCK_ROUND_DATA.roundId);
      });

      it("should return scaled latestAnswer from legacy interface", async () => {
        const result = await converter.latestAnswer();
        expect(result).to.equal(MOCK_ROUND_DATA.answer / 100n); // 8->6 decimals: divide by 100
      });
    });

    describe("Without legacy interface support (fallback)", () => {
      beforeEach(async () => {
        const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
        converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 6); // Downscale from 8 to 6
      });

      it("should return correct latestRound using fallback", async () => {
        const result = await converter.latestRound();
        expect(result).to.equal(MOCK_ROUND_DATA.roundId);
      });

      it("should return scaled latestAnswer using fallback", async () => {
        const result = await converter.latestAnswer();
        expect(result).to.equal(MOCK_ROUND_DATA.answer / 100n); // 8->6 decimals: divide by 100
      });
    });
  });

  describe("Edge cases and complex scenarios", () => {
    it("should handle extreme upscaling correctly (8 to 18 decimals)", async () => {
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 18); // 10 decimal difference

      const result = await converter.latestRoundData();
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer * (10n ** 10n)); // multiply by 10^10
    });

    it("should handle extreme downscaling correctly (8 to 0 decimals)", async () => {
      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 0); // 8 decimal difference

      const result = await converter.latestRoundData();
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer / (10n ** 8n)); // divide by 10^8
    });

    it("should handle zero price correctly", async () => {
      // Update mock to return zero price
      await mockAggregator.updateRoundData(
        MOCK_ROUND_DATA.roundId + 1n,
        0n, // zero price
        MOCK_ROUND_DATA.startedAt + 1n,
        MOCK_ROUND_DATA.updatedAt + 1n,
        MOCK_ROUND_DATA.answeredInRound + 1n
      );

      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 6);

      const result = await converter.latestRoundData();
      expect(result.answer).to.equal(0n);
    });

    it("should handle negative price correctly for upscaling", async () => {
      // Update mock to return negative price
      const negativePrice = -100000000n; // -$1.00000000
      await mockAggregator.updateRoundData(
        MOCK_ROUND_DATA.roundId + 1n,
        negativePrice,
        MOCK_ROUND_DATA.startedAt + 1n,
        MOCK_ROUND_DATA.updatedAt + 1n,
        MOCK_ROUND_DATA.answeredInRound + 1n
      );

      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 12); // Upscale

      const result = await converter.latestRoundData();
      expect(result.answer).to.equal(negativePrice * 10000n); // multiply by 10^4 for 8->12 decimals
    });

    it("should handle negative price correctly for downscaling", async () => {
      // Update mock to return negative price
      const negativePrice = -100000000n; // -$1.00000000
      await mockAggregator.updateRoundData(
        MOCK_ROUND_DATA.roundId + 1n,
        negativePrice,
        MOCK_ROUND_DATA.startedAt + 1n,
        MOCK_ROUND_DATA.updatedAt + 1n,
        MOCK_ROUND_DATA.answeredInRound + 1n
      );

      const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverterV2");
      converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 6); // Downscale

      const result = await converter.latestRoundData();
      expect(result.answer).to.equal(negativePrice / 100n); // divide by 10^2 for 8->6 decimals
    });
  });
});
