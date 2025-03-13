import { expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  API3WrapperWithThresholding,
  MockAPI3OracleAlwaysAlive,
} from "../../typechain-types";
import {
  API3_HEARTBEAT_SECONDS,
  API3_PRICE_DECIMALS,
  USD_ORACLE_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { usdOracleAggregatorFixture } from "./fixtures";

describe("API3WrapperWithThresholding", () => {
  let api3WrapperWithThresholdingContract: API3WrapperWithThresholding;
  let mockAPI3OracleFrxUSDContract: MockAPI3OracleAlwaysAlive;
  let frxUSDAddress: string;
  let deployer: Address;
  let user1: Address;

  beforeEach(async function () {
    await usdOracleAggregatorFixture();

    ({ deployer, user1 } = await getNamedAccounts());

    // Get the API3WrapperWithThresholding contract
    try {
      const { address: api3WrapperWithThresholdingAddress } =
        await hre.deployments.get("API3WrapperWithThresholding");
      api3WrapperWithThresholdingContract = await hre.ethers.getContractAt(
        "API3WrapperWithThresholding",
        api3WrapperWithThresholdingAddress,
        await hre.ethers.getSigner(deployer)
      );
    } catch (error) {
      console.error(
        "Failed to get API3WrapperWithThresholding contract:",
        error
      );
      throw error;
    }

    // Get token addresses
    const { tokenInfo: frxUSDInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "frxUSD"
    );
    frxUSDAddress = frxUSDInfo.address;

    // Find the mock oracle deployments
    const mockOracleDeployments: Record<string, string> = {};
    const allDeployments = await hre.deployments.all();

    for (const [name, deployment] of Object.entries(allDeployments)) {
      if (name.startsWith("MockAPI3OracleAlwaysAlive_")) {
        const feedName = name.replace("MockAPI3OracleAlwaysAlive_", "");
        mockOracleDeployments[feedName] = deployment.address;
      }
    }

    // Set up proxies for testing
    const frxUSDOracleAddress = mockOracleDeployments["frxUSD_USD"];

    if (!frxUSDOracleAddress) {
      throw new Error("frxUSD_USD mock oracle not found");
    }

    // Set the proxy for the frxUSD token
    await api3WrapperWithThresholdingContract.setProxy(
      frxUSDAddress,
      frxUSDOracleAddress
    );

    // Get the mock oracle contract for verification
    mockAPI3OracleFrxUSDContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      frxUSDOracleAddress,
      await hre.ethers.getSigner(deployer)
    );
  });

  describe("Getting asset prices with thresholding", () => {
    it("should return original price when no threshold is set", async function () {
      const expectedPrice = hre.ethers.parseUnits(
        "1",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      const { price: actualPrice, isAlive } =
        await api3WrapperWithThresholdingContract.getPriceInfo(frxUSDAddress);

      expect(actualPrice).to.equal(expectedPrice);
      expect(isAlive).to.be.true;
    });

    it("should return original price when price is below threshold", async function () {
      const lowerThreshold = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );
      const fixedPrice = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      // Set threshold config
      await api3WrapperWithThresholdingContract.setThresholdConfig(
        frxUSDAddress,
        lowerThreshold,
        fixedPrice
      );

      // Create a mock oracle that can have custom prices
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

      // Set the proxy to use our custom mock oracle
      await api3WrapperWithThresholdingContract.setProxy(
        frxUSDAddress,
        mockAPI3Oracle.address
      );

      // Set price below threshold
      const priceBelowThreshold = hre.ethers.parseUnits(
        "0.98",
        API3_PRICE_DECIMALS
      );
      const currentBlock = await hre.ethers.provider.getBlock("latest");
      if (!currentBlock) throw new Error("Failed to get current block");

      await mockAPI3OracleContract.setMock(
        priceBelowThreshold,
        currentBlock.timestamp
      );

      const { price: actualPrice, isAlive } =
        await api3WrapperWithThresholdingContract.getPriceInfo(frxUSDAddress);

      expect(actualPrice).to.equal(
        hre.ethers.parseUnits("0.98", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
      expect(isAlive).to.be.true;
    });

    it("should return fixed price when price is above threshold", async function () {
      const lowerThreshold = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );
      const fixedPrice = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      // Create a mock oracle that can have custom prices
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

      // Set the proxy to use our custom mock oracle
      await api3WrapperWithThresholdingContract.setProxy(
        frxUSDAddress,
        mockAPI3Oracle.address
      );

      // Set threshold config
      await api3WrapperWithThresholdingContract.setThresholdConfig(
        frxUSDAddress,
        lowerThreshold,
        fixedPrice
      );

      // Set price above threshold
      const priceAboveThreshold = hre.ethers.parseUnits(
        "1.02",
        API3_PRICE_DECIMALS
      );
      const currentBlock = await hre.ethers.provider.getBlock("latest");
      if (!currentBlock) throw new Error("Failed to get current block");

      await mockAPI3OracleContract.setMock(
        priceAboveThreshold,
        currentBlock.timestamp
      );

      const { price: actualPrice, isAlive } =
        await api3WrapperWithThresholdingContract.getPriceInfo(frxUSDAddress);

      expect(actualPrice).to.equal(fixedPrice);
      expect(isAlive).to.be.true;
    });

    it("should handle zero threshold configuration", async function () {
      // Create a mock oracle that can have custom prices
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

      // Set the proxy to use our custom mock oracle
      await api3WrapperWithThresholdingContract.setProxy(
        frxUSDAddress,
        mockAPI3Oracle.address
      );

      // Set threshold config with zero values
      await api3WrapperWithThresholdingContract.setThresholdConfig(
        frxUSDAddress,
        0,
        0
      );

      const testPrice = hre.ethers.parseUnits("1.02", API3_PRICE_DECIMALS);
      const currentBlock = await hre.ethers.provider.getBlock("latest");
      if (!currentBlock) throw new Error("Failed to get current block");

      await mockAPI3OracleContract.setMock(testPrice, currentBlock.timestamp);

      const { price: actualPrice, isAlive } =
        await api3WrapperWithThresholdingContract.getPriceInfo(frxUSDAddress);

      expect(actualPrice).to.equal(
        hre.ethers.parseUnits("1.02", USD_ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
      expect(isAlive).to.be.true;
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

      // Set the proxy to use our custom mock oracle
      await api3WrapperWithThresholdingContract.setProxy(
        frxUSDAddress,
        mockAPI3Oracle.address
      );

      const lowerThreshold = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );
      const fixedPrice = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      // Set threshold config
      await api3WrapperWithThresholdingContract.setThresholdConfig(
        frxUSDAddress,
        lowerThreshold,
        fixedPrice
      );

      const price = hre.ethers.parseUnits("0.98", API3_PRICE_DECIMALS);
      const currentBlock = await hre.ethers.provider.getBlock("latest");
      if (!currentBlock) throw new Error("Failed to get current block");

      const staleTimestamp =
        currentBlock.timestamp - API3_HEARTBEAT_SECONDS * 2;
      await mockAPI3OracleContract.setMock(price, staleTimestamp);

      // getPriceInfo should return false
      const { isAlive } =
        await api3WrapperWithThresholdingContract.getPriceInfo(frxUSDAddress);
      expect(isAlive).to.be.false;

      // getAssetPrice should revert
      await expect(
        api3WrapperWithThresholdingContract.getAssetPrice(frxUSDAddress)
      ).to.be.revertedWithCustomError(
        api3WrapperWithThresholdingContract,
        "PriceIsStale"
      );
    });
  });

  describe("Threshold configuration management", () => {
    it("should allow setting and removing threshold config", async function () {
      const lowerThreshold = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );
      const fixedPrice = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      // Set threshold config
      await expect(
        api3WrapperWithThresholdingContract.setThresholdConfig(
          frxUSDAddress,
          lowerThreshold,
          fixedPrice
        )
      )
        .to.emit(api3WrapperWithThresholdingContract, "ThresholdConfigSet")
        .withArgs(frxUSDAddress, lowerThreshold, fixedPrice);

      // Verify config
      const config =
        await api3WrapperWithThresholdingContract.assetThresholds(
          frxUSDAddress
        );
      expect(config.lowerThresholdInBase).to.equal(lowerThreshold);
      expect(config.fixedPriceInBase).to.equal(fixedPrice);

      // Remove threshold config
      await expect(
        api3WrapperWithThresholdingContract.removeThresholdConfig(frxUSDAddress)
      )
        .to.emit(api3WrapperWithThresholdingContract, "ThresholdConfigRemoved")
        .withArgs(frxUSDAddress);

      // Verify config is removed
      const removedConfig =
        await api3WrapperWithThresholdingContract.assetThresholds(
          frxUSDAddress
        );
      expect(removedConfig.lowerThresholdInBase).to.equal(0);
      expect(removedConfig.fixedPriceInBase).to.equal(0);
    });

    it("should revert when non-ORACLE_MANAGER tries to set threshold config", async function () {
      const unauthorizedSigner = await hre.ethers.getSigner(user1);
      const lowerThreshold = hre.ethers.parseUnits(
        "0.99",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );
      const fixedPrice = hre.ethers.parseUnits(
        "1.00",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      );

      await expect(
        api3WrapperWithThresholdingContract
          .connect(unauthorizedSigner)
          .setThresholdConfig(frxUSDAddress, lowerThreshold, fixedPrice)
      )
        .to.be.revertedWithCustomError(
          api3WrapperWithThresholdingContract,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(
          user1,
          await api3WrapperWithThresholdingContract.ORACLE_MANAGER_ROLE()
        );
    });

    it("should revert when non-ORACLE_MANAGER tries to remove threshold config", async function () {
      const unauthorizedSigner = await hre.ethers.getSigner(user1);

      await expect(
        api3WrapperWithThresholdingContract
          .connect(unauthorizedSigner)
          .removeThresholdConfig(frxUSDAddress)
      )
        .to.be.revertedWithCustomError(
          api3WrapperWithThresholdingContract,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(
          user1,
          await api3WrapperWithThresholdingContract.ORACLE_MANAGER_ROLE()
        );
    });
  });
});
