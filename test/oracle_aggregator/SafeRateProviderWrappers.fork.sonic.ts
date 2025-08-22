import { expect } from "chai";
import hre, { ethers } from "hardhat";

const SONIC_RPC_URL = undefined; //process.env.SONIC_RPC_URL || process.env.SONIC_MAINNET_RPC_URL || "https://rpc.soniclabs.com";
const ACCOUNTANT_WITH_FIXED_RATE_ADDRESS = "0x13cCc810DfaA6B71957F2b87060aFE17e6EB8034";
const BASE_UNIT = 10n ** 18n;

describe("SafeRateProvider Wrappers on Sonic Fork", () => {
  let chainlinkWrapper: any;
  let erc4626Wrapper: any;
  let accountant: any;

  before(async function () {
    return;
    if (!SONIC_RPC_URL) {
      this.skip();
      return;
    }
    this.timeout(120000); // Increase timeout to 2 minutes

    console.log("Forking Sonic mainnet...");
    
    // Fork Sonic mainnet
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: SONIC_RPC_URL,
            // Use latest block instead of specific block number
          },
        },
      ],
    });

    const [signer] = await ethers.getSigners();

    // Connect to the real AccountantWithFixedRate contract
    accountant = await ethers.getContractAt(
      [
        "function getRateSafe() external view returns (uint256)",
        "function getRate() external view returns (uint256)", 
        "function accountantState() external view returns (tuple(address payoutAddress, uint96 highwaterMark, uint128 feesOwedInBase, uint128 totalSharesLastUpdate, uint96 exchangeRate, uint16 allowedExchangeRateChangeUpper, uint16 allowedExchangeRateChangeLower, uint64 lastUpdateTimestamp, bool isPaused, uint24 minimumUpdateDelayInSeconds, uint16 platformFee, uint16 performanceFee))",
        "function decimals() external view returns (uint8)"
      ],
      ACCOUNTANT_WITH_FIXED_RATE_ADDRESS
    );

    // Deploy ChainlinkSafeRateProviderCompositeWrapperWithThresholding
    const ChainlinkFactory = await ethers.getContractFactory(
      "ChainlinkSafeRateProviderCompositeWrapperWithThresholding",
      signer
    );
    chainlinkWrapper = await ChainlinkFactory.deploy(ethers.ZeroAddress, BASE_UNIT);
    await chainlinkWrapper.waitForDeployment();

    // Deploy ERC4626SafeRateProviderWrapperWithThresholding  
    const ERC4626Factory = await ethers.getContractFactory(
      "ERC4626SafeRateProviderWrapperWithThresholding",
      signer
    );
    erc4626Wrapper = await ERC4626Factory.deploy(ethers.ZeroAddress, BASE_UNIT);
    await erc4626Wrapper.waitForDeployment();
  });

  describe("Real AccountantWithFixedRate Integration", () => {
    it("should read accountant state and verify it's not paused", async function () {
      const state = await accountant.accountantState();
      console.log("AccountantWithFixedRate state:");
      console.log("  isPaused:", state.isPaused);
      console.log("  exchangeRate:", state.exchangeRate.toString());
      console.log("  decimals:", await accountant.decimals());
      
      expect(state.isPaused).to.be.false;
    });

    it("should successfully call getRateSafe() directly on accountant", async function () {
      const rateSafe = await accountant.getRateSafe();
      const rate = await accountant.getRate();
      
      console.log("Direct calls to AccountantWithFixedRate:");
      console.log("  getRateSafe():", rateSafe.toString());
      console.log("  getRate():", rate.toString());
      
      expect(rateSafe).to.equal(rate);
      expect(rateSafe).to.be.gt(0);
    });

    it("should work with ChainlinkSafeRateProviderCompositeWrapper", async function () {
      // Deploy a mock Chainlink aggregator for testing
      const mockChainlink = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "MOCK/USD"]);
      await mockChainlink.setMock(ethers.parseUnits("1.0", 8)); // Set to 1.0 USD

      const assetKey = ethers.Wallet.createRandom().address;
      
      // Add composite feed with real AccountantWithFixedRate
      await chainlinkWrapper.addCompositeFeed(
        assetKey,
        await mockChainlink.getAddress(),
        ACCOUNTANT_WITH_FIXED_RATE_ADDRESS,
        BASE_UNIT, // AccountantWithFixedRate returns 18 decimal values
        0, // No thresholds
        0,
        0,
        0
      );

      const { price, isAlive } = await chainlinkWrapper.getPriceInfo(assetKey);
      
      console.log("ChainlinkSafeRateProviderCompositeWrapper result:");
      console.log("  price:", price.toString());
      console.log("  isAlive:", isAlive);
      
      expect(isAlive).to.be.true;
      expect(price).to.be.gt(0);
      
      // Verify we can also call getAssetPrice
      const directPrice = await chainlinkWrapper.getAssetPrice(assetKey);
      expect(directPrice).to.equal(price);
    });

    it("should work with ERC4626SafeRateProviderWrapper", async function () {
      // Deploy a mock ERC4626 vault for testing
      const mockUnderlying = await ethers.deployContract("TestERC20", ["MockUSD", "MUSD", 18]);
      const mockVault = await ethers.deployContract(
        "MockERC4626FixedRate",
        [await mockUnderlying.getAddress(), BASE_UNIT, ethers.parseUnits("1.05", 18)] // 1.05 exchange rate
      );

      const assetKey = ethers.Wallet.createRandom().address;
      
      // Add feed with real AccountantWithFixedRate
      await erc4626Wrapper.setFeed(
        assetKey,
        await mockVault.getAddress(),
        ACCOUNTANT_WITH_FIXED_RATE_ADDRESS,
        BASE_UNIT, // AccountantWithFixedRate returns 18 decimal values
        0, // No thresholds
        0,
        0,
        0
      );

      const { price, isAlive } = await erc4626Wrapper.getPriceInfo(assetKey);
      
      console.log("ERC4626SafeRateProviderWrapper result:");
      console.log("  price:", price.toString());
      console.log("  isAlive:", isAlive);
      
      expect(isAlive).to.be.true;
      expect(price).to.be.gt(0);
      
      // Verify we can also call getAssetPrice
      const directPrice = await erc4626Wrapper.getAssetPrice(assetKey);
      expect(directPrice).to.equal(price);
    });

    it("should calculate expected composite price correctly", async function () {
      // Test with known values to verify price calculation
      const mockChainlink = await ethers.deployContract("MockChainlinkAggregatorV3", [8, "TEST/USD"]);
      const chainlinkPrice = ethers.parseUnits("2.0", 8); // 2.0 USD
      await mockChainlink.setMock(chainlinkPrice);

      const accountantRate = await accountant.getRateSafe();
      
      const assetKey = ethers.Wallet.createRandom().address;
      
      await chainlinkWrapper.addCompositeFeed(
        assetKey,
        await mockChainlink.getAddress(),
        ACCOUNTANT_WITH_FIXED_RATE_ADDRESS,
        BASE_UNIT,
        0, 0, 0, 0
      );

      const { price } = await chainlinkWrapper.getPriceInfo(assetKey);
      
      // Expected calculation: (chainlinkPrice * BASE_UNIT / 1e8) * (accountantRate * BASE_UNIT / BASE_UNIT) / BASE_UNIT
      // Simplified: chainlinkPrice * accountantRate / 1e8
      const expectedPrice = (BigInt(chainlinkPrice) * accountantRate) / (10n ** 8n);
      
      console.log("Price calculation verification:");
      console.log("  Chainlink price (8 decimals):", chainlinkPrice.toString());
      console.log("  Accountant rate (18 decimals):", accountantRate.toString());
      console.log("  Expected composed price:", expectedPrice.toString());
      console.log("  Actual composed price:", price.toString());
      
      expect(price).to.equal(expectedPrice);
    });
  });
});
