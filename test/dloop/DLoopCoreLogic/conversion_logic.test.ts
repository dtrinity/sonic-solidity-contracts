import { expect } from "chai";
import { ethers } from "hardhat";

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
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.convertFromBaseCurrencyToTokenPublic(
          tc.amountInBase,
          Number(tc.dec),
          tc.price,
        );
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
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const res = await harness.convertFromTokenAmountToBaseCurrencyPublic(
          tc.amountInToken,
          Number(tc.dec),
          tc.price,
        );
        expect(res).to.equal(tc.expected);
      });
    }
  });
});
