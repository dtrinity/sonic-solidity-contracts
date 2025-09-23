import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { AaveOracle, OracleAggregator } from "../../typechain-types";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { dLendFixture, DLendFixtureResult } from "./fixtures";

describe("AaveOracle", () => {
  // Test fixture and common variables
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;
  let aaveOracle: AaveOracle;
  let oracleAggregator: OracleAggregator;
  let fixture: DLendFixtureResult;
  let testAsset: string;

  beforeEach(async () => {
    // Get named accounts
    const { deployer, user1 } = await hre.getNamedAccounts();
    // Get signers for named accounts
    deployerSigner = await hre.ethers.getSigner(deployer);
    user1Signer = await hre.ethers.getSigner(user1);

    // Load the fixture
    fixture = await dLendFixture();
    aaveOracle = await ethers.getContractAt("AaveOracle", await fixture.contracts.priceOracle.getAddress());
    oracleAggregator = await ethers.getContractAt("OracleAggregator", await aaveOracle.getFallbackOracle());

    // Get a test asset from the reserves list
    const reservesList = await fixture.contracts.pool.getReservesList();
    testAsset = reservesList[0];
  });

  describe("Initialization", () => {
    it("should initialize with correct base currency unit (8 decimals)", async () => {
      const baseCurrencyUnit = await aaveOracle.BASE_CURRENCY_UNIT();
      expect(baseCurrencyUnit).to.equal(ethers.parseUnits("1", 8));
    });

    it("should use same base currency as oracle aggregator", async () => {
      const aaveOracleBase = await aaveOracle.BASE_CURRENCY();
      const aggregatorBase = await oracleAggregator.BASE_CURRENCY();
      expect(aaveOracleBase).to.equal(aggregatorBase);
    });
  });

  describe("Price Conversion", () => {
    it("should convert 18 decimal prices to 8 decimals", async () => {
      // First get price from oracle aggregator (18 decimals)
      const aggregatorPrice = await oracleAggregator.getAssetPrice(testAsset);
      const aggregatorDecimals = await oracleAggregator.BASE_CURRENCY_UNIT();
      expect(aggregatorDecimals).to.equal(ethers.parseUnits("1", 18));

      // Get price from Aave oracle (8 decimals)
      const aavePrice = await aaveOracle.getAssetPrice(testAsset);

      // Verify the conversion
      const expectedPrice = aggregatorPrice / BigInt(10 ** 10); // Convert from 18 to 8 decimals
      expect(aavePrice).to.equal(expectedPrice);
    });

    it("should return consistent prices for multiple assets", async () => {
      const reservesList = await fixture.contracts.pool.getReservesList();

      for (const asset of reservesList) {
        const aggregatorPrice = await oracleAggregator.getAssetPrice(asset);
        const aavePrice = await aaveOracle.getAssetPrice(asset);

        // All prices from AaveOracle should be in 8 decimals
        expect(aavePrice).to.equal(aggregatorPrice / BigInt(10 ** 10));
      }
    });
  });

  describe("Batch Operations", () => {
    it("should return correct prices for multiple assets in getAssetsPrices", async () => {
      const reservesList = await fixture.contracts.pool.getReservesList();
      const assets = [...reservesList.slice(0, 3)]; // Create a new array from the first 3 assets

      // Get prices from oracle aggregator first
      const aggregatorPrices = await Promise.all(assets.map((asset) => oracleAggregator.getAssetPrice(asset)));

      // Get batch prices from AaveOracle
      const batchPrices = await aaveOracle.getAssetsPrices(assets);

      // Verify each price individually without modifying the arrays
      for (let i = 0; i < assets.length; i++) {
        const expectedPrice = aggregatorPrices[i] / BigInt(10 ** 10); // Convert from 18 to 8 decimals
        const actualPrice = batchPrices[i];
        expect(actualPrice).to.equal(expectedPrice);
      }
    });

    it("should handle empty array in getAssetsPrices", async () => {
      const prices = await aaveOracle.getAssetsPrices([]);
      expect(prices).to.be.an("array").that.is.empty;
    });
  });

  describe("Source Management", () => {
    it("should return oracle aggregator as source for all assets", async () => {
      const source = await aaveOracle.getSourceOfAsset(testAsset);
      expect(source).to.equal(await oracleAggregator.getAddress());
    });

    it("should return oracle aggregator as fallback oracle", async () => {
      const fallback = await aaveOracle.getFallbackOracle();
      expect(fallback).to.equal(await oracleAggregator.getAddress());
    });

    it("should be a no-op when calling setAssetSources", async () => {
      // Get ACL manager and grant ASSET_LISTING_ADMIN_ROLE to deployer
      const addressesProvider = await hre.ethers.getContractAt(
        "PoolAddressesProvider",
        (await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID)).address,
      );
      const aclManager = await hre.ethers.getContractAt("ACLManager", await addressesProvider.getACLManager());
      await aclManager.addAssetListingAdmin(deployerSigner.address);

      // Call setAssetSources (should be no-op)
      const tx = await aaveOracle.connect(deployerSigner).setAssetSources([testAsset], [ethers.Wallet.createRandom().address]);
      await tx.wait();

      // Verify source remains unchanged
      const source = await aaveOracle.getSourceOfAsset(testAsset);
      expect(source).to.equal(await oracleAggregator.getAddress());
    });
  });
});
