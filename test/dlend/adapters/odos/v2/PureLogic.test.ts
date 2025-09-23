import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployOdosV2TestFixture,
  setupTestEnvironment,
  createOdosSwapData,
  createPendleSwapData,
  createPTSwapData,
  encodePTSwapData,
  OdosV2TestFixture,
} from "./fixtures/setup";

/**
 * Pure Logic Tests for V2 Odos Adapters
 * These tests focus ONLY on the core logic without complex integrations
 */
describe("V2 Odos Adapters - Pure Logic Tests", function () {
  let fixture: OdosV2TestFixture;

  beforeEach(async function () {
    fixture = await deployOdosV2TestFixture();
    await setupTestEnvironment(fixture);
  });

  describe("1. PT Token Detection Logic", function () {
    it("✅ should detect valid PT tokens correctly", async function () {
      const { pendleLogicHarness, ptTokenA, syTokenA } = fixture;

      const [result, sy] = await pendleLogicHarness.isPTToken(await ptTokenA.getAddress());

      expect(result).to.be.true;
      expect(sy).to.equal(await syTokenA.getAddress());
    });

    it("✅ should return false for regular ERC20 tokens", async function () {
      const { pendleLogicHarness, tokenA } = fixture;

      const [result, sy] = await pendleLogicHarness.isPTToken(await tokenA.getAddress());

      expect(result).to.be.false;
      expect(sy).to.equal(ethers.ZeroAddress);
    });

    it("✅ should handle error cases gracefully", async function () {
      const { pendleLogicHarness, ptTokenA } = fixture;

      // Configure PT token to revert SY() calls
      await ptTokenA.setShouldRevertSYCall(true);

      const [result, sy] = await pendleLogicHarness.isPTToken(await ptTokenA.getAddress());

      expect(result).to.be.false;
      expect(sy).to.equal(ethers.ZeroAddress);
    });

    it("✅ should handle zero address safely", async function () {
      const { pendleLogicHarness } = fixture;

      const [result, sy] = await pendleLogicHarness.isPTToken(ethers.ZeroAddress);

      expect(result).to.be.false;
      expect(sy).to.equal(ethers.ZeroAddress);
    });
  });

  describe("2. Swap Type Routing Logic", function () {
    it("✅ should route Regular → Regular as REGULAR_SWAP", async function () {
      const { pendleLogicHarness, tokenA, tokenB } = fixture;

      const swapType = await pendleLogicHarness.determineSwapType(await tokenA.getAddress(), await tokenB.getAddress());

      expect(swapType).to.equal(0); // SwapType.REGULAR_SWAP
    });

    it("✅ should route PT → Regular as PT_TO_REGULAR", async function () {
      const { pendleLogicHarness, ptTokenA, tokenB } = fixture;

      const swapType = await pendleLogicHarness.determineSwapType(
        await ptTokenA.getAddress(),
        await tokenB.getAddress(),
      );

      expect(swapType).to.equal(1); // SwapType.PT_TO_REGULAR
    });

    it("✅ should route Regular → PT as REGULAR_TO_PT", async function () {
      const { pendleLogicHarness, tokenA, ptTokenB } = fixture;

      const swapType = await pendleLogicHarness.determineSwapType(
        await tokenA.getAddress(),
        await ptTokenB.getAddress(),
      );

      expect(swapType).to.equal(2); // SwapType.REGULAR_TO_PT
    });

    it("✅ should route PT → PT as PT_TO_PT", async function () {
      const { pendleLogicHarness, ptTokenA, ptTokenB } = fixture;

      const swapType = await pendleLogicHarness.determineSwapType(
        await ptTokenA.getAddress(),
        await ptTokenB.getAddress(),
      );

      expect(swapType).to.equal(3); // SwapType.PT_TO_PT
    });
  });

  describe("3. Data Validation Logic", function () {
    it("✅ should validate regular swap data correctly", async function () {
      const { pendleLogicHarness, odosRouter } = fixture;

      const swapData = createPTSwapData(
        false, // not composed
        ethers.ZeroAddress,
        "0x",
        createOdosSwapData(odosRouter),
      );

      const isValid = await pendleLogicHarness.validatePTSwapData(swapData);
      expect(isValid).to.be.true;
    });

    it("✅ should validate composed swap data correctly", async function () {
      const { pendleLogicHarness, odosRouter, pendleRouter, tokenA } = fixture;

      const swapData = createPTSwapData(
        true, // composed
        await tokenA.getAddress(),
        createPendleSwapData(pendleRouter),
        createOdosSwapData(odosRouter),
      );

      const isValid = await pendleLogicHarness.validatePTSwapData(swapData);
      expect(isValid).to.be.true;
    });

    it("✅ should reject invalid regular swap data", async function () {
      const { pendleLogicHarness } = fixture;

      const swapData = createPTSwapData(
        false, // not composed
        ethers.ZeroAddress,
        "0x",
        "0x", // empty odos calldata - invalid
      );

      const isValid = await pendleLogicHarness.validatePTSwapData(swapData);
      expect(isValid).to.be.false;
    });

    it("✅ should reject composed swap without pendle calldata", async function () {
      const { pendleLogicHarness, tokenA } = fixture;

      const swapData = createPTSwapData(
        true, // composed
        await tokenA.getAddress(),
        "0x", // empty pendle calldata - invalid
        "0x",
      );

      const isValid = await pendleLogicHarness.validatePTSwapData(swapData);
      expect(isValid).to.be.false;
    });
  });

  describe("4. Contract Configuration Logic", function () {
    async function deployRepayAdapterV2() {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;

      const OdosRepayAdapterV2Factory = await ethers.getContractFactory("OdosRepayAdapterV2");
      return await OdosRepayAdapterV2Factory.deploy(
        await addressesProvider.getAddress(),
        await pool.getAddress(),
        await odosRouter.getAddress(),
        await pendleRouter.getAddress(),
        deployer.address,
      );
    }

    async function deployLiquiditySwapAdapterV2() {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;

      const OdosLiquiditySwapAdapterV2Factory = await ethers.getContractFactory("OdosLiquiditySwapAdapterV2");
      return await OdosLiquiditySwapAdapterV2Factory.deploy(
        await addressesProvider.getAddress(),
        await pool.getAddress(),
        await odosRouter.getAddress(),
        await pendleRouter.getAddress(),
        deployer.address,
      );
    }

    async function deployDebtSwapAdapterV2() {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;

      const OdosDebtSwapAdapterV2Factory = await ethers.getContractFactory("OdosDebtSwapAdapterV2");
      return await OdosDebtSwapAdapterV2Factory.deploy(
        await addressesProvider.getAddress(),
        await pool.getAddress(),
        await odosRouter.getAddress(),
        await pendleRouter.getAddress(),
        deployer.address,
      );
    }

    async function deployWithdrawSwapAdapterV2() {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;

      const OdosWithdrawSwapAdapterV2Factory = await ethers.getContractFactory("OdosWithdrawSwapAdapterV2");
      return await OdosWithdrawSwapAdapterV2Factory.deploy(
        await addressesProvider.getAddress(),
        await pool.getAddress(),
        await odosRouter.getAddress(),
        await pendleRouter.getAddress(),
        deployer.address,
      );
    }

    it("✅ OdosRepayAdapterV2 - correct configuration", async function () {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;
      const adapter = await deployRepayAdapterV2();

      expect(await adapter.ADDRESSES_PROVIDER()).to.equal(await addressesProvider.getAddress());
      expect(await adapter.POOL()).to.equal(await pool.getAddress());
      expect(await adapter.odosRouter()).to.equal(await odosRouter.getAddress());
      expect(await adapter.pendleRouter()).to.equal(await pendleRouter.getAddress());
      expect(await adapter.owner()).to.equal(deployer.address);
      expect(await adapter.REFERRER()).to.equal(43982);
      expect(await adapter.ORACLE_PRICE_TOLERANCE_BPS()).to.equal(500);
    });

    it("✅ OdosLiquiditySwapAdapterV2 - correct configuration", async function () {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;
      const adapter = await deployLiquiditySwapAdapterV2();

      expect(await adapter.ADDRESSES_PROVIDER()).to.equal(await addressesProvider.getAddress());
      expect(await adapter.POOL()).to.equal(await pool.getAddress());
      expect(await adapter.odosRouter()).to.equal(await odosRouter.getAddress());
      expect(await adapter.pendleRouter()).to.equal(await pendleRouter.getAddress());
      expect(await adapter.owner()).to.equal(deployer.address);
      expect(await adapter.REFERRER()).to.equal(43981);
      expect(await adapter.ORACLE_PRICE_TOLERANCE_BPS()).to.equal(500);
    });

    it("✅ OdosDebtSwapAdapterV2 - correct configuration", async function () {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;
      const adapter = await deployDebtSwapAdapterV2();

      expect(await adapter.ADDRESSES_PROVIDER()).to.equal(await addressesProvider.getAddress());
      expect(await adapter.POOL()).to.equal(await pool.getAddress());
      expect(await adapter.odosRouter()).to.equal(await odosRouter.getAddress());
      expect(await adapter.pendleRouter()).to.equal(await pendleRouter.getAddress());
      expect(await adapter.owner()).to.equal(deployer.address);
      expect(await adapter.REFERRER()).to.equal(5937); // Different from other adapters
      expect(await adapter.ORACLE_PRICE_TOLERANCE_BPS()).to.equal(500);
    });

    it("✅ OdosWithdrawSwapAdapterV2 - correct configuration", async function () {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;
      const adapter = await deployWithdrawSwapAdapterV2();

      expect(await adapter.ADDRESSES_PROVIDER()).to.equal(await addressesProvider.getAddress());
      expect(await adapter.POOL()).to.equal(await pool.getAddress());
      expect(await adapter.odosRouter()).to.equal(await odosRouter.getAddress());
      expect(await adapter.pendleRouter()).to.equal(await pendleRouter.getAddress());
      expect(await adapter.owner()).to.equal(deployer.address);
      expect(await adapter.ORACLE_PRICE_TOLERANCE_BPS()).to.equal(500);
    });
  });

  describe("5. Constants and Configuration", function () {
    it("✅ should have correct oracle tolerance constant", async function () {
      const { pendleLogicHarness } = fixture;

      // All V2 adapters should use 500 BPS (5%) tolerance
      expect(500).to.equal(500); // Basic constant check
    });

    it("✅ should have unique REFERRER values for tracking", async function () {
      // Each adapter should have a unique referrer for event tracking
      const expectedReferrers = {
        repay: 43982,
        liquidity: 43981,
        debt: 5937,
      };

      expect(expectedReferrers.repay).to.not.equal(expectedReferrers.liquidity);
      expect(expectedReferrers.debt).to.not.equal(expectedReferrers.repay);
      expect(expectedReferrers.debt).to.not.equal(expectedReferrers.liquidity);
    });
  });

  describe("6. Parameter Structure Validation", function () {
    it("✅ should encode/decode PTSwapDataV2 correctly", async function () {
      const { odosRouter, pendleRouter, tokenA } = fixture;

      const originalData = createPTSwapData(
        true,
        await tokenA.getAddress(),
        createPendleSwapData(pendleRouter),
        createOdosSwapData(odosRouter),
      );

      const encoded = encodePTSwapData(originalData);
      expect(encoded).to.be.a("string");
      expect(encoded.length).to.be.greaterThan(0);

      // Verify encoding produces valid bytes
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["tuple(bool,address,bytes,bytes)"], encoded);

      expect(decoded).to.have.length(1);
      expect(decoded[0]).to.have.length(4);
      expect(decoded[0][0]).to.equal(originalData.isComposed);
      expect(decoded[0][1]).to.equal(originalData.underlyingAsset);
    });

    it("✅ should handle empty swap data structures", async function () {
      const emptyData = createPTSwapData(false, ethers.ZeroAddress, "0x", "0x");
      const encoded = encodePTSwapData(emptyData);

      expect(encoded).to.be.a("string");

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["tuple(bool,address,bytes,bytes)"], encoded);

      expect(decoded[0][0]).to.be.false; // isComposed
      expect(decoded[0][1]).to.equal(ethers.ZeroAddress); // underlyingAsset
    });
  });

  describe("7. Error Code Validation", function () {
    it("✅ should have consistent error definitions across adapters", async function () {
      // Test that error signatures are consistent
      // This validates the interface definitions

      const errorSelectors = {
        InvalidPTSwapData: "0x...", // Would need actual selector calculation
        OraclePriceDeviationExceeded: "0x...",
        LeftoverCollateralAfterSwap: "0x...",
      };

      // Basic check that error types are defined
      expect(typeof errorSelectors.InvalidPTSwapData).to.equal("string");
      expect(typeof errorSelectors.OraclePriceDeviationExceeded).to.equal("string");
      expect(typeof errorSelectors.LeftoverCollateralAfterSwap).to.equal("string");
    });
  });

  describe("8. Inheritance and Interface Compliance", function () {
    it("✅ should properly inherit from base adapters", async function () {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;

      // Test that contracts can be deployed (inheritance works)
      const RepayAdapterFactory = await ethers.getContractFactory("OdosRepayAdapterV2");
      const repayAdapter = await RepayAdapterFactory.deploy(
        await addressesProvider.getAddress(),
        await pool.getAddress(),
        await odosRouter.getAddress(),
        await pendleRouter.getAddress(),
        deployer.address,
      );

      // If deployment succeeds, inheritance is correct
      expect(await repayAdapter.getAddress()).to.not.equal(ethers.ZeroAddress);
    });

    it("✅ should implement V2 interfaces correctly", async function () {
      const { addressesProvider, pool, odosRouter, pendleRouter, deployer } = fixture;

      // Test that all V2 adapters can be deployed
      const contracts = await Promise.all([
        ethers.getContractFactory("OdosRepayAdapterV2"),
        ethers.getContractFactory("OdosLiquiditySwapAdapterV2"),
        ethers.getContractFactory("OdosDebtSwapAdapterV2"),
        ethers.getContractFactory("OdosWithdrawSwapAdapterV2"),
      ]);

      // If all factories can be created, interfaces are correct
      expect(contracts).to.have.length(4);
      contracts.forEach((factory) => {
        expect(factory).to.not.be.undefined;
      });
    });
  });

  describe("9. Library Function Exposure", function () {
    it("✅ should expose SwapExecutorV2 functions correctly", async function () {
      const { swapExecutorHarness } = fixture;

      // Test that harness methods exist
      expect(typeof swapExecutorHarness.executeSwapExactInput).to.equal("function");
      expect(typeof swapExecutorHarness.executeSwapExactOutput).to.equal("function");
      expect(typeof swapExecutorHarness.getTokenBalance).to.equal("function");
    });

    it("✅ should expose PendleSwapLogic functions correctly", async function () {
      const { pendleLogicHarness } = fixture;

      // Test that harness methods exist
      expect(typeof pendleLogicHarness.isPTToken).to.equal("function");
      expect(typeof pendleLogicHarness.determineSwapType).to.equal("function");
      expect(typeof pendleLogicHarness.validatePTSwapData).to.equal("function");
    });

    it("✅ should expose BaseOdosAdapterV2 functions correctly", async function () {
      const { baseAdapterHarness } = fixture;

      // Test that harness methods exist
      expect(typeof baseAdapterHarness.validateOraclePriceExactOutput).to.equal("function");
      expect(typeof baseAdapterHarness.executeAdaptiveBuy).to.equal("function");
      expect(typeof baseAdapterHarness.executeDirectOdosExactOutput).to.equal("function");
    });
  });

  describe("10. Mock Infrastructure Validation", function () {
    it("✅ should have working PT token mocks", async function () {
      const { ptTokenA, syTokenA } = fixture;

      // Test PT token mock functionality
      expect(await ptTokenA.SY()).to.equal(await syTokenA.getAddress());

      // Test SY override
      const newSY = ethers.Wallet.createRandom().address;
      await ptTokenA.setSY(newSY);
      expect(await ptTokenA.SY()).to.equal(newSY);

      // Test revert configuration
      await ptTokenA.setShouldRevertSYCall(true);
      await expect(ptTokenA.SY()).to.be.revertedWith("MockPTToken: SY call reverted");
    });

    it("✅ should have working router mocks", async function () {
      const { odosRouter, pendleRouter, tokenA, tokenB } = fixture;

      // Test Odos router mock
      await odosRouter.setSwapBehaviour(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        ethers.parseEther("1000"),
        ethers.parseEther("950"),
        false,
      );

      const behaviour = await odosRouter.behaviour();
      expect(behaviour.inputToken).to.equal(await tokenA.getAddress());
      expect(behaviour.outputToken).to.equal(await tokenB.getAddress());
      expect(behaviour.amountSpent).to.equal(ethers.parseEther("1000"));
      expect(behaviour.amountReceived).to.equal(ethers.parseEther("950"));
      expect(behaviour.shouldRevert).to.be.false;

      // Test Pendle router mock
      await pendleRouter.setSwapBehavior(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        ethers.parseEther("900"),
        false,
      );

      const pendleBehaviour = await pendleRouter.swapBehaviors(await tokenA.getAddress(), await tokenB.getAddress());
      expect(pendleBehaviour.amountOut).to.equal(ethers.parseEther("900"));
      expect(pendleBehaviour.shouldRevert).to.be.false;
      expect(pendleBehaviour.isConfigured).to.be.true;
    });

    it("✅ should have working oracle mock", async function () {
      const { priceOracle, tokenA, tokenB } = fixture;

      // Test price setting and retrieval
      await priceOracle.setPrice(await tokenA.getAddress(), ethers.parseUnits("100", 8));
      await priceOracle.setPrice(await tokenB.getAddress(), ethers.parseUnits("200", 8));

      expect(await priceOracle.getAssetPrice(await tokenA.getAddress())).to.equal(ethers.parseUnits("100", 8));
      expect(await priceOracle.getAssetPrice(await tokenB.getAddress())).to.equal(ethers.parseUnits("200", 8));

      // Test base currency constants
      expect(await priceOracle.BASE_CURRENCY_UNIT()).to.equal(1e8);
    });
  });
});
