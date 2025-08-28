import { expect } from "chai";
import { ethers } from "hardhat";

import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";

describe("DLoopCoreLogic - Conversion Logic", () => {
  /**
   * Deploys the DLoopCoreLogic harness contract used for calling library wrappers in tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("convertFromBaseCurrencyToToken", () => {
    const cases = [
      {
        name: "1e18 base to 18d token at price 1e18",
        amountInBase: 10n ** 18n,
        dec: 18n,
        price: 10n ** 18n,
        expected: 10n ** 18n,
      },
      {
        name: "2e18 base to 18d token at price 2e18",
        amountInBase: 2n * 10n ** 18n,
        dec: 18n,
        price: 2n * 10n ** 18n,
        expected: 10n ** 18n,
      },
      {
        name: "1e6 base to 6d token at price 1e6",
        amountInBase: 10n ** 6n,
        dec: 6n,
        price: 10n ** 6n,
        expected: 10n ** 6n,
      },
      {
        name: "rounding down",
        amountInBase: 100n,
        dec: 18n,
        price: 3n,
        expected: (100n * 10n ** 18n) / 3n,
      },
      {
        name: "tiny amount",
        amountInBase: 1n,
        dec: 18n,
        price: 10n ** 18n,
        expected: 1n,
      },
      {
        name: "huge amount",
        amountInBase: 10n ** 30n,
        dec: 18n,
        price: 10n ** 18n,
        expected: 10n ** 30n,
      },
      {
        name: "price > 1",
        amountInBase: 10n ** 18n,
        dec: 18n,
        price: 2n * 10n ** 18n,
        expected: 5n * 10n ** 17n,
      },
      {
        name: "price < 1",
        amountInBase: 10n ** 18n,
        dec: 18n,
        price: 5n * 10n ** 17n,
        expected: 2n * 10n ** 18n,
      },
      {
        name: "decimals 8",
        amountInBase: 10n ** 8n,
        dec: 8n,
        price: 10n ** 8n,
        expected: 10n ** 8n,
      },
      {
        name: "decimals 0",
        amountInBase: 1000n,
        dec: 0n,
        price: 10n,
        expected: 100n,
      },
      // Additional test cases from mock tests for better coverage
      {
        name: "Should convert with 6 decimal token",
        amountInBase: ethers.parseUnits("100", 8), // $100
        dec: 6n,
        price: ethers.parseUnits("1", 8), // $1 per token
        expected: ethers.parseUnits("100", 6), // 100 tokens
      },
      {
        name: "Should convert with 8 decimal token",
        amountInBase: ethers.parseUnits("500", 8), // $500
        dec: 8n,
        price: ethers.parseUnits("5", 8), // $5 per token
        expected: ethers.parseUnits("100", 8), // 100 tokens
      },
      {
        name: "Should handle fractional result",
        amountInBase: ethers.parseUnits("150", 8), // $150
        dec: 18n,
        price: ethers.parseUnits("3", 8), // $3 per token
        expected: ethers.parseEther("50"), // 150/3 = 50 tokens
      },
      {
        name: "Should handle high price token",
        amountInBase: ethers.parseUnits("10000", 8), // $10,000
        dec: 18n,
        price: ethers.parseUnits("5000", 8), // $5,000 per token
        expected: ethers.parseEther("2"), // 10000/5000 = 2 tokens
      },
      {
        name: "Should handle low price token",
        amountInBase: ethers.parseUnits("1", 8), // $1
        dec: 18n,
        price: ethers.parseUnits("0.01", 8), // $0.01 per token
        expected: ethers.parseEther("100"), // 1/0.01 = 100 tokens
      },
      {
        name: "Should handle very small amounts",
        amountInBase: 1n, // Smallest unit
        dec: 18n,
        price: ethers.parseUnits("1", 8),
        expected: ethers.parseUnits("1", 10), // 1 * 10^18 / 10^8 = 10^10
      },
      {
        name: "Should handle precision edge case",
        amountInBase: ethers.parseUnits("333.33333333", 8),
        dec: 18n,
        price: ethers.parseUnits("111.11111111", 8),
        expected: ethers.parseEther("3"), // Close to 3
      },
      {
        name: "Should handle rounding down",
        amountInBase: ethers.parseUnits("999", 8), // $999
        dec: 18n,
        price: ethers.parseUnits("1000", 8), // $1000 per token
        expected: ethers.parseUnits("999", 15), // 999 * 10^18 / 10^11 = 999 * 10^7
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.convertFromBaseCurrencyToTokenPublic(tc.amountInBase, Number(tc.dec), tc.price);
        expect(res).to.equal(tc.expected);
      });
    }
  });

  describe("convertFromTokenAmountToBaseCurrency", () => {
    const cases = [
      {
        name: "1e18 token to base at price 1e18",
        amountInToken: 10n ** 18n,
        dec: 18n,
        price: 10n ** 18n,
        expected: 10n ** 18n,
      },
      {
        name: "2e18 token to base at price 2e18",
        amountInToken: 2n * 10n ** 18n,
        dec: 18n,
        price: 2n * 10n ** 18n,
        expected: 4n * 10n ** 18n,
      },
      {
        name: "1e6 token to base at price 1e6",
        amountInToken: 10n ** 6n,
        dec: 6n,
        price: 10n ** 6n,
        expected: 10n ** 6n,
      },
      {
        name: "rounding down",
        amountInToken: 100n,
        dec: 18n,
        price: 3n,
        expected: (100n * 3n) / 10n ** 18n,
      },
      {
        name: "tiny amount",
        amountInToken: 1n,
        dec: 18n,
        price: 10n ** 18n,
        expected: 1n,
      },
      {
        name: "huge amount",
        amountInToken: 10n ** 30n,
        dec: 18n,
        price: 10n ** 18n,
        expected: (10n ** 30n * 10n ** 18n) / 10n ** 18n,
      },
      {
        name: "price > 1",
        amountInToken: 10n ** 18n,
        dec: 18n,
        price: 2n * 10n ** 18n,
        expected: 2n * 10n ** 18n,
      },
      {
        name: "price < 1",
        amountInToken: 10n ** 18n,
        dec: 18n,
        price: 5n * 10n ** 17n,
        expected: 5n * 10n ** 17n,
      },
      {
        name: "decimals 8",
        amountInToken: 10n ** 8n,
        dec: 8n,
        price: 10n ** 8n,
        expected: 10n ** 8n,
      },
      {
        name: "decimals 0",
        amountInToken: 1000n,
        dec: 0n,
        price: 10n,
        expected: 10000n,
      },
      // Additional test cases from mock tests for better coverage
      {
        name: "Should convert with 6 decimal token",
        amountInToken: ethers.parseUnits("100", 6), // 100 tokens
        dec: 6n,
        price: ethers.parseUnits("1", 8), // $1 per token
        expected: ethers.parseUnits("100", 8), // $100
      },
      {
        name: "Should convert with 8 decimal token",
        amountInToken: ethers.parseUnits("100", 8), // 100 tokens
        dec: 8n,
        price: ethers.parseUnits("5", 8), // $5 per token
        expected: ethers.parseUnits("500", 8), // $500
      },
      {
        name: "Should handle fractional tokens",
        amountInToken: ethers.parseEther("50.5"), // 50.5 tokens
        dec: 18n,
        price: ethers.parseUnits("3", 8), // $3 per token
        expected: ethers.parseUnits("151.5", 8), // 50.5 * 3 = $151.5
      },
      {
        name: "Should handle high price token",
        amountInToken: ethers.parseEther("2"), // 2 tokens
        dec: 18n,
        price: ethers.parseUnits("5000", 8), // $5,000 per token
        expected: ethers.parseUnits("10000", 8), // $10,000
      },
      {
        name: "Should handle low price token",
        amountInToken: ethers.parseEther("100"), // 100 tokens
        dec: 18n,
        price: ethers.parseUnits("0.01", 8), // $0.01 per token
        expected: ethers.parseUnits("1", 8), // $1
      },
      {
        name: "Should handle reasonable token amounts",
        amountInToken: ethers.parseEther("1000"), // 1000 tokens
        dec: 18n,
        price: ethers.parseUnits("1", 8), // $1 per token
        expected: ethers.parseUnits("1000", 8), // $1000
      },
      {
        name: "Should handle precision calculations",
        amountInToken: ethers.parseEther("3.333333333333333333"),
        dec: 18n,
        price: ethers.parseUnits("111.11111111", 8),
        expected: ethers.parseUnits("370.37037036", 8), // Adjusted for precision loss
      },
      {
        name: "Should handle large token amounts",
        amountInToken: ethers.parseEther("1000000"), // 1M tokens
        dec: 18n,
        price: ethers.parseUnits("1", 8), // $1 per token
        expected: ethers.parseUnits("1000000", 8), // $1M
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.convertFromTokenAmountToBaseCurrencyPublic(tc.amountInToken, Number(tc.dec), tc.price);
        expect(res).to.equal(tc.expected);
      });
    }
  });
});
