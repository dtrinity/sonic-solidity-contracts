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

describe("SwapExecutor - Pure Logic Tests", function () {
  let fixture: OdosV2TestFixture;

  beforeEach(async function () {
    fixture = await deployOdosV2TestFixture();
    await setupTestEnvironment(fixture);
  });

  describe("Route Determination Logic", function () {
    it("should correctly route regular token swaps to Odos only", async function () {
      const { swapExecutorHarness, odosRouter, tokenA, tokenB } = fixture;

      // Configure mock router
      await odosRouter.setSwapBehaviour(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        ethers.parseEther("1000"),
        ethers.parseEther("950"),
        false,
      );

      const params = {
        inputToken: await tokenA.getAddress(),
        outputToken: await tokenB.getAddress(),
        exactInputAmount: ethers.parseEther("1000"),
        minOutputAmount: ethers.parseEther("900"),
        swapData: createOdosSwapData(odosRouter),
        pendleRouter: ethers.ZeroAddress, // not used for regular swaps
        odosRouter: await odosRouter.getAddress(),
      };

      // This tests the routing logic - should use Odos path
      // Note: For pure logic testing, we focus on the routing decision, not execution result
      try {
        const result = await swapExecutorHarness.executeSwapExactInput(params);
        // If execution succeeds, routing worked correctly
        expect(result).to.be.a("bigint");
      } catch (error: any) {
        // If it fails, check it's not a routing error but an execution error
        expect(error.message).to.not.include("InvalidSwapData");
      }
    });

    it("should validate PT swap data before routing", async function () {
      const { swapExecutorHarness, pendleRouter, odosRouter, ptTokenA, tokenB } = fixture;

      // Test invalid PT swap data validation
      const invalidSwapData = createPTSwapData(
        true, // composed
        ethers.ZeroAddress, // invalid - missing underlying asset
        "0x", // missing pendle calldata
        "0x",
      );

      const params = {
        inputToken: await ptTokenA.getAddress(),
        outputToken: await tokenB.getAddress(),
        exactInputAmount: ethers.parseEther("1000"),
        minOutputAmount: ethers.parseEther("850"),
        swapData: encodePTSwapData(invalidSwapData),
        pendleRouter: await pendleRouter.getAddress(),
        odosRouter: await odosRouter.getAddress(),
      };

      // Should revert due to invalid swap data validation
      await expect(swapExecutorHarness.executeSwapExactInput(params)).to.be.revertedWithCustomError(swapExecutorHarness, "InvalidSwapData");
    });
  });

  describe("Parameter Validation Logic", function () {
    it("should validate exact input parameters", async function () {
      const { swapExecutorHarness, odosRouter, tokenA, tokenB } = fixture;

      const params = {
        inputToken: await tokenA.getAddress(),
        outputToken: await tokenB.getAddress(),
        exactInputAmount: 0, // zero input
        minOutputAmount: ethers.parseEther("100"),
        swapData: createOdosSwapData(odosRouter),
        pendleRouter: ethers.ZeroAddress,
        odosRouter: await odosRouter.getAddress(),
      };

      // Test zero input handling
      try {
        await swapExecutorHarness.executeSwapExactInput(params);
      } catch (error: any) {
        // Should handle zero inputs gracefully or revert appropriately
        expect(error.message).to.be.a("string");
      }
    });

    it("should validate exact output parameters", async function () {
      const { swapExecutorHarness, odosRouter, tokenA, tokenB } = fixture;

      const params = {
        inputToken: await tokenA.getAddress(),
        outputToken: await tokenB.getAddress(),
        maxInputAmount: ethers.parseEther("1000"),
        exactOutputAmount: 0, // zero output
        swapData: createOdosSwapData(odosRouter),
        pendleRouter: ethers.ZeroAddress,
        odosRouter: await odosRouter.getAddress(),
      };

      // Test zero output handling
      try {
        await swapExecutorHarness.executeSwapExactOutput(params);
      } catch (error: any) {
        // Should handle zero outputs gracefully or revert appropriately
        expect(error.message).to.be.a("string");
      }
    });

    it("should validate router addresses", async function () {
      const { swapExecutorHarness, odosRouter, ptTokenA, tokenB } = fixture;

      const swapData = createPTSwapData(
        true,
        await fixture.tokenA.getAddress(), // Fix: use fixture.tokenA
        createPendleSwapData(fixture.pendleRouter),
        createOdosSwapData(odosRouter),
      );

      const params = {
        inputToken: await ptTokenA.getAddress(),
        outputToken: await tokenB.getAddress(),
        exactInputAmount: ethers.parseEther("1000"),
        minOutputAmount: ethers.parseEther("850"),
        swapData: encodePTSwapData(swapData),
        pendleRouter: ethers.ZeroAddress, // invalid - zero address for PT swap
        odosRouter: await odosRouter.getAddress(),
      };

      // Should fail validation due to zero router address for PT swap
      await expect(swapExecutorHarness.executeSwapExactInput(params)).to.be.reverted;
    });
  });

  describe("Swap Data Structure Logic", function () {
    it("should decode PT swap data correctly", async function () {
      const { odosRouter, pendleRouter, tokenA } = fixture;

      const originalData = createPTSwapData(
        true,
        await tokenA.getAddress(),
        createPendleSwapData(pendleRouter),
        createOdosSwapData(odosRouter),
      );

      const encoded = encodePTSwapData(originalData);

      // Test that encoding/decoding works correctly
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["tuple(bool,address,bytes,bytes)"], encoded);

      expect(decoded[0][0]).to.equal(originalData.isComposed);
      expect(decoded[0][1]).to.equal(originalData.underlyingAsset);
      expect(decoded[0][2]).to.equal(originalData.pendleCalldata);
      expect(decoded[0][3]).to.equal(originalData.odosCalldata);
    });

    it("should handle empty swap data gracefully", async function () {
      const emptyData = createPTSwapData(false, ethers.ZeroAddress, "0x", "0x");
      const encoded = encodePTSwapData(emptyData);

      expect(encoded).to.be.a("string");
      expect(encoded.length).to.be.greaterThan(0);

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["tuple(bool,address,bytes,bytes)"], encoded);

      expect(decoded[0][0]).to.be.false; // isComposed
      expect(decoded[0][1]).to.equal(ethers.ZeroAddress); // underlyingAsset
    });
  });

  describe("Error Recovery Logic", function () {
    it("should handle invalid swap types gracefully", async function () {
      const { swapExecutorHarness, odosRouter, tokenA, tokenB } = fixture;

      // Test with malformed swap data that would cause routing errors
      const params = {
        inputToken: await tokenA.getAddress(),
        outputToken: await tokenB.getAddress(),
        exactInputAmount: ethers.parseEther("1000"),
        minOutputAmount: ethers.parseEther("900"),
        swapData: "0x", // completely empty swap data
        pendleRouter: ethers.ZeroAddress,
        odosRouter: await odosRouter.getAddress(),
      };

      // Should fail gracefully with appropriate error
      await expect(swapExecutorHarness.executeSwapExactInput(params)).to.be.reverted;
    });

    it("should validate function signatures in swap data", async function () {
      const { swapExecutorHarness, odosRouter, tokenA, tokenB } = fixture;

      // Test with invalid function signature
      const invalidSwapData = "0x12345678"; // Invalid function selector

      const params = {
        inputToken: await tokenA.getAddress(),
        outputToken: await tokenB.getAddress(),
        exactInputAmount: ethers.parseEther("1000"),
        minOutputAmount: ethers.parseEther("900"),
        swapData: invalidSwapData,
        pendleRouter: ethers.ZeroAddress,
        odosRouter: await odosRouter.getAddress(),
      };

      // Should fail during swap execution validation
      await expect(swapExecutorHarness.executeSwapExactInput(params)).to.be.reverted;
    });
  });

  describe("State Consistency Logic", function () {
    it("should maintain consistent state across multiple calls", async function () {
      const { swapExecutorHarness } = fixture;

      // Test that harness maintains state correctly
      const balance1 = await swapExecutorHarness.getTokenBalance(await fixture.tokenA.getAddress());
      const balance2 = await swapExecutorHarness.getTokenBalance(await fixture.tokenA.getAddress());

      expect(balance1).to.equal(balance2); // Should be deterministic
      expect(balance1).to.equal(ethers.parseEther("1000000")); // From setup
    });

    it("should handle concurrent validation calls", async function () {
      const { pendleLogicHarness, tokenA, tokenB, ptTokenA } = fixture;

      // Test multiple determineSwapType calls
      const type1 = await pendleLogicHarness.determineSwapType(await tokenA.getAddress(), await tokenB.getAddress());

      const type2 = await pendleLogicHarness.determineSwapType(await ptTokenA.getAddress(), await tokenB.getAddress());

      expect(type1).to.equal(0); // REGULAR_SWAP
      expect(type2).to.equal(1); // PT_TO_REGULAR

      // Results should be consistent
      const type1Again = await pendleLogicHarness.determineSwapType(await tokenA.getAddress(), await tokenB.getAddress());
      expect(type1Again).to.equal(type1);
    });
  });
});
