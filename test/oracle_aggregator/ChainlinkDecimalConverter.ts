import { expect } from "chai";
import hre, { ethers, deployments, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { ChainlinkDecimalConverter } from "../../typechain-types";

// Test to ensure backward compatibility with the legacy name
describe("ChainlinkDecimalConverter (Legacy Compatibility)", () => {
  let deployer: Address;
  let converter: ChainlinkDecimalConverter;
  let mockAggregator: any;

  const MOCK_DECIMALS = 8;
  const MOCK_DESCRIPTION = "Mock ETH/USD Price Feed";
  const MOCK_VERSION = 1n;
  const MOCK_ROUND_DATA = {
    roundId: 1000n,
    answer: 200000000000n, // $2000.00000000 (8 decimals)
    startedAt: 1640000000n,
    updatedAt: 1640000001n,
    answeredInRound: 1000n,
  };

  before(async () => {
    ({ deployer } = await getNamedAccounts());
  });

  beforeEach(async () => {
    await deployments.fixture(["local-setup"]);

    // Deploy mock aggregator
    const MockAggregatorFactory = await ethers.getContractFactory("MockDecimalConverterAggregator");
    mockAggregator = await MockAggregatorFactory.deploy(
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

  it("should deploy with legacy ChainlinkDecimalConverter name", async () => {
    const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverter");
    converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 6);

    expect(await converter.sourceDecimals()).to.equal(MOCK_DECIMALS);
    expect(await converter.decimals()).to.equal(6);
    expect(await converter.sourceFeed()).to.equal(await mockAggregator.getAddress());
  });

  it("should work correctly as a downscaler", async () => {
    const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverter");
    converter = await ConverterFactory.deploy(await mockAggregator.getAddress(), 6);

    const result = await converter.latestRoundData();
    expect(result.answer).to.equal(MOCK_ROUND_DATA.answer / 100n); // 8->6 decimals
  });

  it("should reject upscaling attempts", async () => {
    const ConverterFactory = await ethers.getContractFactory("ChainlinkDecimalConverter");
    
    await expect(
      ConverterFactory.deploy(await mockAggregator.getAddress(), 12)
    ).to.be.revertedWithCustomError(ConverterFactory, "InvalidDecimalsUpscaleNotSupported");
  });
});