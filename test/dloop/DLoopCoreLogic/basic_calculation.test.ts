import { expect } from "chai";
import { ethers } from "hardhat";

import type { DLoopCoreLogicHarness } from "../../../typechain-types/contracts/testing/dloop/DLoopCoreLogicHarness";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";

describe("DLoopCoreLogic - Basic Calculation Functions", () => {
  /**
   * Deploys the DLoopCoreLogic harness for basic calculation tests.
   */
  async function deployHarness(): Promise<{ harness: DLoopCoreLogicHarness }> {
    const Factory = await ethers.getContractFactory("DLoopCoreLogicHarness");
    const harness = (await Factory.deploy()) as DLoopCoreLogicHarness;
    return { harness };
  }

  describe("getTargetLeveragedAssets", () => {
    const testCases: {
      name: string;
      assets: bigint;
      expectedLeveraged: bigint;
    }[] = [
      {
        name: "Should calculate leveraged assets with small amount",
        assets: ethers.parseEther("1"),
        expectedLeveraged: ethers.parseEther("3"), // 3x leverage
      },
      {
        name: "Should calculate leveraged assets with medium amount",
        assets: ethers.parseEther("100"),
        expectedLeveraged: ethers.parseEther("300"),
      },
      {
        name: "Should calculate leveraged assets with large amount",
        assets: ethers.parseEther("10000"),
        expectedLeveraged: ethers.parseEther("30000"),
      },
      {
        name: "Should handle zero assets",
        assets: 0n,
        expectedLeveraged: 0n,
      },
      {
        name: "Should handle 1 wei",
        assets: 1n,
        expectedLeveraged: 3n, // 1 * 30000 / 10000 = 3
      },
      {
        name: "Should handle large amount without overflow",
        assets: ethers.parseEther("1000000"), // Large but reasonable amount
        expectedLeveraged: ethers.parseEther("3000000"), // 3x leverage
      },
      {
        name: "Should calculate with fractional assets",
        assets: ethers.parseEther("0.1"),
        expectedLeveraged: ethers.parseEther("0.3"),
      },
      {
        name: "Should calculate with very small fractional assets",
        assets: ethers.parseEther("0.001"),
        expectedLeveraged: ethers.parseEther("0.003"),
      },
      {
        name: "Should handle exact division",
        assets: ethers.parseEther("33.333333333333333333"), // Should result in exactly 100 ETH
        expectedLeveraged: ethers.parseEther("99.999999999999999999"), // Close to 100 ETH
      },
      {
        name: "Should handle rounding down",
        assets: BigInt("333"), // Small amount that tests rounding
        expectedLeveraged: BigInt("999"), // 333 * 30000 / 10000 = 999
      },
    ];

    for (const testCase of testCases) {
      it(testCase.name, async () => {
        const { harness } = await deployHarness();
        const result = await harness.getTargetLeveragedAssetsPublic(testCase.assets);
        expect(result).to.equal(testCase.expectedLeveraged);
      });
    }
  });

  describe("getCurrentLeverageBps", () => {
    const testCases: {
      name: string;
      collateral: bigint;
      debt: bigint;
      expectedLeverage: bigint;
    }[] = [
      {
        name: "Should return 0 for no collateral",
        collateral: 0n,
        debt: 0n,
        expectedLeverage: 0n,
      },
      {
        name: "Should calculate minimal leverage with tiny debt",
        collateral: ethers.parseEther("100"),
        debt: ethers.parseEther("0.1"), // Tiny debt to avoid 100% exactly
        expectedLeverage: BigInt(100.1 * ONE_PERCENT_BPS), // Just above 100%
      },
      {
        name: "Should calculate 200% leverage",
        collateral: ethers.parseEther("200"), // $200
        debt: ethers.parseEther("100"), // $100
        expectedLeverage: BigInt(200 * ONE_PERCENT_BPS), // 200%
      },
      {
        name: "Should calculate 300% leverage (target)",
        collateral: ethers.parseEther("300"), // $300
        debt: ethers.parseEther("200"), // $200
        expectedLeverage: BigInt(300 * ONE_PERCENT_BPS), // 300%
      },
      {
        name: "Should calculate 500% leverage",
        collateral: ethers.parseEther("500"), // $500
        debt: ethers.parseEther("400"), // $400
        expectedLeverage: BigInt(500 * ONE_PERCENT_BPS), // 500%
      },
      {
        name: "Should calculate 1000% leverage",
        collateral: ethers.parseEther("1000"), // $1000
        debt: ethers.parseEther("900"), // $900
        expectedLeverage: BigInt(1000 * ONE_PERCENT_BPS), // 1000%
      },
      {
        name: "Should calculate 10000% leverage",
        collateral: ethers.parseEther("10000"), // $10000
        debt: ethers.parseEther("9900"), // $9900
        expectedLeverage: BigInt(10000 * ONE_PERCENT_BPS), // 10000%
      },
      {
        name: "Should handle fractional leverage",
        collateral: ethers.parseEther("150"), // $150
        debt: ethers.parseEther("100"), // $100
        expectedLeverage: BigInt(300 * ONE_PERCENT_BPS), // 300% leverage
      },
      {
        name: "Should handle large amounts",
        collateral: ethers.parseEther("1000000"), // $1M
        debt: ethers.parseEther("666666.666666666666666666"), // About $666,667
        expectedLeverage: BigInt(300 * ONE_PERCENT_BPS), // Close to 300%
      },
      {
        name: "Should handle very high leverage (near infinite)",
        collateral: ethers.parseEther("100"),
        debt: ethers.parseEther("99.99"), // Very close to collateral
        expectedLeverage: BigInt(1000000 * ONE_PERCENT_BPS), // Very high leverage
      },
    ];

    for (const testCase of testCases) {
      it(testCase.name, async () => {
        const { harness } = await deployHarness();
        const result = await harness.getCurrentLeverageBpsPublic(testCase.collateral, testCase.debt);

        if (testCase.expectedLeverage > 0n) {
          expect(result).to.be.closeTo(testCase.expectedLeverage, BigInt(ONE_PERCENT_BPS));
        } else {
          expect(result).to.equal(testCase.expectedLeverage);
        }
      });
    }
  });

  describe("getCurrentLeveragedAssets", () => {
    interface Case {
      name: string;
      collateral: bigint;
      debt: bigint;
      price?: bigint; // Defaults to 1 ether if not provided
      inputAssets: bigint;
      expectedLeveraged: bigint;
    }

    const cases: Case[] = [
      {
        name: "No collateral → zero leveraged result",
        collateral: 0n,
        debt: 0n,
        inputAssets: ethers.parseEther("10"),
        expectedLeveraged: 0n,
      },
      {
        name: "2x leverage calculation (200/100)",
        collateral: ethers.parseEther("200"),
        debt: ethers.parseEther("100"),
        inputAssets: ethers.parseEther("10"),
        expectedLeveraged: ethers.parseEther("20"),
      },
      {
        name: "3x leverage calculation (300/200)",
        collateral: ethers.parseEther("300"),
        debt: ethers.parseEther("200"),
        inputAssets: ethers.parseEther("5"),
        expectedLeveraged: ethers.parseEther("15"),
      },
      {
        name: "High leverage 10x (500/450)",
        collateral: ethers.parseEther("500"),
        debt: ethers.parseEther("450"),
        inputAssets: ethers.parseEther("3"),
        expectedLeveraged: ethers.parseEther("30"),
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const { harness } = await deployHarness();
        const result = await harness.getCurrentLeveragedAssetsPublic(c.inputAssets, c.collateral, c.debt);
        expect(result).to.equal(c.expectedLeveraged);
      });
    }
  });

  describe("getUnleveragedAssetsWithTargetLeverage", () => {
    const testCases = [
      {
        name: "Simple conversion",
        leveraged: ethers.parseEther("3"),
        expected: ethers.parseEther("1"), // 3 / 3x
      },
      {
        name: "Zero leveraged amount",
        leveraged: 0n,
        expected: 0n,
      },
      {
        name: "Large leveraged amount",
        leveraged: ethers.parseEther("3000"),
        expected: ethers.parseEther("1000"),
      },
    ];

    for (const tc of testCases) {
      it(tc.name, async () => {
        const { harness } = await deployHarness();
        const result = await harness.getUnleveragedAssetsWithTargetLeveragePublic(tc.leveraged);
        expect(result).to.equal(tc.expected);
      });
    }
  });

  describe("getUnleveragedAssetsWithCurrentLeverage", () => {
    interface ULCase {
      name: string;
      collateral: bigint;
      debt: bigint;
      leveragedInput: bigint;
      expectedUnleveraged: bigint;
    }

    const cases: ULCase[] = [
      {
        name: "2x leverage → halve assets",
        collateral: ethers.parseEther("200"),
        debt: ethers.parseEther("100"),
        leveragedInput: ethers.parseEther("20"),
        expectedUnleveraged: ethers.parseEther("10"),
      },
      {
        name: "3x leverage → one-third assets",
        collateral: ethers.parseEther("300"),
        debt: ethers.parseEther("200"),
        leveragedInput: ethers.parseEther("15"),
        expectedUnleveraged: ethers.parseEther("5"),
      },
      {
        name: "10x leverage → divide by ten",
        collateral: ethers.parseEther("500"),
        debt: ethers.parseEther("450"),
        leveragedInput: ethers.parseEther("30"),
        expectedUnleveraged: ethers.parseEther("3"),
      },
    ];

    for (const c of cases) {
      it(c.name, async () => {
        const { harness } = await deployHarness();
        const result = await harness.getUnleveragedAssetsWithCurrentLeveragePublic(c.leveragedInput, c.collateral, c.debt);
        expect(result).to.equal(c.expectedUnleveraged);
      });
    }
  });
});
