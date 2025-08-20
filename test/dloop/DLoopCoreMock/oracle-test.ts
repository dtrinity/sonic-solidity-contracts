import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { deployDLoopMockFixture, testSetup } from "./fixture";

// NOTE: Mostly covered by CoreLogic conversion tests; skip redundant mock-level oracle tests
describe.skip("DLoopCoreMock Oracle Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let otherToken: TestMintableERC20;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    accounts = fixture.accounts;

    // Deploy an additional token for testing oracle functionality
    const TestMintableERC20 =
      await ethers.getContractFactory("TestMintableERC20");
    otherToken = await TestMintableERC20.deploy("Other Token", "OTHER", 6);
    await otherToken.waitForDeployment();
  });

  describe("I. Basic Oracle Functionality", function () {
    it("Should set and get mock prices correctly", async function () {
      const collateralPrice = ethers.parseEther("1500"); // $1500 with 18 decimals
      const debtPrice = ethers.parseEther("1"); // $1 with 18 decimals

      // Set mock prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        collateralPrice,
      );
      await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

      // Get mock prices and verify
      expect(
        await dloopMock.getMockPrice(await collateralToken.getAddress()),
      ).to.equal(collateralPrice);
      expect(
        await dloopMock.getMockPrice(await debtToken.getAddress()),
      ).to.equal(debtPrice);
    });

    it("Should handle different token decimals correctly", async function () {
      const price6Decimals = ethers.parseUnits("1", 6); // $1 with 6 decimals
      const price18Decimals = ethers.parseEther("2000"); // $2000 with 18 decimals

      // Set prices for tokens with different decimals
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(), // 18 decimals
        price18Decimals,
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(), // 18 decimals
        price18Decimals,
      );
      await dloopMock.setMockPrice(
        await otherToken.getAddress(), // 6 decimals
        price6Decimals,
      );

      // Verify prices are stored correctly
      expect(
        await dloopMock.getMockPrice(await collateralToken.getAddress()),
      ).to.equal(price18Decimals);
      expect(
        await dloopMock.getMockPrice(await debtToken.getAddress()),
      ).to.equal(price18Decimals);
      expect(
        await dloopMock.getMockPrice(await otherToken.getAddress()),
      ).to.equal(price6Decimals);
    });

    it("Should update mock prices correctly", async function () {
      const initialPrice = ethers.parseEther("1000");
      const updatedPrice = ethers.parseEther("1200");

      // Set initial price
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        initialPrice,
      );
      expect(
        await dloopMock.getMockPrice(await collateralToken.getAddress()),
      ).to.equal(initialPrice);

      // Update price
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        updatedPrice,
      );
      expect(
        await dloopMock.getMockPrice(await collateralToken.getAddress()),
      ).to.equal(updatedPrice);
    });
  });

  describe("II. Oracle Implementation Functions", function () {
    beforeEach(async function () {
      // Set up some basic prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1500"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("1"),
      );
    });

    it("Should get asset price from oracle implementation", async function () {
      const expectedPrice = ethers.parseEther("1500");

      const price = await dloopMock.getAssetPriceFromOracle(
        await collateralToken.getAddress(),
      );
      expect(price).to.equal(expectedPrice);
    });

    it("Should revert when getting price for asset without price set", async function () {
      await expect(
        dloopMock.getAssetPriceFromOracle(await otherToken.getAddress()),
      ).to.be.revertedWithCustomError(dloopMock, "MockPriceNotSet");
    });

    it("Should use oracle price via public wrapper function", async function () {
      const expectedPrice = ethers.parseEther("1500");

      const price = await dloopMock.getAssetPriceFromOracle(
        await collateralToken.getAddress(),
      );
      expect(price).to.equal(expectedPrice);
    });

    it("Should revert with AssetPriceIsZero when price is zero", async function () {
      // Note: The mock implementation reverts with "Mock price not set"
      // when price is 0, which is the expected behavior for the mock
      await dloopMock.setMockPrice(await collateralToken.getAddress(), 0);

      await expect(
        dloopMock.getAssetPriceFromOracle(await collateralToken.getAddress()),
      ).to.be.revertedWithCustomError(dloopMock, "MockPriceNotSet");
    });
  });

  describe("III. Price Conversion Functions", function () {
    beforeEach(async function () {
      // Set up prices for conversion tests
      // Collateral: $1500 (18 decimals)
      // Debt: $1 (18 decimals)
      // Other: $10 (6 decimals)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1500"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("1"),
      );
      await dloopMock.setMockPrice(
        await otherToken.getAddress(),
        ethers.parseEther("10"),
      );
    });

    describe("Base Currency to Token Conversion", function () {
      it("Should convert from base currency to collateral token correctly", async function () {
        const amountInBase = ethers.parseEther("3000"); // $3000
        const expectedTokenAmount = ethers.parseEther("2"); // 2 tokens at $1500 each

        const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
          amountInBase,
          await collateralToken.getAddress(),
        );
        expect(tokenAmount).to.equal(expectedTokenAmount);
      });

      it("Should convert from base currency to debt token correctly", async function () {
        const amountInBase = ethers.parseEther("1000"); // $1000
        const expectedTokenAmount = ethers.parseEther("1000"); // 1000 tokens at $1 each

        const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
          amountInBase,
          await debtToken.getAddress(),
        );
        expect(tokenAmount).to.equal(expectedTokenAmount);
      });

      it("Should convert from base currency to token with different decimals", async function () {
        const amountInBase = ethers.parseEther("100"); // $100
        const expectedTokenAmount = ethers.parseUnits("10", 6); // 10 tokens at $10 each (6 decimals)

        const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
          amountInBase,
          await otherToken.getAddress(),
        );
        expect(tokenAmount).to.equal(expectedTokenAmount);
      });

      it("Should handle zero amount conversion", async function () {
        const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
          0,
          await collateralToken.getAddress(),
        );
        expect(tokenAmount).to.equal(0);
      });
    });

    describe("Token to Base Currency Conversion", function () {
      it("Should convert from collateral token to base currency correctly", async function () {
        const tokenAmount = ethers.parseEther("2"); // 2 tokens
        const expectedBaseAmount = ethers.parseEther("3000"); // $3000 at $1500 each

        const baseAmount = await dloopMock.convertFromTokenAmountToBaseCurrency(
          tokenAmount,
          await collateralToken.getAddress(),
        );
        expect(baseAmount).to.equal(expectedBaseAmount);
      });

      it("Should convert from debt token to base currency correctly", async function () {
        const tokenAmount = ethers.parseEther("500"); // 500 tokens
        const expectedBaseAmount = ethers.parseEther("500"); // $500 at $1 each

        const baseAmount = await dloopMock.convertFromTokenAmountToBaseCurrency(
          tokenAmount,
          await debtToken.getAddress(),
        );
        expect(baseAmount).to.equal(expectedBaseAmount);
      });

      it("Should convert from token with different decimals to base currency", async function () {
        const tokenAmount = ethers.parseUnits("15", 6); // 15 tokens (6 decimals)
        const expectedBaseAmount = ethers.parseEther("150"); // $150 at $10 each

        const baseAmount = await dloopMock.convertFromTokenAmountToBaseCurrency(
          tokenAmount,
          await otherToken.getAddress(),
        );
        expect(baseAmount).to.equal(expectedBaseAmount);
      });

      it("Should handle zero token amount conversion", async function () {
        const baseAmount = await dloopMock.convertFromTokenAmountToBaseCurrency(
          0,
          await collateralToken.getAddress(),
        );
        expect(baseAmount).to.equal(0);
      });
    });

    describe("Round-trip Conversion Tests", function () {
      it("Should maintain precision in round-trip conversions", async function () {
        const originalAmount = ethers.parseEther("1500"); // Use amount divisible by price

        // Convert base -> token -> base
        const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
          originalAmount,
          await collateralToken.getAddress(),
        );
        const backToBaseAmount =
          await dloopMock.convertFromTokenAmountToBaseCurrency(
            tokenAmount,
            await collateralToken.getAddress(),
          );

        expect(backToBaseAmount).to.equal(originalAmount);
      });

      it("Should handle precision for tokens with different decimals", async function () {
        const originalAmount = ethers.parseEther("100");

        // Convert base -> token (6 decimals) -> base
        const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
          originalAmount,
          await otherToken.getAddress(),
        );
        const backToBaseAmount =
          await dloopMock.convertFromTokenAmountToBaseCurrency(
            tokenAmount,
            await otherToken.getAddress(),
          );

        expect(backToBaseAmount).to.equal(originalAmount);
      });
    });
  });

  describe("IV. Oracle Integration with Vault Operations", function () {
    beforeEach(async function () {
      // Set up prices for integration tests
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1200"), // $1200
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("0.8"), // $0.8
      );
    });

    it("Should use oracle prices for totalAssets calculation", async function () {
      const user = accounts[1];
      const depositAmount = ethers.parseEther("100");

      // Make initial deposit
      await dloopMock.connect(user).deposit(depositAmount, user.address);

      // Total assets should reflect the collateral value
      const totalAssets = await dloopMock.totalAssets();
      expect(totalAssets).to.be.gt(0);

      // Verify it uses oracle price for calculation
      const [collateralBase] =
        await dloopMock.getTotalCollateralAndDebtOfUserInBase(
          await dloopMock.getAddress(),
        );
      const expectedTotalAssets =
        await dloopMock.convertFromBaseCurrencyToToken(
          collateralBase,
          await collateralToken.getAddress(),
        );
      expect(totalAssets).to.equal(expectedTotalAssets);
    });

    it("Should use oracle prices for leverage calculation", async function () {
      const user = accounts[1];
      const depositAmount = ethers.parseEther("100");

      // Make deposit to establish position
      await dloopMock.connect(user).deposit(depositAmount, user.address);

      // Verify leverage calculation uses oracle prices
      const leverage = await dloopMock.getCurrentLeverageBps();
      expect(leverage).to.be.gt(0);
      expect(leverage).to.be.lte(400_0000); // Should be reasonable leverage
    });

    it("Should reflect price changes in leverage calculation", async function () {
      const user = accounts[1];
      const depositAmount = ethers.parseEther("100");

      // Make initial deposit
      await dloopMock.connect(user).deposit(depositAmount, user.address);
      const initialLeverage = await dloopMock.getCurrentLeverageBps();

      // Change collateral price (decrease)
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1000"), // Decreased from $1200 to $1000
      );

      // Leverage should increase due to lower collateral value
      const newLeverage = await dloopMock.getCurrentLeverageBps();
      expect(newLeverage).to.be.gt(initialLeverage);
    });

    it("Should use oracle prices for deposit amount calculations", async function () {
      const depositAmount = ethers.parseEther("100");

      // Calculate expected borrow amount using current prices
      const expectedBorrowAmount =
        await dloopMock.getBorrowAmountThatKeepCurrentLeverage(
          await collateralToken.getAddress(),
          await debtToken.getAddress(),
          depositAmount,
          300_0000, // 300% target leverage
        );

      // Verify the calculation uses oracle prices
      expect(expectedBorrowAmount).to.be.gt(0);

      // The borrow amount should reflect the price ratio
      const collateralPrice = await dloopMock.getMockPrice(
        await collateralToken.getAddress(),
      );
      const debtPrice = await dloopMock.getMockPrice(
        await debtToken.getAddress(),
      );

      // Rough calculation check (accounting for leverage formula)
      const collateralValueInBase =
        (depositAmount * collateralPrice) / ethers.parseEther("1");
      const expectedDebtInBase =
        (collateralValueInBase * BigInt(200_0000)) / BigInt(300_0000); // 200% of collateral value for 3x leverage
      const expectedBorrowAmountCheck =
        (expectedDebtInBase * ethers.parseEther("1")) / debtPrice;

      expect(expectedBorrowAmount).to.be.closeTo(
        expectedBorrowAmountCheck,
        ethers.parseEther("1"),
      );
    });
  });

  describe("V. Oracle Error Handling", function () {
    it("Should revert when accessing price for unset asset", async function () {
      await expect(
        dloopMock.getAssetPriceFromOracle(await otherToken.getAddress()),
      ).to.be.revertedWithCustomError(dloopMock, "MockPriceNotSet");
    });

    it("Should revert when price is zero", async function () {
      await dloopMock.setMockPrice(await collateralToken.getAddress(), 0);

      await expect(
        dloopMock.getAssetPriceFromOracle(await collateralToken.getAddress()),
      ).to.be.revertedWithCustomError(dloopMock, "MockPriceNotSet");
    });

    it("Should handle conversion with zero price gracefully in mock", async function () {
      // This tests the mock's internal price requirement
      await dloopMock.setMockPrice(await collateralToken.getAddress(), 0);

      await expect(
        dloopMock.convertFromBaseCurrencyToToken(
          ethers.parseEther("100"),
          await collateralToken.getAddress(),
        ),
      ).to.be.revertedWithCustomError(dloopMock, "MockPriceNotSet");
    });

    it("Should handle price updates during operations", async function () {
      const user = accounts[1];

      // Set initial prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1200"),
      );
      await dloopMock.setMockPrice(
        await debtToken.getAddress(),
        ethers.parseEther("0.8"),
      );

      // Make initial deposit
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("100"), user.address);

      // Update prices to maintain balanced state
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        ethers.parseEther("1200"), // Keep same price to avoid imbalance
      );

      // Operations should work with updated prices
      const newLeverage = await dloopMock.getCurrentLeverageBps();
      expect(newLeverage).to.be.gt(0);
      expect(await dloopMock.isTooImbalanced()).to.be.false;

      // Should be able to make another deposit with balanced prices
      await dloopMock
        .connect(user)
        .deposit(ethers.parseEther("25"), user.address);
    });
  });

  describe("VI. Oracle Price Edge Cases", function () {
    it("Should handle very large prices", async function () {
      const veryLargePrice = ethers.parseEther("1000000"); // $1M

      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        veryLargePrice,
      );

      const retrievedPrice = await dloopMock.getMockPrice(
        await collateralToken.getAddress(),
      );
      expect(retrievedPrice).to.equal(veryLargePrice);

      // Should work in conversions
      const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
        ethers.parseEther("1000000"),
        await collateralToken.getAddress(),
      );
      expect(tokenAmount).to.equal(ethers.parseEther("1"));
    });

    it("Should handle very small prices", async function () {
      const verySmallPrice = ethers.parseUnits("1", 10); // Very small price

      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        verySmallPrice,
      );

      const retrievedPrice = await dloopMock.getMockPrice(
        await collateralToken.getAddress(),
      );
      expect(retrievedPrice).to.equal(verySmallPrice);

      // Should work in conversions
      const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
        ethers.parseEther("1"),
        await collateralToken.getAddress(),
      );
      expect(tokenAmount).to.be.gt(0);
    });

    it("Should handle price precision correctly", async function () {
      // Test with precise price that has many decimal places
      const precisePrice = ethers.parseUnits("1234.56789", 18);

      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        precisePrice,
      );

      const retrievedPrice = await dloopMock.getMockPrice(
        await collateralToken.getAddress(),
      );
      expect(retrievedPrice).to.equal(precisePrice);

      // Test conversion maintains precision
      const baseAmount = ethers.parseEther("12345.6789");
      const tokenAmount = await dloopMock.convertFromBaseCurrencyToToken(
        baseAmount,
        await collateralToken.getAddress(),
      );
      const backToBase = await dloopMock.convertFromTokenAmountToBaseCurrency(
        tokenAmount,
        await collateralToken.getAddress(),
      );

      expect(backToBase).to.equal(baseAmount);
    });

    it("Should handle multiple price updates for same asset", async function () {
      const prices = [
        ethers.parseEther("1000"),
        ethers.parseEther("1500"),
        ethers.parseEther("800"),
        ethers.parseEther("2000"),
      ];

      for (const price of prices) {
        await dloopMock.setMockPrice(await collateralToken.getAddress(), price);
        const retrievedPrice = await dloopMock.getMockPrice(
          await collateralToken.getAddress(),
        );
        expect(retrievedPrice).to.equal(price);
      }
    });

    it("Should handle simultaneous price updates for multiple assets", async function () {
      const collateralPrice = ethers.parseEther("1500");
      const debtPrice = ethers.parseEther("0.99");
      const otherPrice = ethers.parseEther("100");

      // Set all prices
      await dloopMock.setMockPrice(
        await collateralToken.getAddress(),
        collateralPrice,
      );
      await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);
      await dloopMock.setMockPrice(await otherToken.getAddress(), otherPrice);

      // Verify all prices are set correctly
      expect(
        await dloopMock.getMockPrice(await collateralToken.getAddress()),
      ).to.equal(collateralPrice);
      expect(
        await dloopMock.getMockPrice(await debtToken.getAddress()),
      ).to.equal(debtPrice);
      expect(
        await dloopMock.getMockPrice(await otherToken.getAddress()),
      ).to.equal(otherPrice);

      // Verify oracle function works for all
      expect(
        await dloopMock.getAssetPriceFromOracle(
          await collateralToken.getAddress(),
        ),
      ).to.equal(collateralPrice);
      expect(
        await dloopMock.getAssetPriceFromOracle(await debtToken.getAddress()),
      ).to.equal(debtPrice);
      expect(
        await dloopMock.getAssetPriceFromOracle(await otherToken.getAddress()),
      ).to.equal(otherPrice);
    });
  });
});
