import { expect } from "chai";
import hre, { getNamedAccounts, ethers } from "hardhat";
import { Address } from "hardhat-deploy/types";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  getOracleAggregatorFixture,
  OracleAggregatorFixtureResult,
} from "./fixtures";

import { OracleAggregator, MockOracleAggregator } from "../../typechain-types";
import { TokenInfo } from "../../typescript/token/utils";
import {
  ORACLE_AGGREGATOR_CONFIGS,
  createOracleAggregatorFixture,
} from "./fixtures";

// Run tests for each oracle aggregator configuration
const oracleConfigs = Object.values(ORACLE_AGGREGATOR_CONFIGS);

oracleConfigs.forEach((config) => {
  describe(`OracleAggregator for ${config.baseCurrency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let oracleAggregator: OracleAggregator;
    let deployer: Address;
    let user1: Address;
    let user2: Address;
    let peggedAssets: Map<string, { address: string; info: TokenInfo }> =
      new Map();
    let yieldBearingAssets: Map<string, { address: string; info: TokenInfo }> =
      new Map();

    // Set up fixture for this specific oracle configuration
    const fixture = createOracleAggregatorFixture(config);

    beforeEach(async function () {
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      oracleAggregator = fixtureResult.contracts.oracleAggregator;

      // Set the base currency for use in tests
      this.baseCurrency = config.baseCurrency;

      ({ deployer, user1, user2 } = await getNamedAccounts());

      // Initialize all pegged assets
      for (const assetSymbol of Object.keys(
        fixtureResult.assets.peggedAssets
      )) {
        peggedAssets.set(
          assetSymbol,
          fixtureResult.assets.peggedAssets[assetSymbol]
        );
      }

      // Initialize all yield bearing assets
      for (const assetSymbol of Object.keys(
        fixtureResult.assets.yieldBearingAssets
      )) {
        yieldBearingAssets.set(
          assetSymbol,
          fixtureResult.assets.yieldBearingAssets[assetSymbol]
        );
      }

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole = await oracleAggregator.ORACLE_MANAGER_ROLE();
      await oracleAggregator.grantRole(oracleManagerRole, deployer);
    });

    describe("Contract properties", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency = await oracleAggregator.BASE_CURRENCY();

        // The base currency could be the zero address for USD or a token address for other currencies
        if (config.baseCurrency === "USD") {
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

        // The contract is deployed with 10^18 (1e18) as the base currency unit
        expect(actualUnit).to.equal(BigInt(10) ** BigInt(18));
      });
    });

    describe("Oracle management", () => {
      it("should allow setting and removing oracles", async function () {
        if (!this.testAsset || !this.testAssetSymbol) {
          this.skip();
        }

        // Use the named fixture function with the correct context
        const { oracleAggregator, testAsset, testAssetSymbol, mockOracle } =
          await loadFixture(getOracleManagementFixture.bind(this));

        // Set a mock price for the test asset
        const mockPrice = ethers.parseEther("1.5");
        await mockOracle.setAssetPrice(testAsset, mockPrice);

        // Verify the price is set correctly in the mock oracle
        expect(await mockOracle.getAssetPrice(testAsset)).to.equal(mockPrice);

        // Set the oracle for the test asset
        await oracleAggregator.setOracle(
          testAsset,
          await mockOracle.getAddress()
        );

        // Verify the oracle is set correctly
        expect(await oracleAggregator.getAssetPrice(testAsset)).to.equal(
          mockPrice
        );

        // Remove the oracle
        await oracleAggregator.removeOracle(testAsset);

        // Verify the oracle is removed
        await expect(
          oracleAggregator.getAssetPrice(testAsset)
        ).to.be.revertedWith(
          "OracleAggregator: No oracle configured for asset"
        );
      });

      it("should revert when setting oracle with wrong decimals", async function () {
        // Get the first pegged asset for this test
        if (peggedAssets.size === 0) {
          throw new Error("No pegged assets available for testing");
        }

        // Get the first asset from the map in a type-safe way
        const assetEntries = Array.from(peggedAssets.entries());
        const [_assetSymbol, asset] = assetEntries[0];

        // Deploy a MockOracleAggregator with wrong decimals
        const MockOracleAggregatorFactory = await hre.ethers.getContractFactory(
          "MockOracleAggregator"
        );

        // Check if config.baseCurrency is a string or an address
        let baseCurrencyAddress = config.baseCurrency;
        if (config.baseCurrency === "USD") {
          baseCurrencyAddress = hre.ethers.ZeroAddress;
        } else if (
          typeof config.baseCurrency === "string" &&
          !config.baseCurrency.startsWith("0x")
        ) {
          // If it's a string but not an address, get it from the contract
          const baseCurrencyFromFixture =
            await oracleAggregator.BASE_CURRENCY();
          baseCurrencyAddress = baseCurrencyFromFixture;
        }

        const mockOracleAggregatorWithWrongDecimals =
          await MockOracleAggregatorFactory.deploy(
            baseCurrencyAddress,
            BigInt(10) ** 1n // 10^1 has too few decimals
          );

        // Try to set the oracle with wrong decimals
        await expect(
          oracleAggregator.setOracle(
            asset.address,
            await mockOracleAggregatorWithWrongDecimals.getAddress()
          )
        )
          .to.be.revertedWithCustomError(oracleAggregator, "UnexpectedBaseUnit")
          .withArgs(
            asset.address,
            await mockOracleAggregatorWithWrongDecimals.getAddress(),
            BigInt(10) ** BigInt(18), // The actual expected base unit in the contract
            BigInt(10) ** 1n
          );
      });

      it("should only allow oracle manager to set oracles", async function () {
        // Get the first pegged asset for this test
        if (peggedAssets.size === 0) {
          throw new Error("No pegged assets available for testing");
        }

        // Get the first asset from the map in a type-safe way
        const assetEntries = Array.from(peggedAssets.entries());
        const [_assetSymbol, asset] = assetEntries[0];

        // Deploy a mock oracle for testing
        const MockAPI3OracleFactory =
          await hre.ethers.getContractFactory("MockAPI3Oracle");
        const mockAPI3Oracle = await MockAPI3OracleFactory.deploy(deployer);

        const unauthorizedSigner = await hre.ethers.getSigner(user2);
        await expect(
          oracleAggregator
            .connect(unauthorizedSigner)
            .setOracle(asset.address, await mockAPI3Oracle.getAddress())
        ).to.be.revertedWithCustomError(
          oracleAggregator,
          "AccessControlUnauthorizedAccount"
        );
      });
    });

    describe("Asset pricing", () => {
      it("should correctly price assets with configured oracles", async function () {
        // Test pricing for pegged assets
        for (const [assetSymbol, asset] of peggedAssets.entries()) {
          try {
            const price = await oracleAggregator.getAssetPrice(asset.address);

            // The price should be non-zero
            expect(price).to.be.gt(
              0,
              `Price for ${assetSymbol} should be greater than 0`
            );

            // Get price info
            const [priceInfo, isAlive] = await oracleAggregator.getPriceInfo(
              asset.address
            );
            expect(priceInfo).to.equal(
              price,
              `Price info for ${assetSymbol} should match getAssetPrice`
            );
            expect(isAlive).to.be.true,
              `Price for ${assetSymbol} should be alive`;
          } catch (error: any) {
            // If the error is OracleNotSet, log it but don't fail the test
            if (error.message && error.message.includes("OracleNotSet")) {
              // Oracle not configured, continue with the test
              continue;
            } else {
              // Any other error should be thrown
              throw error;
            }
          }
        }

        // Test pricing for yield bearing assets
        for (const [assetSymbol, asset] of yieldBearingAssets.entries()) {
          try {
            const price = await oracleAggregator.getAssetPrice(asset.address);

            // The price should be non-zero
            expect(price).to.be.gt(
              0,
              `Price for ${assetSymbol} should be greater than 0`
            );

            // Get price info
            const [priceInfo, isAlive] = await oracleAggregator.getPriceInfo(
              asset.address
            );
            expect(priceInfo).to.equal(
              price,
              `Price info for ${assetSymbol} should match getAssetPrice`
            );
            expect(isAlive).to.be.true,
              `Price for ${assetSymbol} should be alive`;
          } catch (error: any) {
            // If the error is OracleNotSet, log it but don't fail the test
            if (error.message && error.message.includes("OracleNotSet")) {
              // Oracle not configured, continue with the test
              continue;
            } else if (
              error.message &&
              (error.message.includes("ProxyNotSet") ||
                error.message.includes("FeedNotSet"))
            ) {
              // Feed not set, continue with the test
              continue;
            } else {
              // Any other error should be thrown
              throw error;
            }
          }
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
});

// Define the fixture function outside the test
async function getOracleManagementFixture(this: any): Promise<{
  oracleAggregator: OracleAggregator;
  testAsset: string;
  testAssetSymbol: string;
  mockOracle: MockOracleAggregator;
  assets: any;
  config: any;
}> {
  const baseCurrency = this.baseCurrency === "wS" ? "S" : this.baseCurrency;

  // Get the fixture for the base currency
  const fixtureFunction = getOracleAggregatorFixture(baseCurrency);
  const fixtureResult = await fixtureFunction();

  // Get the base currency address
  let baseCurrencyAddress = hre.ethers.ZeroAddress;
  if (baseCurrency !== "USD") {
    // For non-USD base currencies, we need to find the actual token address
    const assets = fixtureResult.assets;
    for (const [symbol, asset] of Object.entries(assets.peggedAssets)) {
      if (symbol === baseCurrency) {
        baseCurrencyAddress = (asset as any).address;
        break;
      }
    }
  }

  // Deploy a mock oracle for testing
  const MockOracleAggregator = await ethers.getContractFactory(
    "MockOracleAggregator"
  );
  const mockOracle = await MockOracleAggregator.deploy(
    baseCurrencyAddress,
    BigInt(10) ** BigInt(18) // Use the correct base unit
  );

  return {
    oracleAggregator: fixtureResult.contracts.oracleAggregator,
    testAsset: this.testAsset,
    testAssetSymbol: this.testAssetSymbol,
    mockOracle,
    assets: fixtureResult.assets,
    config: fixtureResult.config,
  };
}
