import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { OracleAggregator } from "../../typechain-types";
import {
  getOracleAggregatorFixture,
  getRandomItemFromList,
  OracleAggregatorFixtureResult,
} from "./fixtures";

describe("OracleAggregator", () => {
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
  describe(`OracleAggregator for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let oracleAggregator: OracleAggregator;

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      oracleAggregator = fixtureResult.contracts.oracleAggregator;

      // Set the base currency for use in tests
      this.baseCurrency = currency;

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
      await oracleAggregator.grantRole(oracleManagerRole, deployer);
    });

    describe("Contract properties", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency = await oracleAggregator.BASE_CURRENCY();

        // The base currency could be the zero address for USD or a token address for other currencies
        if (currency === "USD") {
          expect(baseCurrency).to.equal(hre.ethers.ZeroAddress);
        } else {
          // For non-USD currencies, we should check if it's a valid address
          // This is a simple check that it's not the zero address
          expect(baseCurrency).to.not.equal(hre.ethers.ZeroAddress);
        }
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        // Get the actual value from the contract
        const actualUnit = await oracleAggregator.BASE_CURRENCY_UNIT();

        // The contract is deployed with 10^priceDecimals as the base currency unit
        expect(actualUnit).to.equal(
          BigInt(10) ** BigInt(fixtureResult.config.priceDecimals),
        );
      });
    });

    describe("Oracle management", () => {
      it("should allow setting and removing oracles", async function () {
        // Deploy a mock oracle for testing
        const MockOracleAggregator = await ethers.getContractFactory(
          "MockOracleAggregator",
        );
        const mockOracle = await MockOracleAggregator.deploy(
          fixtureResult.config.baseCurrency,
          BigInt(10) ** BigInt(fixtureResult.config.priceDecimals),
        );

        // Get a random test asset
        const testAsset = getRandomItemFromList(fixtureResult.assets.allAssets);

        // Set a mock price for the test asset
        const mockPrice = ethers.parseEther("1.5");
        await mockOracle.setAssetPrice(testAsset, mockPrice);

        // Verify the price is set correctly in the mock oracle
        expect(await mockOracle.getAssetPrice(testAsset)).to.equal(mockPrice);

        // Set the oracle for the test asset
        await oracleAggregator.setOracle(
          testAsset,
          await mockOracle.getAddress(),
        );

        // Verify the oracle is set correctly
        expect(await oracleAggregator.getAssetPrice(testAsset)).to.equal(
          mockPrice,
        );

        // Remove the oracle
        await oracleAggregator.removeOracle(testAsset);

        // Verify the oracle is removed
        await expect(oracleAggregator.getAssetPrice(testAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "OracleNotSet")
          .withArgs(testAsset);
      });

      it("should revert when setting oracle with wrong decimals", async function () {
        // Get a random test asset
        const testAsset = getRandomItemFromList(fixtureResult.assets.allAssets);

        // Deploy a MockOracleAggregator with wrong decimals
        const MockOracleAggregatorFactory = await hre.ethers.getContractFactory(
          "MockOracleAggregator",
        );

        const mockOracleAggregatorWithWrongDecimals =
          await MockOracleAggregatorFactory.deploy(
            fixtureResult.config.baseCurrency,
            BigInt(10) ** 1n, // 10^1 has too few decimals
          );

        // Try to set the oracle with wrong decimals
        await expect(
          oracleAggregator.setOracle(
            testAsset,
            await mockOracleAggregatorWithWrongDecimals.getAddress(),
          ),
        )
          .to.be.revertedWithCustomError(oracleAggregator, "UnexpectedBaseUnit")
          .withArgs(
            testAsset,
            await mockOracleAggregatorWithWrongDecimals.getAddress(),
            BigInt(10) ** BigInt(fixtureResult.config.priceDecimals),
            BigInt(10) ** 1n,
          );
      });

      it("should only allow oracle manager to set oracles", async function () {
        // Get a random test asset
        const testAsset = getRandomItemFromList(fixtureResult.assets.allAssets);

        // Deploy a mock oracle for testing
        const MockAPI3OracleFactory =
          await hre.ethers.getContractFactory("MockAPI3Oracle");
        const mockAPI3Oracle = await MockAPI3OracleFactory.deploy(deployer);

        const unauthorizedSigner = await hre.ethers.getSigner(user2);
        await expect(
          oracleAggregator
            .connect(unauthorizedSigner)
            .setOracle(testAsset, await mockAPI3Oracle.getAddress()),
        ).to.be.revertedWithCustomError(
          oracleAggregator,
          "AccessControlUnauthorizedAccount",
        );
      });
    });

    describe("Asset pricing", () => {
      it("should correctly price assets with configured oracles", async function () {
        for (const address of fixtureResult.assets.allAssets) {
          const price = await oracleAggregator.getAssetPrice(address);

          // The price should be non-zero
          expect(price).to.be.gt(
            0,
            `Price for asset ${address} should be greater than 0`,
          );

          // Get price info
          const [priceInfo, isAlive] =
            await oracleAggregator.getPriceInfo(address);
          expect(priceInfo).to.equal(
            price,
            `Price info for asset ${address} should match getAssetPrice`,
          );
          expect(isAlive).to.be.true,
            `Price for asset ${address} should be alive`;
        }
      });
    });

    describe("Error handling", () => {
      it("should revert when getting price for non-existent asset", async function () {
        const nonExistentAsset = "0x000000000000000000000000000000000000dEaD";
        await expect(oracleAggregator.getAssetPrice(nonExistentAsset))
          .to.be.revertedWithCustomError(oracleAggregator, "OracleNotSet")
          .withArgs(nonExistentAsset);
      });
    });
  });
}
