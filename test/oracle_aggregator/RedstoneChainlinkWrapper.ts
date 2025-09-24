import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { RedstoneChainlinkWrapper } from "../../typechain-types";
import { getOracleAggregatorFixture, OracleAggregatorFixtureResult } from "./fixtures";

const CHAINLINK_HEARTBEAT_SECONDS = 86400; // 24 hours

describe("RedstoneChainlinkWrapper", () => {
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
async function runTestsForCurrency(currency: string, { deployer, user1, user2 }: { deployer: Address; user1: Address; user2: Address }) {
  describe(`RedstoneChainlinkWrapper for ${currency}`, () => {
    let fixtureResult: OracleAggregatorFixtureResult;
    let redstoneChainlinkWrapper: RedstoneChainlinkWrapper;

    beforeEach(async function () {
      const fixture = await getOracleAggregatorFixture(currency);
      fixtureResult = await fixture();

      // Get contract instances from the fixture
      redstoneChainlinkWrapper = fixtureResult.contracts.redstoneChainlinkWrapper;

      // Set the base currency for use in tests
      this.baseCurrency = currency;

      // Grant the OracleManager role to the deployer for test operations
      const oracleManagerRole = await redstoneChainlinkWrapper.ORACLE_MANAGER_ROLE();
      await redstoneChainlinkWrapper.grantRole(oracleManagerRole, deployer);
    });

    describe("Base currency and units", () => {
      it("should return correct BASE_CURRENCY", async function () {
        const baseCurrency = await redstoneChainlinkWrapper.BASE_CURRENCY();

        // The base currency could be the zero address for USD or a token address for other currencies
        if (currency === "USD") {
          expect(baseCurrency).to.equal(hre.ethers.ZeroAddress);
        } else {
          // For non-USD currencies, we should check if it's a valid address
          expect(baseCurrency).to.not.equal(hre.ethers.ZeroAddress);
        }
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        const actualUnit = await redstoneChainlinkWrapper.BASE_CURRENCY_UNIT();
        const expectedUnit = BigInt(10) ** BigInt(fixtureResult.config.priceDecimals);
        expect(actualUnit).to.equal(expectedUnit);
      });
    });

    describe("Asset pricing", () => {
      it("should correctly price assets with configured feeds", async function () {
        // Test pricing for plain assets configured for Redstone
        for (const [address, _asset] of Object.entries(fixtureResult.assets.redstonePlainAssets)) {
          // Check if the asset actually has a feed configured (safeguard)
          const feed = await redstoneChainlinkWrapper.assetToFeed(address);
          const { price, isAlive } = await redstoneChainlinkWrapper.getPriceInfo(address);

          // The price should be non-zero
          expect(price).to.be.gt(0, `Price for asset ${address} should be greater than 0`);
          (expect(isAlive).to.be.true, `Price for asset ${address} should be alive`);

          // Verify getAssetPrice returns the same value
          const directPrice = await redstoneChainlinkWrapper.getAssetPrice(address);
          expect(directPrice).to.equal(price, `Direct price should match price info for ${address}`);
        }
      });

      it("should revert when getting price for non-existent asset", async function () {
        const nonExistentAsset = "0x000000000000000000000000000000000000dEaD";
        await expect(redstoneChainlinkWrapper.getPriceInfo(nonExistentAsset))
          .to.be.revertedWithCustomError(redstoneChainlinkWrapper, "FeedNotSet")
          .withArgs(nonExistentAsset);

        await expect(redstoneChainlinkWrapper.getAssetPrice(nonExistentAsset))
          .to.be.revertedWithCustomError(redstoneChainlinkWrapper, "FeedNotSet")
          .withArgs(nonExistentAsset);
      });
    });

    describe("Feed management", () => {
      it("should allow setting and removing feeds by ORACLE_MANAGER_ROLE", async function () {
        const newAsset = "0x1234567890123456789012345678901234567890";
        const feed = "0x2345678901234567890123456789012345678901";

        // Set the feed
        await redstoneChainlinkWrapper.setFeed(newAsset, feed);
        expect(await redstoneChainlinkWrapper.assetToFeed(newAsset)).to.equal(feed);

        // Remove the feed by setting it to zero address
        await redstoneChainlinkWrapper.setFeed(newAsset, ethers.ZeroAddress);
        expect(await redstoneChainlinkWrapper.assetToFeed(newAsset)).to.equal(ethers.ZeroAddress);
      });

      it("should revert when non-ORACLE_MANAGER tries to set feed", async function () {
        const newAsset = "0x1234567890123456789012345678901234567890";
        const feed = "0x2345678901234567890123456789012345678901";

        const unauthorizedSigner = await ethers.getSigner(user2);
        const oracleManagerRole = await redstoneChainlinkWrapper.ORACLE_MANAGER_ROLE();

        await expect(redstoneChainlinkWrapper.connect(unauthorizedSigner).setFeed(newAsset, feed))
          .to.be.revertedWithCustomError(redstoneChainlinkWrapper, "AccessControlUnauthorizedAccount")
          .withArgs(user2, oracleManagerRole);
      });
    });
  });
}
