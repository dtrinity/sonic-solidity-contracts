import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import {
  deployDLoopMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixture";

// NOTE: Redundant with CoreLogic tests; keeping file but skipping suite to avoid duplication
describe.skip("DLoopCoreMock Calculation Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let _otherToken: TestMintableERC20;
  let _accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    _accounts = fixture.accounts;

    // Deploy an additional token for testing calculation functionality
    const TestMintableERC20Factory =
      await ethers.getContractFactory("TestMintableERC20");
    _otherToken = await TestMintableERC20Factory.deploy(
      "Other Token",
      "OTHER",
      8, // Different decimals for testing
    );
  });

  describe("I. Basic Calculation Functions", function () {
    describe("getTargetLeveragedAssets", function () {
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
        it(testCase.name, async function () {
          const result = await dloopMock.getTargetLeveragedAssets(
            testCase.assets,
          );
          expect(result).to.equal(testCase.expectedLeveraged);
        });
      }
    });

    describe("getCurrentLeverageBps", function () {
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
          expectedLeverage: BigInt(TARGET_LEVERAGE_BPS), // 300%
        },
        {
          name: "Should calculate 500% leverage",
          collateral: ethers.parseEther("500"), // $500
          debt: ethers.parseEther("400"), // $400
          expectedLeverage: BigInt(500 * ONE_PERCENT_BPS), // 500%
        },
        {
          name: "Should handle high leverage (1000%)",
          collateral: ethers.parseEther("1000"), // $1000
          debt: ethers.parseEther("900"), // $900
          expectedLeverage: BigInt(1000 * ONE_PERCENT_BPS), // 1000%
        },
        {
          name: "Should handle very high leverage (10000%)",
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
        it(testCase.name, async function () {
          // Set up mock collateral and debt
          const collateralPrice = ethers.parseEther("1"); // $1 per token
          const debtPrice = ethers.parseEther("1"); // $1 per token

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            collateralPrice,
          );
          await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

          await dloopMock.setMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            testCase.collateral,
          );
          await dloopMock.setMockDebt(
            await dloopMock.getAddress(),
            await debtToken.getAddress(),
            testCase.debt,
          );

          const result = await dloopMock.getCurrentLeverageBps();

          if (testCase.expectedLeverage > 0) {
            expect(result).to.be.closeTo(
              testCase.expectedLeverage,
              BigInt(ONE_PERCENT_BPS),
            );
          } else {
            expect(result).to.equal(testCase.expectedLeverage);
          }
        });
      }
    });

    describe("getCurrentLeveragedAssets", function () {
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
        it(c.name, async function () {
          // Set price only if collateral > 0 to avoid unnecessary mocks
          if (c.collateral > 0n || c.debt > 0n) {
            const price = c.price ?? ethers.parseEther("1");
            await dloopMock.setMockPrice(
              await collateralToken.getAddress(),
              price,
            );
            await dloopMock.setMockPrice(await debtToken.getAddress(), price);
          }

          await dloopMock.setMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            c.collateral,
          );
          await dloopMock.setMockDebt(
            await dloopMock.getAddress(),
            await debtToken.getAddress(),
            c.debt,
          );

          const result = await dloopMock.getCurrentLeveragedAssets(
            c.inputAssets,
          );
          expect(result).to.equal(c.expectedLeveraged);
        });
      }
    });

    describe("getUnleveragedAssetsWithTargetLeverage", function () {
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
        it(tc.name, async function () {
          const result = await dloopMock.getUnleveragedAssetsWithTargetLeverage(
            tc.leveraged,
          );
          expect(result).to.equal(tc.expected);
        });
      }
    });

    describe("getUnleveragedAssetsWithCurrentLeverage", function () {
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
        it(c.name, async function () {
          const price = ethers.parseEther("1");

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            price,
          );
          await dloopMock.setMockPrice(await debtToken.getAddress(), price);

          await dloopMock.setMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            c.collateral,
          );
          await dloopMock.setMockDebt(
            await dloopMock.getAddress(),
            await debtToken.getAddress(),
            c.debt,
          );

          const result =
            await dloopMock.getUnleveragedAssetsWithCurrentLeverage(
              c.leveragedInput,
            );
          expect(result).to.equal(c.expectedUnleveraged);
        });
      }
    });
  });

  describe("II. Price Conversion Functions", function () {
    describe("convertFromBaseCurrencyToToken", function () {
      const testCases: {
        name: string;
        amountInBase: bigint;
        tokenPrice: bigint;
        tokenDecimals: number;
        expectedAmount: bigint;
      }[] = [
        {
          name: "Should convert base currency to token with 18 decimals",
          amountInBase: ethers.parseUnits("1000", 8), // $1000 in 8 decimal base
          tokenPrice: ethers.parseUnits("2", 8), // $2 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseEther("500"), // 1000/2 = 500 tokens
        },
        {
          name: "Should convert with 6 decimal token",
          amountInBase: ethers.parseUnits("100", 8), // $100
          tokenPrice: ethers.parseUnits("1", 8), // $1 per token
          tokenDecimals: 6,
          expectedAmount: ethers.parseUnits("100", 6), // 100 tokens
        },
        {
          name: "Should convert with 8 decimal token",
          amountInBase: ethers.parseUnits("500", 8), // $500
          tokenPrice: ethers.parseUnits("5", 8), // $5 per token
          tokenDecimals: 8,
          expectedAmount: ethers.parseUnits("100", 8), // 100 tokens
        },
        {
          name: "Should handle zero amount",
          amountInBase: 0n,
          tokenPrice: ethers.parseUnits("1", 8),
          tokenDecimals: 18,
          expectedAmount: 0n,
        },
        {
          name: "Should handle fractional result",
          amountInBase: ethers.parseUnits("150", 8), // $150
          tokenPrice: ethers.parseUnits("3", 8), // $3 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseEther("50"), // 150/3 = 50 tokens
        },
        {
          name: "Should handle high price token",
          amountInBase: ethers.parseUnits("10000", 8), // $10,000
          tokenPrice: ethers.parseUnits("5000", 8), // $5,000 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseEther("2"), // 10000/5000 = 2 tokens
        },
        {
          name: "Should handle low price token",
          amountInBase: ethers.parseUnits("1", 8), // $1
          tokenPrice: ethers.parseUnits("0.01", 8), // $0.01 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseEther("100"), // 1/0.01 = 100 tokens
        },
        {
          name: "Should handle very small amounts",
          amountInBase: 1n, // Smallest unit
          tokenPrice: ethers.parseUnits("1", 8),
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("1", 10), // 1 * 10^18 / 10^8 = 10^10
        },
        {
          name: "Should handle precision edge case",
          amountInBase: ethers.parseUnits("333.33333333", 8),
          tokenPrice: ethers.parseUnits("111.11111111", 8),
          tokenDecimals: 18,
          expectedAmount: ethers.parseEther("3"), // Close to 3
        },
        {
          name: "Should handle rounding down",
          amountInBase: ethers.parseUnits("999", 8), // $999
          tokenPrice: ethers.parseUnits("1000", 8), // $1000 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("999", 15), // 999 * 10^18 / 10^11 = 999 * 10^7
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Deploy a token with specific decimals for this test
          const TestMintableERC20Factory =
            await ethers.getContractFactory("TestMintableERC20");
          const testToken = await TestMintableERC20Factory.deploy(
            "Test Token",
            "TEST",
            testCase.tokenDecimals,
          );

          await dloopMock.setMockPrice(
            await testToken.getAddress(),
            testCase.tokenPrice,
          );

          const result = await dloopMock.convertFromBaseCurrencyToToken(
            testCase.amountInBase,
            await testToken.getAddress(),
          );

          expect(result).to.equal(testCase.expectedAmount);
        });
      }
    });

    describe("convertFromTokenAmountToBaseCurrency", function () {
      const testCases: {
        name: string;
        amountInToken: bigint;
        tokenPrice: bigint;
        tokenDecimals: number;
        expectedAmount: bigint;
      }[] = [
        {
          name: "Should convert token amount to base currency with 18 decimals",
          amountInToken: ethers.parseEther("500"), // 500 tokens
          tokenPrice: ethers.parseUnits("2", 8), // $2 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("1000", 8), // 500 * 2 = $1000
        },
        {
          name: "Should convert with 6 decimal token",
          amountInToken: ethers.parseUnits("100", 6), // 100 tokens
          tokenPrice: ethers.parseUnits("1", 8), // $1 per token
          tokenDecimals: 6,
          expectedAmount: ethers.parseUnits("100", 8), // $100
        },
        {
          name: "Should convert with 8 decimal token",
          amountInToken: ethers.parseUnits("100", 8), // 100 tokens
          tokenPrice: ethers.parseUnits("5", 8), // $5 per token
          tokenDecimals: 8,
          expectedAmount: ethers.parseUnits("500", 8), // $500
        },
        {
          name: "Should handle zero amount",
          amountInToken: 0n,
          tokenPrice: ethers.parseUnits("1", 8),
          tokenDecimals: 18,
          expectedAmount: 0n,
        },
        {
          name: "Should handle fractional tokens",
          amountInToken: ethers.parseEther("50.5"), // 50.5 tokens
          tokenPrice: ethers.parseUnits("3", 8), // $3 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("151.5", 8), // 50.5 * 3 = $151.5
        },
        {
          name: "Should handle high price token",
          amountInToken: ethers.parseEther("2"), // 2 tokens
          tokenPrice: ethers.parseUnits("5000", 8), // $5,000 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("10000", 8), // $10,000
        },
        {
          name: "Should handle low price token",
          amountInToken: ethers.parseEther("100"), // 100 tokens
          tokenPrice: ethers.parseUnits("0.01", 8), // $0.01 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("1", 8), // $1
        },
        {
          name: "Should handle reasonable token amounts",
          amountInToken: ethers.parseEther("1000"), // 1000 tokens
          tokenPrice: ethers.parseUnits("1", 8), // $1 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("1000", 8), // $1000
        },
        {
          name: "Should handle precision calculations",
          amountInToken: ethers.parseEther("3.333333333333333333"),
          tokenPrice: ethers.parseUnits("111.11111111", 8),
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("370.37037036", 8), // Adjusted for precision loss
        },
        {
          name: "Should handle large token amounts",
          amountInToken: ethers.parseEther("1000000"), // 1M tokens
          tokenPrice: ethers.parseUnits("1", 8), // $1 per token
          tokenDecimals: 18,
          expectedAmount: ethers.parseUnits("1000000", 8), // $1M
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Deploy a token with specific decimals for this test
          const TestMintableERC20Factory =
            await ethers.getContractFactory("TestMintableERC20");
          const testToken = await TestMintableERC20Factory.deploy(
            "Test Token",
            "TEST",
            testCase.tokenDecimals,
          );

          await dloopMock.setMockPrice(
            await testToken.getAddress(),
            testCase.tokenPrice,
          );

          const result = await dloopMock.convertFromTokenAmountToBaseCurrency(
            testCase.amountInToken,
            await testToken.getAddress(),
          );

          expect(result).to.equal(testCase.expectedAmount);
        });
      }
    });
  });
});
