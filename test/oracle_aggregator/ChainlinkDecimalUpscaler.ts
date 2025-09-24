import { expect } from "chai";
import hre, { ethers, deployments, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { ChainlinkDecimalUpscaler } from "../../typechain-types";

// Mock AggregatorV3Interface implementation
interface MockAggregatorData {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}

describe("ChainlinkDecimalUpscaler", () => {
  let deployer: Address;
  let user1: Address;
  let mockAggregator: any;
  let mockAggregatorWithLegacy: any;
  let upscaler: ChainlinkDecimalUpscaler;

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
      MOCK_ROUND_DATA.answeredInRound,
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
      MOCK_ROUND_DATA.answeredInRound,
    );
  });

  describe("Constructor and initialization", () => {
    it("should initialize correctly for upscaling (8 to 12 decimals)", async () => {
      const targetDecimals = 12;
      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
      upscaler = await UpscalerFactory.deploy(await mockAggregator.getAddress(), targetDecimals);

      expect(await upscaler.sourceDecimals()).to.equal(MOCK_DECIMALS);
      expect(await upscaler.decimals()).to.equal(targetDecimals);
      expect(await upscaler.sourceFeed()).to.equal(await mockAggregator.getAddress());
    });

    it("should revert when attempting downscaling", async () => {
      const targetDecimals = 6; // Less than source decimals
      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");

      await expect(UpscalerFactory.deploy(await mockAggregator.getAddress(), targetDecimals)).to.be.revertedWithCustomError(
        UpscalerFactory,
        "InvalidDecimalsDownscaleNotSupported",
      );
    });

    it("should revert when attempting no scaling (same decimals)", async () => {
      const targetDecimals = 8; // Equal to source decimals
      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");

      await expect(UpscalerFactory.deploy(await mockAggregator.getAddress(), targetDecimals)).to.be.revertedWithCustomError(
        UpscalerFactory,
        "InvalidDecimalsDownscaleNotSupported",
      );
    });

    it("should handle legacy interface correctly with runtime fallback", async () => {
      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");

      // Test with legacy support
      const upscalerWithLegacy = await UpscalerFactory.deploy(await mockAggregatorWithLegacy.getAddress(), 12);

      // Legacy methods should work by calling source feed directly
      const legacyRound = await upscalerWithLegacy.latestRound();
      const legacyAnswer = await upscalerWithLegacy.latestAnswer();
      expect(legacyRound).to.equal(MOCK_ROUND_DATA.roundId);
      expect(legacyAnswer).to.equal(MOCK_ROUND_DATA.answer * 10000n); // Scaled up 8->12 decimals

      // Test without legacy support
      const upscalerWithoutLegacy = await UpscalerFactory.deploy(await mockAggregator.getAddress(), 12);

      // Legacy methods should work by falling back to latestRoundData()
      const fallbackRound = await upscalerWithoutLegacy.latestRound();
      const fallbackAnswer = await upscalerWithoutLegacy.latestAnswer();
      expect(fallbackRound).to.equal(MOCK_ROUND_DATA.roundId);
      expect(fallbackAnswer).to.equal(MOCK_ROUND_DATA.answer * 10000n); // Scaled up 8->12 decimals
    });
  });

  describe("AggregatorV3Interface functions", () => {
    beforeEach(async () => {
      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
      upscaler = await UpscalerFactory.deploy(await mockAggregator.getAddress(), 12); // Upscale from 8 to 12
    });

    it("should return correct description", async () => {
      expect(await upscaler.description()).to.equal(MOCK_DESCRIPTION);
    });

    it("should return correct version", async () => {
      expect(await upscaler.version()).to.equal(MOCK_VERSION);
    });

    it("should return correct decimals", async () => {
      expect(await upscaler.decimals()).to.equal(12);
    });

    it("should return scaled getRoundData for upscaling", async () => {
      const result = await upscaler.getRoundData(MOCK_ROUND_DATA.roundId);

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer * 10000n); // 8->12 decimals: multiply by 10000
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });

    it("should return scaled latestRoundData for upscaling", async () => {
      const result = await upscaler.latestRoundData();

      expect(result.roundId).to.equal(MOCK_ROUND_DATA.roundId);
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer * 10000n); // 8->12 decimals: multiply by 10000
      expect(result.startedAt).to.equal(MOCK_ROUND_DATA.startedAt);
      expect(result.updatedAt).to.equal(MOCK_ROUND_DATA.updatedAt);
      expect(result.answeredInRound).to.equal(MOCK_ROUND_DATA.answeredInRound);
    });
  });

  describe("IPriceFeedLegacy functions", () => {
    describe("With legacy interface support", () => {
      beforeEach(async () => {
        const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
        upscaler = await UpscalerFactory.deploy(await mockAggregatorWithLegacy.getAddress(), 12); // Upscale from 8 to 12
      });

      it("should return correct latestRound from legacy interface", async () => {
        const result = await upscaler.latestRound();
        expect(result).to.equal(MOCK_ROUND_DATA.roundId);
      });

      it("should return scaled latestAnswer from legacy interface", async () => {
        const result = await upscaler.latestAnswer();
        expect(result).to.equal(MOCK_ROUND_DATA.answer * 10000n); // 8->12 decimals: multiply by 10000
      });
    });

    describe("Without legacy interface support (fallback)", () => {
      beforeEach(async () => {
        const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
        upscaler = await UpscalerFactory.deploy(await mockAggregator.getAddress(), 12); // Upscale from 8 to 12
      });

      it("should return correct latestRound using fallback", async () => {
        const result = await upscaler.latestRound();
        expect(result).to.equal(MOCK_ROUND_DATA.roundId);
      });

      it("should return scaled latestAnswer using fallback", async () => {
        const result = await upscaler.latestAnswer();
        expect(result).to.equal(MOCK_ROUND_DATA.answer * 10000n); // 8->12 decimals: multiply by 10000
      });
    });
  });

  describe("Edge cases and complex scenarios", () => {
    it("should handle extreme upscaling correctly (8 to 18 decimals)", async () => {
      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
      upscaler = await UpscalerFactory.deploy(await mockAggregator.getAddress(), 18); // 10 decimal difference

      const result = await upscaler.latestRoundData();
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer * 10n ** 10n); // multiply by 10^10
    });

    it("should handle minimal upscaling correctly (8 to 9 decimals)", async () => {
      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
      upscaler = await UpscalerFactory.deploy(await mockAggregator.getAddress(), 9); // 1 decimal difference

      const result = await upscaler.latestRoundData();
      expect(result.answer).to.equal(MOCK_ROUND_DATA.answer * 10n); // multiply by 10
    });

    it("should handle zero price correctly", async () => {
      // Update mock to return zero price
      await mockAggregator.updateRoundData(
        MOCK_ROUND_DATA.roundId + 1n,
        0n, // zero price
        MOCK_ROUND_DATA.startedAt + 1n,
        MOCK_ROUND_DATA.updatedAt + 1n,
        MOCK_ROUND_DATA.answeredInRound + 1n,
      );

      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
      upscaler = await UpscalerFactory.deploy(await mockAggregator.getAddress(), 12);

      const result = await upscaler.latestRoundData();
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
        MOCK_ROUND_DATA.answeredInRound + 1n,
      );

      const UpscalerFactory = await ethers.getContractFactory("ChainlinkDecimalUpscaler");
      upscaler = await UpscalerFactory.deploy(await mockAggregator.getAddress(), 12); // Upscale

      const result = await upscaler.latestRoundData();
      expect(result.answer).to.equal(negativePrice * 10000n); // multiply by 10^4 for 8->12 decimals
    });
  });
});
