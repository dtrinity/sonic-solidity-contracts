import { expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  API3CompositeWrapperWithThresholding,
  MockAPI3OracleAlwaysAlive,
} from "../../typechain-types";
import {
  API3_HEARTBEAT_SECONDS,
  API3_PRICE_DECIMALS,
  USD_ORACLE_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { oracleAggregatorMinimalFixture } from "./fixtures";
import { API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID } from "../../typescript/deploy-ids";

describe("API3CompositeWrapperWithThresholding", () => {
  let api3CompositeWrapperWithThresholdingContract: API3CompositeWrapperWithThresholding;
  let mockAPI3OracleFrxUSDContract: MockAPI3OracleAlwaysAlive;
  let mockAPI3OracleSfrxUSDContract: MockAPI3OracleAlwaysAlive;
  let sfrxUSDAddress: string;
  let frxUSDAddress: string;
  let deployer: Address;
  let user1: Address;

  beforeEach(async function () {
    await oracleAggregatorMinimalFixture();

    ({ deployer, user1 } = await getNamedAccounts());

    // Get the API3CompositeWrapperWithThresholding contract
    const { address: api3CompositeWrapperAddress } = await hre.deployments.get(
      API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID
    );
    api3CompositeWrapperWithThresholdingContract =
      await hre.ethers.getContractAt(
        "API3CompositeWrapperWithThresholding",
        api3CompositeWrapperAddress,
        await hre.ethers.getSigner(deployer)
      );

    // Get token addresses
    const { tokenInfo: frxUSDInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "frxUSD"
    );
    const { tokenInfo: sfrxUSDInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "sfrxUSD"
    );
    frxUSDAddress = frxUSDInfo.address;
    sfrxUSDAddress = sfrxUSDInfo.address;

    // Get the MockOracleDeployments data which contains the mapping of token addresses to mock oracles
    const mockOracleDeployments = await hre.deployments.get(
      "MockOracleDeployments"
    );
    const mockOracleMap = mockOracleDeployments.linkedData as Record<
      string,
      string
    >;

    // Get the mock oracle contracts
    mockAPI3OracleFrxUSDContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      mockOracleMap[frxUSDAddress],
      await hre.ethers.getSigner(deployer)
    );

    mockAPI3OracleSfrxUSDContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      mockOracleMap[sfrxUSDAddress],
      await hre.ethers.getSigner(deployer)
    );

    // Set up the composite feed for testing
    await api3CompositeWrapperWithThresholdingContract.addCompositeFeed(
      sfrxUSDAddress,
      mockOracleMap[sfrxUSDAddress],
      mockOracleMap[frxUSDAddress],
      0, // No lower threshold for sfrxUSD/frxUSD
      0, // No fixed price for sfrxUSD/frxUSD
      hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS), // $1 threshold for frxUSD/USD
      hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS) // $1 fixed price for frxUSD/USD
    );
  });

  describe("Getting asset prices", () => {
    it("should return expected composite price for sfrxUSD", async function () {
      const expectedPriceSfrxUSD = hre.ethers.parseUnits(
        "1.1",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      const { price: actualPriceSfrxUSD, isAlive: isAliveSfrxUSD } =
        await api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          sfrxUSDAddress
        );

      expect(actualPriceSfrxUSD).to.equal(expectedPriceSfrxUSD);
      expect(isAliveSfrxUSD).to.be.true;

      const assetPrice =
        await api3CompositeWrapperWithThresholdingContract.getAssetPrice(
          sfrxUSDAddress
        );
      expect(assetPrice).to.equal(expectedPriceSfrxUSD);
    });

    it("should return fixed price when composite price is above threshold", async function () {
      // Mock the price of frxUSD above $1
      const api3PriceFrxUSD = hre.ethers.parseUnits(
        "1.15",
        API3_PRICE_DECIMALS
      );
      const fixedPrice = hre.ethers.parseUnits(
        "1.1",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      await mockAPI3OracleFrxUSDContract.setMock(api3PriceFrxUSD);

      const { price, isAlive } =
        await api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          sfrxUSDAddress
        );

      expect(price).to.equal(fixedPrice);
      expect(isAlive).to.be.true;

      const assetPrice =
        await api3CompositeWrapperWithThresholdingContract.getAssetPrice(
          sfrxUSDAddress
        );
      expect(assetPrice).to.equal(fixedPrice);
    });

    it("should correctly handle thresholding with 8 decimal precision for both primary and secondary thresholds", async function () {
      const newAsset = "0x1234567890123456789012345678901234567890";
      const proxy1 = "0x2345678901234567890123456789012345678901";
      const proxy2 = "0x3456789012345678901234567890123456789012";

      // Set thresholds with 8 decimal precision
      const lowerThreshold1 = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $0.99
      const fixedPrice1 = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $1.00
      const lowerThreshold2 = hre.ethers.parseUnits(
        "0.98",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $0.98
      const fixedPrice2 = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $1.00

      // Add composite feed with thresholds
      await api3CompositeWrapperWithThresholdingContract.addCompositeFeed(
        newAsset,
        proxy1,
        proxy2,
        lowerThreshold1,
        fixedPrice1,
        lowerThreshold2,
        fixedPrice2
      );

      // Verify the thresholds were set correctly
      const feed =
        await api3CompositeWrapperWithThresholdingContract.compositeFeeds(
          newAsset
        );
      expect(feed.primaryThreshold.lowerThresholdInBase).to.equal(
        lowerThreshold1
      );
      expect(feed.primaryThreshold.fixedPriceInBase).to.equal(fixedPrice1);
      expect(feed.secondaryThreshold.lowerThresholdInBase).to.equal(
        lowerThreshold2
      );
      expect(feed.secondaryThreshold.fixedPriceInBase).to.equal(fixedPrice2);
    });

    it("should apply thresholds correctly for both primary and secondary prices", async function () {
      // Set thresholds with 8 decimal precision
      const lowerThreshold1 = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $0.99
      const fixedPrice1 = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $1.00
      const lowerThreshold2 = hre.ethers.parseUnits(
        "0.98",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $0.98
      const fixedPrice2 = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $1.00

      // Add composite feed with thresholds
      await api3CompositeWrapperWithThresholdingContract.addCompositeFeed(
        sfrxUSDAddress,
        await mockAPI3OracleSfrxUSDContract.getAddress(),
        await mockAPI3OracleFrxUSDContract.getAddress(),
        lowerThreshold1,
        fixedPrice1,
        lowerThreshold2,
        fixedPrice2
      );

      // Set prices ABOVE thresholds to trigger fixed price mechanism
      const price1 = hre.ethers.parseUnits("1.02", API3_PRICE_DECIMALS); // Above threshold1
      const price2 = hre.ethers.parseUnits("1.05", API3_PRICE_DECIMALS); // Above threshold2

      await mockAPI3OracleSfrxUSDContract.setMock(price1);
      await mockAPI3OracleFrxUSDContract.setMock(price2);

      // Get price info
      const { price, isAlive } =
        await api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          sfrxUSDAddress
        );

      // Both prices should be fixed to their respective fixed prices since they're above thresholds
      // Expected: fixedPrice1 * fixedPrice2 / BASE_CURRENCY_UNIT
      const expectedPrice =
        (fixedPrice1 * fixedPrice2) /
        hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS);
      expect(price).to.equal(expectedPrice);
      expect(isAlive).to.be.true;

      // Test that a price below threshold passes through unchanged
      const priceBelowThreshold1 = hre.ethers.parseUnits(
        "0.95",
        API3_PRICE_DECIMALS
      ); // Below threshold1
      await mockAPI3OracleSfrxUSDContract.setMock(priceBelowThreshold1);

      const { price: priceWithOneBelow } =
        await api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          sfrxUSDAddress
        );

      // Now price1 should be unchanged (0.95) while price2 is still fixed at 1.00
      const expectedPriceWithOneBelow =
        (hre.ethers.parseUnits("0.95", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS) *
          fixedPrice2) /
        hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS);
      expect(priceWithOneBelow).to.equal(expectedPriceWithOneBelow);
    });

    it("should apply threshold correctly when only price1 has threshold", async function () {
      // Set threshold only for price1
      const lowerThreshold1 = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $0.99
      const fixedPrice1 = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // $1.00
      const noThreshold = 0n;

      // Add composite feed with threshold only on price1
      await api3CompositeWrapperWithThresholdingContract.addCompositeFeed(
        sfrxUSDAddress,
        await mockAPI3OracleSfrxUSDContract.getAddress(),
        await mockAPI3OracleFrxUSDContract.getAddress(),
        lowerThreshold1,
        fixedPrice1,
        noThreshold,
        noThreshold
      );

      // Test when price1 is above threshold
      const price1Above = hre.ethers.parseUnits("1.02", API3_PRICE_DECIMALS);
      const price2 = hre.ethers.parseUnits("1.05", API3_PRICE_DECIMALS);

      await mockAPI3OracleSfrxUSDContract.setMock(price1Above);
      await mockAPI3OracleFrxUSDContract.setMock(price2);

      const { price: priceWithAboveThreshold } =
        await api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          sfrxUSDAddress
        );

      // price1 should be fixed at 1.00, price2 should be unchanged at 1.05
      const expectedPriceAbove =
        (fixedPrice1 *
          hre.ethers.parseUnits("1.05", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS)) /
        hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS);
      expect(priceWithAboveThreshold).to.equal(expectedPriceAbove);

      // Test when price1 is below threshold
      const price1Below = hre.ethers.parseUnits("0.95", API3_PRICE_DECIMALS);
      await mockAPI3OracleSfrxUSDContract.setMock(price1Below);

      const { price: priceWithBelowThreshold } =
        await api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          sfrxUSDAddress
        );

      // price1 should be unchanged at 0.95, price2 should be unchanged at 1.05
      const expectedPriceBelow =
        (hre.ethers.parseUnits("0.95", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS) *
          hre.ethers.parseUnits("1.05", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS)) /
        hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS);
      expect(priceWithBelowThreshold).to.equal(expectedPriceBelow);
    });

    it("should revert when getting price for non-existent asset", async function () {
      const nonExistentAsset = "0x1234567890123456789012345678901234567890";
      await expect(
        api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          nonExistentAsset
        )
      )
        .to.be.revertedWithCustomError(
          api3CompositeWrapperWithThresholdingContract,
          "FeedNotSet"
        )
        .withArgs(nonExistentAsset);
      await expect(
        api3CompositeWrapperWithThresholdingContract.getAssetPrice(
          nonExistentAsset
        )
      )
        .to.be.revertedWithCustomError(
          api3CompositeWrapperWithThresholdingContract,
          "FeedNotSet"
        )
        .withArgs(nonExistentAsset);
    });

    it("should return false or revert when price is stale", async function () {
      // Create a mock oracle that can have stale prices
      const mockAPI3Oracle = await hre.deployments.deploy("MockAPI3Oracle", {
        from: deployer,
        args: ["0x0000000000000000000000000000000000000001"], // Dummy API3 server address
        contract: "MockAPI3Oracle",
        autoMine: true,
        log: false,
      });

      const mockAPI3OracleContract = await hre.ethers.getContractAt(
        "MockAPI3Oracle",
        mockAPI3Oracle.address,
        await hre.ethers.getSigner(deployer)
      );

      // Add a new asset with the stale-able mock oracle
      const newAsset = "0x1234567890123456789012345678901234567890";
      await api3CompositeWrapperWithThresholdingContract.addCompositeFeed(
        newAsset,
        mockAPI3Oracle.address,
        await mockAPI3OracleFrxUSDContract.getAddress(),
        0,
        0,
        0,
        0
      );

      // Set a stale price
      const price = hre.ethers.parseUnits("1", API3_PRICE_DECIMALS);
      const currentBlock = await hre.ethers.provider.getBlock("latest");
      if (!currentBlock) throw new Error("Failed to get current block");

      const staleTimestamp =
        currentBlock.timestamp - API3_HEARTBEAT_SECONDS * 2; // 2 days ago
      await mockAPI3OracleContract.setMock(price, staleTimestamp);

      // getPriceInfo should return false for isAlive
      const { isAlive } =
        await api3CompositeWrapperWithThresholdingContract.getPriceInfo(
          newAsset
        );
      expect(isAlive).to.be.false;

      // getAssetPrice should revert
      await expect(
        api3CompositeWrapperWithThresholdingContract.getAssetPrice(newAsset)
      ).to.be.revertedWithCustomError(
        api3CompositeWrapperWithThresholdingContract,
        "PriceIsStale"
      );
    });
  });

  describe("Role based access and management", () => {
    it("should allow adding, updating and removing composite feeds", async function () {
      const newAsset = "0x1234567890123456789012345678901234567890";
      const proxy1 = "0x2345678901234567890123456789012345678901";
      const proxy2 = "0x3456789012345678901234567890123456789012";

      await expect(
        api3CompositeWrapperWithThresholdingContract.addCompositeFeed(
          newAsset,
          proxy1,
          proxy2,
          0,
          0,
          0,
          0
        )
      )
        .to.emit(
          api3CompositeWrapperWithThresholdingContract,
          "CompositeFeedAdded"
        )
        .withArgs(newAsset, proxy1, proxy2, 0, 0, 0, 0);

      const feed =
        await api3CompositeWrapperWithThresholdingContract.compositeFeeds(
          newAsset
        );
      expect(feed.proxy1).to.equal(proxy1);
      expect(feed.proxy2).to.equal(proxy2);

      await expect(
        api3CompositeWrapperWithThresholdingContract.updateCompositeFeed(
          newAsset,
          hre.ethers.parseUnits("0.99", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS),
          hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS),
          0n,
          0n
        )
      )
        .to.emit(
          api3CompositeWrapperWithThresholdingContract,
          "CompositeFeedUpdated"
        )
        .withArgs(
          newAsset,
          hre.ethers.parseUnits("0.99", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS),
          hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS),
          0n,
          0n
        );

      const updatedFeed =
        await api3CompositeWrapperWithThresholdingContract.compositeFeeds(
          newAsset
        );
      expect(updatedFeed.proxy1).to.equal(proxy1);
      expect(updatedFeed.proxy2).to.equal(proxy2);
      expect(updatedFeed.primaryThreshold.lowerThresholdInBase).to.equal(
        hre.ethers.parseUnits("0.99", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
      expect(updatedFeed.primaryThreshold.fixedPriceInBase).to.equal(
        hre.ethers.parseUnits("1", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
      expect(updatedFeed.secondaryThreshold.lowerThresholdInBase).to.equal(0);
      expect(updatedFeed.secondaryThreshold.fixedPriceInBase).to.equal(0);

      await expect(
        api3CompositeWrapperWithThresholdingContract.removeCompositeFeed(
          newAsset
        )
      )
        .to.emit(
          api3CompositeWrapperWithThresholdingContract,
          "CompositeFeedRemoved"
        )
        .withArgs(newAsset);

      const removedFeed =
        await api3CompositeWrapperWithThresholdingContract.compositeFeeds(
          newAsset
        );
      expect(removedFeed.proxy1).to.equal(hre.ethers.ZeroAddress);
      expect(removedFeed.proxy2).to.equal(hre.ethers.ZeroAddress);
    });

    it("should revert when non-ORACLE_MANAGER tries to add or remove feeds", async function () {
      const unauthorizedSigner = await hre.ethers.getSigner(user1);
      const newAsset = "0x1234567890123456789012345678901234567890";
      const proxy1 = "0x2345678901234567890123456789012345678901";
      const proxy2 = "0x3456789012345678901234567890123456789012";

      await expect(
        api3CompositeWrapperWithThresholdingContract
          .connect(unauthorizedSigner)
          .addCompositeFeed(newAsset, proxy1, proxy2, 0, 0, 0, 0)
      )
        .to.be.revertedWithCustomError(
          api3CompositeWrapperWithThresholdingContract,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(
          user1,
          await api3CompositeWrapperWithThresholdingContract.ORACLE_MANAGER_ROLE()
        );

      await expect(
        api3CompositeWrapperWithThresholdingContract
          .connect(unauthorizedSigner)
          .removeCompositeFeed(newAsset)
      )
        .to.be.revertedWithCustomError(
          api3CompositeWrapperWithThresholdingContract,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(
          user1,
          await api3CompositeWrapperWithThresholdingContract.ORACLE_MANAGER_ROLE()
        );
    });
  });
});
