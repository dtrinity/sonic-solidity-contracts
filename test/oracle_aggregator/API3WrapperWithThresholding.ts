import { expect } from "chai";
import hre, { getNamedAccounts, ethers } from "hardhat";
import { Address } from "hardhat-deploy/types";
import {
  getOracleAggregatorFixture,
  OracleAggregatorFixtureResult,
  getRandomTestAsset,
} from "./fixtures";
import { getConfig } from "../../config/config";
import {
  API3WrapperWithThresholding,
  MockAPI3Oracle,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";

const API3_HEARTBEAT_SECONDS = 86400; // 24 hours

describe("API3WrapperWithThresholding", () => {
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
  describe(`API3WrapperWithThresholding for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let api3WrapperWithThresholding: API3WrapperWithThresholding;

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      api3WrapperWithThresholding =
        fixtureResult.contracts.api3WrapperWithThresholding;

      // Set the base currency for use in tests
      this.baseCurrency = currency;

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole =
        await api3WrapperWithThresholding.ORACLE_MANAGER_ROLE();
      await api3WrapperWithThresholding.grantRole(oracleManagerRole, deployer);
    });

    describe("Base currency and units", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency = await api3WrapperWithThresholding.BASE_CURRENCY();

        // The base currency could be the zero address for USD or a token address for other currencies
        if (currency === "USD") {
          expect(baseCurrency).to.equal(hre.ethers.ZeroAddress);
        } else {
          // For non-USD currencies, we should check if it's a valid address
          expect(baseCurrency).to.not.equal(hre.ethers.ZeroAddress);
        }
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        const actualUnit =
          await api3WrapperWithThresholding.BASE_CURRENCY_UNIT();
        const expectedUnit =
          BigInt(10) ** BigInt(fixtureResult.config.priceDecimals);
        expect(actualUnit).to.equal(expectedUnit);
      });
    });

    describe("Asset pricing with thresholding", () => {
      it("should return original price when no threshold is set", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Deploy a new MockAPI3Oracle for testing
        const MockAPI3OracleFactory =
          await ethers.getContractFactory("MockAPI3Oracle");
        const mockOracle = await MockAPI3OracleFactory.deploy(deployer);

        // Set the proxy for our test asset to point to the new mock oracle
        await api3WrapperWithThresholding.setProxy(
          testAsset,
          await mockOracle.getAddress()
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

        await mockOracle.setMock(testPrice, currentBlock.timestamp);

        // Get price info
        const { price: actualPrice, isAlive } =
          await api3WrapperWithThresholding.getPriceInfo(testAsset);

        // Verify price and status
        expect(actualPrice).to.equal(testPrice);
        expect(isAlive).to.be.true;

        // Verify getAssetPrice returns the same value
        const directPrice =
          await api3WrapperWithThresholding.getAssetPrice(testAsset);
        expect(directPrice).to.equal(testPrice);
      });

      it("should return original price when price is above threshold", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Deploy a new MockAPI3Oracle for testing
        const MockAPI3OracleFactory =
          await ethers.getContractFactory("MockAPI3Oracle");
        const mockOracle = await MockAPI3OracleFactory.deploy(deployer);

        // Set the proxy for our test asset
        await api3WrapperWithThresholding.setProxy(
          testAsset,
          await mockOracle.getAddress()
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
        await api3WrapperWithThresholding.setThresholdConfig(
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

        await mockOracle.setMock(priceAboveThreshold, currentBlock.timestamp);

        // Get price info
        const { price: actualPrice, isAlive } =
          await api3WrapperWithThresholding.getPriceInfo(testAsset);

        // Verify price and status
        expect(actualPrice).to.equal(fixedPrice);
        expect(isAlive).to.be.true;

        // Verify getAssetPrice returns the same value
        const directPrice =
          await api3WrapperWithThresholding.getAssetPrice(testAsset);
        expect(directPrice).to.equal(fixedPrice);
      });

      it("should return original price when price is below threshold", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Deploy a new MockAPI3Oracle for testing
        const MockAPI3OracleFactory =
          await ethers.getContractFactory("MockAPI3Oracle");
        const mockOracle = await MockAPI3OracleFactory.deploy(deployer);

        // Set the proxy for our test asset
        await api3WrapperWithThresholding.setProxy(
          testAsset,
          await mockOracle.getAddress()
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
        await api3WrapperWithThresholding.setThresholdConfig(
          testAsset,
          lowerThreshold,
          fixedPrice
        );

        // Set a price below threshold
        const priceBelowThreshold = ethers.parseUnits(
          "0.98",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        const currentBlock = await ethers.provider.getBlock("latest");
        if (!currentBlock) {
          throw new Error("Failed to get current block");
        }

        await mockOracle.setMock(priceBelowThreshold, currentBlock.timestamp);

        // Get price info
        const { price: actualPrice, isAlive } =
          await api3WrapperWithThresholding.getPriceInfo(testAsset);

        // Verify price and status
        expect(actualPrice).to.equal(priceBelowThreshold);
        expect(isAlive).to.be.true;

        // Verify getAssetPrice returns the same value
        const directPrice =
          await api3WrapperWithThresholding.getAssetPrice(testAsset);
        expect(directPrice).to.equal(priceBelowThreshold);
      });

      it("should handle stale prices correctly", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        // Deploy a new MockAPI3Oracle for testing
        const MockAPI3OracleFactory =
          await ethers.getContractFactory("MockAPI3Oracle");
        const mockOracle = await MockAPI3OracleFactory.deploy(deployer);

        // Set the proxy for our test asset
        await api3WrapperWithThresholding.setProxy(
          testAsset,
          await mockOracle.getAddress()
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
        await api3WrapperWithThresholding.setThresholdConfig(
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
          currentBlock.timestamp - API3_HEARTBEAT_SECONDS * 2;
        await mockOracle.setMock(price, staleTimestamp);

        // getPriceInfo should return false for isAlive
        const { isAlive } =
          await api3WrapperWithThresholding.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;

        // getAssetPrice should revert
        await expect(
          api3WrapperWithThresholding.getAssetPrice(testAsset)
        ).to.be.revertedWithCustomError(
          api3WrapperWithThresholding,
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
          api3WrapperWithThresholding.setThresholdConfig(
            testAsset,
            lowerThreshold,
            fixedPrice
          )
        )
          .to.emit(api3WrapperWithThresholding, "ThresholdConfigSet")
          .withArgs(testAsset, lowerThreshold, fixedPrice);

        // Verify config
        const config =
          await api3WrapperWithThresholding.assetThresholds(testAsset);
        expect(config.lowerThresholdInBase).to.equal(lowerThreshold);
        expect(config.fixedPriceInBase).to.equal(fixedPrice);

        // Remove threshold config
        await expect(
          api3WrapperWithThresholding.removeThresholdConfig(testAsset)
        )
          .to.emit(api3WrapperWithThresholding, "ThresholdConfigRemoved")
          .withArgs(testAsset);

        // Verify config is removed
        const removedConfig =
          await api3WrapperWithThresholding.assetThresholds(testAsset);
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
          await api3WrapperWithThresholding.ORACLE_MANAGER_ROLE();

        await expect(
          api3WrapperWithThresholding
            .connect(unauthorizedSigner)
            .setThresholdConfig(testAsset, lowerThreshold, fixedPrice)
        )
          .to.be.revertedWithCustomError(
            api3WrapperWithThresholding,
            "AccessControlUnauthorizedAccount"
          )
          .withArgs(user2, oracleManagerRole);
      });

      it("should revert when non-ORACLE_MANAGER tries to remove threshold config", async function () {
        // Get a random test asset
        const testAsset = getRandomTestAsset(fixtureResult);

        const unauthorizedSigner = await ethers.getSigner(user2);
        const oracleManagerRole =
          await api3WrapperWithThresholding.ORACLE_MANAGER_ROLE();

        await expect(
          api3WrapperWithThresholding
            .connect(unauthorizedSigner)
            .removeThresholdConfig(testAsset)
        )
          .to.be.revertedWithCustomError(
            api3WrapperWithThresholding,
            "AccessControlUnauthorizedAccount"
          )
          .withArgs(user2, oracleManagerRole);
      });
    });
  });
}
