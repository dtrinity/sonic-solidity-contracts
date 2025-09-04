import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { API3Wrapper } from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getOracleAggregatorFixture,
  getRandomItemFromList,
  OracleAggregatorFixtureResult,
} from "./fixtures";

const API3_HEARTBEAT_SECONDS = 86400; // 24 hours

describe("API3Wrapper", () => {
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
  describe(`API3Wrapper for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let api3Wrapper: API3Wrapper;

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      api3Wrapper = fixtureResult.contracts.api3Wrapper;

      // Skip suite if no relevant assets configured for this wrapper type
      if (Object.keys(fixtureResult.assets.api3PlainAssets).length === 0) {
        this.skip();
      }

      // Set the base currency for use in tests
      this.baseCurrency = currency;

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole = await api3Wrapper.ORACLE_MANAGER_ROLE();
      await api3Wrapper.grantRole(oracleManagerRole, deployer);
    });

    describe("Base currency and units", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency = await api3Wrapper.BASE_CURRENCY();

        // The base currency could be the zero address for USD or a token address for other currencies
        if (currency === "USD") {
          expect(baseCurrency).to.equal(hre.ethers.ZeroAddress);
        } else {
          // For non-USD currencies, we should check if it's a valid address
          expect(baseCurrency).to.not.equal(hre.ethers.ZeroAddress);
        }
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        const actualUnit = await api3Wrapper.BASE_CURRENCY_UNIT();
        const expectedUnit =
          BigInt(10) ** BigInt(fixtureResult.config.priceDecimals);
        expect(actualUnit).to.equal(expectedUnit);
      });
    });

    describe("Asset pricing", () => {
      it("should correctly price assets with configured proxies", async function () {
        // NOTE: Keep this check as it iterates directly
        if (Object.keys(fixtureResult.assets.api3PlainAssets).length === 0) {
          this.skip();
        }

        // Test pricing for plain assets
        for (const [address, _asset] of Object.entries(
          fixtureResult.assets.api3PlainAssets,
        )) {
          const { price, isAlive } = await api3Wrapper.getPriceInfo(address);

          // The price should be non-zero
          expect(price).to.be.gt(
            0,
            `Price for asset ${address} should be greater than 0`,
          );
          expect(isAlive).to.be.true,
            `Price for asset ${address} should be alive`;

          // Verify getAssetPrice returns the same value
          const directPrice = await api3Wrapper.getAssetPrice(address);
          expect(directPrice).to.equal(
            price,
            `Direct price should match price info for ${address}`,
          );
        }
      });

      it("should revert when getting price for non-existent asset", async function () {
        const nonExistentAsset = "0x000000000000000000000000000000000000dEaD";
        await expect(api3Wrapper.getPriceInfo(nonExistentAsset))
          .to.be.revertedWithCustomError(api3Wrapper, "ProxyNotSet")
          .withArgs(nonExistentAsset);

        await expect(api3Wrapper.getAssetPrice(nonExistentAsset))
          .to.be.revertedWithCustomError(api3Wrapper, "ProxyNotSet")
          .withArgs(nonExistentAsset);
      });

      it("should handle stale prices correctly", async function () {
        // NOTE: Keep this check as it uses getRandomItemFromList
        const plainAssets = Object.keys(fixtureResult.assets.api3PlainAssets);

        if (plainAssets.length === 0) {
          this.skip();
        }
        // Get a random test asset
        const testAsset = getRandomItemFromList(plainAssets);

        // Deploy a new MockAPI3Oracle that can be set to stale
        const MockAPI3OracleFactory =
          await ethers.getContractFactory("MockAPI3Oracle");
        const mockOracle = await MockAPI3OracleFactory.deploy(deployer);

        // Set the proxy for our test asset to point to the new mock oracle
        await api3Wrapper.setProxy(testAsset, await mockOracle.getAddress());

        // Set a stale price
        const price = ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS);
        const currentBlock = await ethers.provider.getBlock("latest");

        if (!currentBlock) {
          throw new Error("Failed to get current block");
        }

        const staleTimestamp =
          currentBlock.timestamp - API3_HEARTBEAT_SECONDS * 2;
        await mockOracle.setMock(price, staleTimestamp);

        // getPriceInfo should return false for isAlive
        const { isAlive } = await api3Wrapper.getPriceInfo(testAsset);
        expect(isAlive).to.be.false;

        // getAssetPrice should revert
        await expect(
          api3Wrapper.getAssetPrice(testAsset),
        ).to.be.revertedWithCustomError(api3Wrapper, "PriceIsStale");
      });
    });

    describe("Proxy management", () => {
      it("should allow setting and removing proxies by ORACLE_MANAGER_ROLE", async function () {
        const newAsset = "0x1234567890123456789012345678901234567890";
        const proxy = "0x2345678901234567890123456789012345678901";

        // Set the proxy
        await api3Wrapper.setProxy(newAsset, proxy);
        expect(await api3Wrapper.assetToProxy(newAsset)).to.equal(proxy);

        // Remove the proxy by setting it to zero address
        await api3Wrapper.setProxy(newAsset, ethers.ZeroAddress);
        expect(await api3Wrapper.assetToProxy(newAsset)).to.equal(
          ethers.ZeroAddress,
        );
      });

      it("should revert when non-ORACLE_MANAGER tries to set proxy", async function () {
        const newAsset = "0x1234567890123456789012345678901234567890";
        const proxy = "0x2345678901234567890123456789012345678901";

        const unauthorizedSigner = await ethers.getSigner(user2);
        const oracleManagerRole = await api3Wrapper.ORACLE_MANAGER_ROLE();

        await expect(
          api3Wrapper.connect(unauthorizedSigner).setProxy(newAsset, proxy),
        )
          .to.be.revertedWithCustomError(
            api3Wrapper,
            "AccessControlUnauthorizedAccount",
          )
          .withArgs(user2, oracleManagerRole);
      });
    });
  });
}
