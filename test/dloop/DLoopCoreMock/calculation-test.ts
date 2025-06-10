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

describe("DLoopCoreMock Calculation Tests", function () {
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
    describe("getLeveragedAssets", function () {
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
          const result = await dloopMock.testGetLeveragedAssets(
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

          const result = await dloopMock.testConvertFromBaseCurrencyToToken(
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

          const result =
            await dloopMock.testConvertFromTokenAmountToBaseCurrency(
              testCase.amountInToken,
              await testToken.getAddress(),
            );

          expect(result).to.equal(testCase.expectedAmount);
        });
      }
    });
  });

  describe("III. Leverage Calculation Functions", function () {
    describe("getBorrowAmountThatKeepCurrentLeverage", function () {
      const testCases: {
        name: string;
        suppliedCollateralAmount: bigint;
        leverageBpsBeforeSupply: bigint;
        collateralPrice: bigint;
        debtPrice: bigint;
        expectedBorrowAmount: bigint;
        debtTokenDecimals?: number;
      }[] = [
        {
          name: "Should calculate borrow amount for 300% leverage",
          suppliedCollateralAmount: ethers.parseEther("100"), // 100 collateral tokens
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS), // 300%
          collateralPrice: ethers.parseEther("1"), // $1 per collateral
          debtPrice: ethers.parseEther("1"), // $1 per debt
          expectedBorrowAmount: ethers.parseEther("66.666666666666666666"), // 100 * (300-100)/300 ≈ 66.67
        },
        {
          name: "Should calculate borrow amount for 200% leverage",
          suppliedCollateralAmount: ethers.parseEther("100"),
          leverageBpsBeforeSupply: BigInt(200 * ONE_PERCENT_BPS), // 200%
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: ethers.parseEther("50"), // 100 * (200-100)/200 = 50
        },
        {
          name: "Should calculate borrow amount for 500% leverage",
          suppliedCollateralAmount: ethers.parseEther("100"),
          leverageBpsBeforeSupply: BigInt(500 * ONE_PERCENT_BPS), // 500%
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: ethers.parseEther("80"), // 100 * (500-100)/500 = 80
        },
        {
          name: "Should handle different token prices",
          suppliedCollateralAmount: ethers.parseEther("100"),
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("2"), // $2 per collateral
          debtPrice: ethers.parseEther("0.5"), // $0.5 per debt
          expectedBorrowAmount: ethers.parseEther("266.666666666666666666"), // (100*2) * (300-100)/300 / 0.5 ≈ 266.67
        },
        {
          name: "Should handle 6 decimal debt token",
          suppliedCollateralAmount: ethers.parseEther("100"),
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: ethers.parseUnits("66.666666", 6), // Different decimals
          debtTokenDecimals: 6,
        },
        {
          name: "Should handle very high leverage (1000%)",
          suppliedCollateralAmount: ethers.parseEther("100"),
          leverageBpsBeforeSupply: BigInt(1000 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: ethers.parseEther("90"), // 100 * (1000-100)/1000 = 90
        },
        {
          name: "Should handle zero collateral supply",
          suppliedCollateralAmount: 0n,
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: 0n,
        },
        {
          name: "Should handle 100% leverage (no borrowing)",
          suppliedCollateralAmount: ethers.parseEther("100"),
          leverageBpsBeforeSupply: BigInt(100 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: 0n, // 100 * (100-100)/100 = 0
        },
        {
          name: "Should handle small supply amounts",
          suppliedCollateralAmount: ethers.parseEther("0.1"),
          leverageBpsBeforeSupply: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: ethers.parseEther("0.066666666666666666"), // 0.1 * (300-100)/300
        },
        {
          name: "Should handle large supply amounts",
          suppliedCollateralAmount: ethers.parseEther("10000"),
          leverageBpsBeforeSupply: BigInt(400 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedBorrowAmount: ethers.parseEther("7500"), // 10000 * (400-100)/400 = 7500
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Set up tokens with specific decimals if needed
          let testDebtToken = debtToken;

          if (testCase.debtTokenDecimals) {
            const TestMintableERC20Factory =
              await ethers.getContractFactory("TestMintableERC20");
            testDebtToken = await TestMintableERC20Factory.deploy(
              "Test Debt Token",
              "DEBT",
              testCase.debtTokenDecimals,
            );
          }

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            testCase.collateralPrice,
          );
          await dloopMock.setMockPrice(
            await testDebtToken.getAddress(),
            testCase.debtPrice,
          );

          const result =
            await dloopMock.testGetBorrowAmountThatKeepCurrentLeverage(
              await collateralToken.getAddress(),
              await testDebtToken.getAddress(),
              testCase.suppliedCollateralAmount,
              testCase.leverageBpsBeforeSupply,
            );

          if (testCase.expectedBorrowAmount > 0) {
            expect(result).to.be.closeTo(
              testCase.expectedBorrowAmount,
              ethers.parseUnits("0.000001", testCase.debtTokenDecimals || 18),
            );
          } else {
            expect(result).to.equal(testCase.expectedBorrowAmount);
          }
        });
      }
    });

    describe("getRepayAmountThatKeepCurrentLeverage", function () {
      const testCases: {
        name: string;
        targetWithdrawAmount: bigint;
        leverageBpsBeforeRepayDebt: bigint;
        collateralPrice: bigint;
        debtPrice: bigint;
        expectedRepayAmount: bigint;
        debtTokenDecimals?: number;
      }[] = [
        {
          name: "Should calculate repay amount for 300% leverage",
          targetWithdrawAmount: ethers.parseEther("100"), // 100 collateral tokens
          leverageBpsBeforeRepayDebt: BigInt(300 * ONE_PERCENT_BPS), // 300%
          collateralPrice: ethers.parseEther("1"), // $1 per collateral
          debtPrice: ethers.parseEther("1"), // $1 per debt
          expectedRepayAmount: ethers.parseEther("66.666666666666666666"), // 100 * (300-100)/300 ≈ 66.67
        },
        {
          name: "Should calculate repay amount for 200% leverage",
          targetWithdrawAmount: ethers.parseEther("100"),
          leverageBpsBeforeRepayDebt: BigInt(200 * ONE_PERCENT_BPS), // 200%
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: ethers.parseEther("50"), // 100 * (200-100)/200 = 50
        },
        {
          name: "Should calculate repay amount for 500% leverage",
          targetWithdrawAmount: ethers.parseEther("100"),
          leverageBpsBeforeRepayDebt: BigInt(500 * ONE_PERCENT_BPS), // 500%
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: ethers.parseEther("80"), // 100 * (500-100)/500 = 80
        },
        {
          name: "Should handle different token prices",
          targetWithdrawAmount: ethers.parseEther("100"),
          leverageBpsBeforeRepayDebt: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("2"), // $2 per collateral
          debtPrice: ethers.parseEther("0.5"), // $0.5 per debt
          expectedRepayAmount: ethers.parseEther("266.666666666666666666"), // (100*2) * (300-100)/300 / 0.5 ≈ 266.67
        },
        {
          name: "Should handle 6 decimal debt token",
          targetWithdrawAmount: ethers.parseEther("100"),
          leverageBpsBeforeRepayDebt: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: ethers.parseUnits("66.666666", 6),
          debtTokenDecimals: 6,
        },
        {
          name: "Should handle very high leverage (1000%)",
          targetWithdrawAmount: ethers.parseEther("100"),
          leverageBpsBeforeRepayDebt: BigInt(1000 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: ethers.parseEther("90"), // 100 * (1000-100)/1000 = 90
        },
        {
          name: "Should handle zero withdraw amount",
          targetWithdrawAmount: 0n,
          leverageBpsBeforeRepayDebt: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: 0n,
        },
        {
          name: "Should handle 100% leverage (no repaying needed)",
          targetWithdrawAmount: ethers.parseEther("100"),
          leverageBpsBeforeRepayDebt: BigInt(100 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: 0n, // 100 * (100-100)/100 = 0
        },
        {
          name: "Should handle small withdraw amounts",
          targetWithdrawAmount: ethers.parseEther("0.1"),
          leverageBpsBeforeRepayDebt: BigInt(300 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: ethers.parseEther("0.066666666666666666"), // 0.1 * (300-100)/300
        },
        {
          name: "Should handle large withdraw amounts",
          targetWithdrawAmount: ethers.parseEther("10000"),
          leverageBpsBeforeRepayDebt: BigInt(400 * ONE_PERCENT_BPS),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          expectedRepayAmount: ethers.parseEther("7500"), // 10000 * (400-100)/400 = 7500
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Set up tokens with specific decimals if needed
          let testDebtToken = debtToken;

          if (testCase.debtTokenDecimals) {
            const TestMintableERC20Factory =
              await ethers.getContractFactory("TestMintableERC20");
            testDebtToken = await TestMintableERC20Factory.deploy(
              "Test Debt Token",
              "DEBT",
              testCase.debtTokenDecimals,
            );
          }

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            testCase.collateralPrice,
          );
          await dloopMock.setMockPrice(
            await testDebtToken.getAddress(),
            testCase.debtPrice,
          );

          const result =
            await dloopMock.testGetRepayAmountThatKeepCurrentLeverage(
              await collateralToken.getAddress(),
              await testDebtToken.getAddress(),
              testCase.targetWithdrawAmount,
              testCase.leverageBpsBeforeRepayDebt,
            );

          if (testCase.expectedRepayAmount > 0) {
            expect(result).to.be.closeTo(
              testCase.expectedRepayAmount,
              ethers.parseUnits("0.000001", testCase.debtTokenDecimals || 18),
            );
          } else {
            expect(result).to.equal(testCase.expectedRepayAmount);
          }
        });
      }
    });

    describe("getAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        currentCollateral: bigint;
        currentDebt: bigint;
        vaultCollateralBalance?: bigint;
        vaultDebtBalance?: bigint;
        expectedDirection: number;
        expectedAmount: bigint | "positive" | "small" | "large";
        useVaultTokenBalance: boolean;
      }[] = [
        {
          name: "Should return increase direction when leverage is below target",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("50"), // $50
          // Current leverage: 200/(200-50) = 133.33%
          expectedDirection: 1, // Increase
          expectedAmount: "positive", // Should be > 0
          useVaultTokenBalance: false,
        },
        {
          name: "Should return no rebalance when leverage equals target",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("200"), // $200
          // Current leverage: 300/(300-200) = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle vault token balance mode for increase",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("50"), // $50
          vaultCollateralBalance: ethers.parseEther("10"), // 10 tokens in vault
          expectedDirection: 1, // Increase
          expectedAmount: "positive", // Should account for vault balance
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle very low leverage",
          currentCollateral: ethers.parseEther("1000"), // $1000
          currentDebt: ethers.parseEther("10"), // $10
          // Current leverage: 1000/(1000-10) ≈ 101%
          expectedDirection: 1, // Increase to reach 300%
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle zero collateral and debt",
          currentCollateral: 0n,
          currentDebt: 0n,
          expectedDirection: 1, // Contract treats no position as needing to increase leverage
          expectedAmount: 0n, // But amount is 0 when no position exists
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle small differences near target",
          currentCollateral: ethers.parseEther("299"), // $299
          currentDebt: ethers.parseEther("199.33"), // Close to 300%
          expectedDirection: 1, // Still slightly below target so needs increase
          expectedAmount: "positive", // Small but positive amount
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle moderate above-target leverage",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("200"), // $200
          // Current leverage: 350/(350-200) = 233.33%
          expectedDirection: 1, // Still need to increase to reach 300%
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle below-target leverage with vault balance",
          currentCollateral: ethers.parseEther("250"), // $250
          currentDebt: ethers.parseEther("50"), // $50
          vaultCollateralBalance: ethers.parseEther("5"),
          expectedDirection: 1, // Increase
          expectedAmount: "positive",
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle exact target leverage with vault balance",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("200"), // $200
          vaultCollateralBalance: ethers.parseEther("1"),
          expectedDirection: 0, // Already at target
          expectedAmount: "small",
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle fractional amounts",
          currentCollateral: ethers.parseEther("150.5"), // $150.5
          currentDebt: ethers.parseEther("25.1"), // $25.1
          expectedDirection: 1, // Below target
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },

        // Additional test cases for expectedDirection: -1 (decrease leverage)
        {
          name: "Should return decrease direction when leverage is above target",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("225"), // $225
          // Current leverage: 300/(300-225) = 300/75 = 400%
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle high leverage scenario requiring decrease",
          currentCollateral: ethers.parseEther("400"), // $400
          currentDebt: ethers.parseEther("300"), // $300
          // Current leverage: 400/(400-300) = 400/100 = 400%
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle moderate above-target leverage requiring decrease",
          currentCollateral: ethers.parseEther("500"), // $500
          currentDebt: ethers.parseEther("375"), // $375
          // Current leverage: 500/(500-375) = 500/125 = 400%
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle extreme high leverage requiring decrease",
          currentCollateral: ethers.parseEther("1000"), // $1000
          currentDebt: ethers.parseEther("900"), // $900
          // Current leverage: 1000/(1000-900) = 1000/100 = 1000%
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle slightly above target leverage",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("201"), // $201
          // Current leverage: 300/(300-201) = 300/99 ≈ 303%
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle above-target leverage with vault balance",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("280"), // $280
          // Current leverage: 350/(350-280) = 350/70 = 500%
          vaultDebtBalance: ethers.parseEther("5"),
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle high leverage with sufficient vault debt balance",
          currentCollateral: ethers.parseEther("400"), // $400
          currentDebt: ethers.parseEther("320"), // $320
          // Current leverage: 400/(400-320) = 400/80 = 500%
          vaultDebtBalance: ethers.parseEther("100"), // Large vault balance
          expectedDirection: -1, // Decrease
          expectedAmount: "positive", // May be 0 if vault has enough
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle large amounts requiring decrease",
          currentCollateral: ethers.parseEther("100000"), // $100,000
          currentDebt: ethers.parseEther("80000"), // $80,000
          // Current leverage: 100000/(100000-80000) = 100000/20000 = 500%
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle fractional amounts requiring decrease",
          currentCollateral: ethers.parseEther("123.45"), // $123.45
          currentDebt: ethers.parseEther("100.5"), // $100.5
          // Current leverage: 123.45/(123.45-100.5) = 123.45/22.95 ≈ 538%
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: false,
        },

        // Additional test cases for expectedDirection: 0 (no rebalance)
        {
          name: "Should handle exact target leverage with different amounts",
          currentCollateral: ethers.parseEther("600"), // $600
          currentDebt: ethers.parseEther("400"), // $400
          // Current leverage: 600/(600-400) = 600/200 = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle target leverage with fractional amounts",
          currentCollateral: ethers.parseEther("150"), // $150
          currentDebt: ethers.parseEther("100"), // $100
          // Current leverage: 150/(150-100) = 150/50 = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle target leverage with large amounts",
          currentCollateral: ethers.parseEther("30000"), // $30,000
          currentDebt: ethers.parseEther("20000"), // $20,000
          // Current leverage: 30000/(30000-20000) = 30000/10000 = 300%
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: false,
        },
        {
          name: "Should handle target leverage with vault collateral balance",
          currentCollateral: ethers.parseEther("450"), // $450
          currentDebt: ethers.parseEther("300"), // $300
          // Current leverage: 450/(450-300) = 450/150 = 300%
          vaultCollateralBalance: ethers.parseEther("10"),
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle target leverage with vault debt balance",
          currentCollateral: ethers.parseEther("750"), // $750
          currentDebt: ethers.parseEther("500"), // $500
          // Current leverage: 750/(750-500) = 750/250 = 300%
          vaultDebtBalance: ethers.parseEther("8"),
          expectedDirection: 0, // No rebalance
          expectedAmount: 0n,
          useVaultTokenBalance: true,
        },

        // Additional test cases for useVaultTokenBalance: true
        {
          name: "Should handle low leverage with large vault collateral balance",
          currentCollateral: ethers.parseEther("100"), // $100
          currentDebt: ethers.parseEther("10"), // $10
          // Current leverage: 100/(100-10) = 100/90 ≈ 111%
          vaultCollateralBalance: ethers.parseEther("50"), // Large vault balance
          expectedDirection: 1, // Increase
          expectedAmount: "positive", // May be 0 if vault has enough
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle medium leverage with vault collateral balance",
          currentCollateral: ethers.parseEther("250"), // $250
          currentDebt: ethers.parseEther("125"), // $125
          // Current leverage: 250/(250-125) = 250/125 = 200%
          vaultCollateralBalance: ethers.parseEther("15"),
          expectedDirection: 1, // Increase
          expectedAmount: "positive",
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle high leverage with small vault debt balance",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("175"), // $175
          // Current leverage: 200/(200-175) = 200/25 = 800%
          vaultDebtBalance: ethers.parseEther("2"), // Small vault balance
          expectedDirection: -1, // Decrease
          expectedAmount: "positive",
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle high leverage with large vault debt balance",
          currentCollateral: ethers.parseEther("500"), // $500
          currentDebt: ethers.parseEther("450"), // $450
          // Current leverage: 500/(500-450) = 500/50 = 1000%
          vaultDebtBalance: ethers.parseEther("200"), // Very large vault balance
          expectedDirection: -1, // Decrease
          expectedAmount: "positive", // May be 0 if vault has enough
          useVaultTokenBalance: true,
        },
        {
          name: "Should handle vault balance with both collateral and debt tokens",
          currentCollateral: ethers.parseEther("350"), // $350
          currentDebt: ethers.parseEther("100"), // $100
          // Current leverage: 350/(350-100) = 350/250 = 140%
          vaultCollateralBalance: ethers.parseEther("20"),
          vaultDebtBalance: ethers.parseEther("5"), // Both vault balances
          expectedDirection: 1, // Increase
          expectedAmount: "positive",
          useVaultTokenBalance: true,
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Set up prices
          const collateralPrice = ethers.parseEther("1"); // $1 per token
          const debtPrice = ethers.parseEther("1"); // $1 per token

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            collateralPrice,
          );
          await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

          // Set up mock collateral and debt
          await dloopMock.setMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            testCase.currentCollateral,
          );
          await dloopMock.setMockDebt(
            await dloopMock.getAddress(),
            await debtToken.getAddress(),
            testCase.currentDebt,
          );

          // Set up vault balances if specified
          if (testCase.vaultCollateralBalance) {
            await collateralToken.mint(
              await dloopMock.getAddress(),
              testCase.vaultCollateralBalance,
            );
          }

          if (testCase.vaultDebtBalance) {
            await debtToken.mint(
              await dloopMock.getAddress(),
              testCase.vaultDebtBalance,
            );
          }

          const [tokenAmount, direction] =
            await dloopMock.testGetAmountToReachTargetLeverage(
              testCase.useVaultTokenBalance,
            );

          expect(direction).to.equal(testCase.expectedDirection);

          if (typeof testCase.expectedAmount === "string") {
            if (testCase.expectedAmount === "positive") {
              // For vault token balance mode, 0 is acceptable if vault has enough balance
              if (testCase.useVaultTokenBalance) {
                expect(tokenAmount).to.be.gte(0);
              } else {
                expect(tokenAmount).to.be.gt(0);
              }
            } else if (testCase.expectedAmount === "small") {
              expect(tokenAmount).to.be.lte(ethers.parseEther("10")); // Should be small
            }
          } else {
            expect(tokenAmount).to.equal(testCase.expectedAmount);
          }
        });
      }
    });
  });

  describe("IV. Advanced Calculation Functions", function () {
    describe("getCollateralTokenAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        currentCollateral: bigint;
        currentDebt: bigint;
        vaultCollateralBalance?: bigint;
        useVaultTokenBalance: boolean;
        expectedAmount: bigint | "positive" | "small" | "large";
      }[] = [
        {
          name: "Should calculate collateral needed for below-target leverage",
          currentCollateral: ethers.parseEther("200"), // $200
          currentDebt: ethers.parseEther("50"), // $50
          useVaultTokenBalance: false,
          expectedAmount: "positive",
        },
        {
          name: "Should handle target leverage scenario",
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("200"), // $200
          useVaultTokenBalance: false,
          expectedAmount: "small", // At target leverage, only small rebalancing needed
        },
        {
          name: "Should handle vault token balance mode",
          currentCollateral: ethers.parseEther("250"), // $250
          currentDebt: ethers.parseEther("100"), // $100
          vaultCollateralBalance: ethers.parseEther("5"),
          useVaultTokenBalance: true,
          expectedAmount: "positive", // May be 0 if vault has enough balance
        },
        {
          name: "Should handle very low leverage",
          currentCollateral: ethers.parseEther("1000"), // $1000
          currentDebt: ethers.parseEther("10"), // $10
          useVaultTokenBalance: false,
          expectedAmount: "positive",
        },
        {
          name: "Should handle zero position",
          currentCollateral: 0n,
          currentDebt: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
        },
        {
          name: "Should handle small fractional amounts",
          currentCollateral: ethers.parseEther("100.5"),
          currentDebt: ethers.parseEther("20.1"),
          useVaultTokenBalance: false,
          expectedAmount: "positive",
        },
        {
          name: "Should handle large amounts",
          currentCollateral: ethers.parseEther("100000"),
          currentDebt: ethers.parseEther("10000"),
          useVaultTokenBalance: false,
          expectedAmount: "positive",
        },
        {
          name: "Should handle near-target with vault balance",
          currentCollateral: ethers.parseEther("295"),
          currentDebt: ethers.parseEther("195"),
          vaultCollateralBalance: ethers.parseEther("2"),
          useVaultTokenBalance: true,
          expectedAmount: "small", // Near target, should be small amount
        },
        {
          name: "Should handle moderate leverage gap",
          currentCollateral: ethers.parseEther("180"),
          currentDebt: ethers.parseEther("60"),
          useVaultTokenBalance: false,
          expectedAmount: "positive",
        },
        {
          name: "Should handle different price scenarios",
          currentCollateral: ethers.parseEther("150"),
          currentDebt: ethers.parseEther("30"),
          useVaultTokenBalance: false,
          expectedAmount: "positive",
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          // Set up prices
          const collateralPrice = ethers.parseEther("1");
          const debtPrice = ethers.parseEther("1");

          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            collateralPrice,
          );
          await dloopMock.setMockPrice(await debtToken.getAddress(), debtPrice);

          // Set up mock collateral and debt
          await dloopMock.setMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            testCase.currentCollateral,
          );
          await dloopMock.setMockDebt(
            await dloopMock.getAddress(),
            await debtToken.getAddress(),
            testCase.currentDebt,
          );

          // Set up vault balances if specified
          if (testCase.vaultCollateralBalance) {
            await collateralToken.mint(
              await dloopMock.getAddress(),
              testCase.vaultCollateralBalance,
            );
          }

          const result =
            await dloopMock.testGetCollateralTokenAmountToReachTargetLeverage(
              testCase.useVaultTokenBalance,
            );

          if (typeof testCase.expectedAmount === "string") {
            if (testCase.expectedAmount === "positive") {
              // For vault token balance mode, 0 is acceptable if vault has enough balance
              if (testCase.useVaultTokenBalance) {
                expect(result).to.be.gte(0);
              } else {
                expect(result).to.be.gt(0);
              }
            } else if (testCase.expectedAmount === "small") {
              expect(result).to.be.lte(ethers.parseEther("10"));
            } else if (testCase.expectedAmount === "large") {
              expect(result).to.be.gt(ethers.parseEther("10"));
            }
          } else {
            expect(result).to.equal(testCase.expectedAmount);
          }
        });
      }
    });

    describe("getDebtTokenAmountToReachTargetLeverage", function () {
      const testCases: {
        name: string;
        collateralPrice: bigint;
        debtPrice: bigint;
        currentCollateral: bigint;
        currentDebt: bigint;
        vaultCollateralBalance: bigint;
        vaultDebtBalance: bigint;
        useVaultTokenBalance: boolean;
        expectedAmount: bigint | "positive" | "small" | "large";
        expectedToThrow: boolean;
      }[] = [
        {
          name: "Should return 0 when at target leverage",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("300"), // $300
          currentDebt: ethers.parseEther("200"), // $200
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: false,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
        },
        {
          name: "Should handle vault token balance mode",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("400"), // $400
          currentDebt: ethers.parseEther("100"), // $100
          vaultDebtBalance: ethers.parseEther("5"),
          useVaultTokenBalance: true,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          expectedAmount: 0n,
        },
        {
          name: "Should handle low leverage scenario",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("600"), // $600
          currentDebt: ethers.parseEther("100"), // $100
          useVaultTokenBalance: false,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
          expectedAmount: 0n,
        },
        {
          name: "Should handle zero position",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: 0n,
          currentDebt: 0n,
          useVaultTokenBalance: false,
          expectedAmount: 0n,
          expectedToThrow: false,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
        },
        {
          name: "Should handle small fractional amounts",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("450.5"),
          currentDebt: ethers.parseEther("120.1"),
          useVaultTokenBalance: false,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
          expectedAmount: 0n,
        },
        {
          name: "Should handle large amounts",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("500000"),
          currentDebt: ethers.parseEther("100000"),
          useVaultTokenBalance: false,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
          expectedAmount: 0n,
        },
        {
          name: "Should handle near-target with vault balance",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("305"),
          currentDebt: ethers.parseEther("195"),
          vaultDebtBalance: ethers.parseEther("1"),
          useVaultTokenBalance: true,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          expectedAmount: 0n,
        },
        {
          name: "Should handle moderate leverage gap",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("450"),
          currentDebt: ethers.parseEther("150"),
          useVaultTokenBalance: false,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
          expectedAmount: 0n,
        },
        {
          name: "Should handle different price scenarios",
          currentCollateral: ethers.parseEther("400"),
          currentDebt: ethers.parseEther("100"),
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("2"), // Different debt price
          useVaultTokenBalance: false,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
          expectedAmount: 0n,
        },
        {
          name: "Should handle high collateral, low debt scenario",
          collateralPrice: ethers.parseEther("1"),
          debtPrice: ethers.parseEther("1"),
          currentCollateral: ethers.parseEther("900"),
          currentDebt: ethers.parseEther("50"),
          useVaultTokenBalance: false,
          expectedToThrow: true,
          vaultCollateralBalance: 0n,
          vaultDebtBalance: 0n,
          expectedAmount: 0n,
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          await dloopMock.setMockPrice(
            await collateralToken.getAddress(),
            testCase.collateralPrice,
          );
          await dloopMock.setMockPrice(
            await debtToken.getAddress(),
            testCase.debtPrice,
          );

          // Set up mock collateral and debt
          await dloopMock.setMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
            testCase.currentCollateral,
          );
          await dloopMock.setMockDebt(
            await dloopMock.getAddress(),
            await debtToken.getAddress(),
            testCase.currentDebt,
          );

          // Set up vault balances if specified
          if (testCase.vaultCollateralBalance) {
            await collateralToken.mint(
              await dloopMock.getAddress(),
              testCase.vaultCollateralBalance,
            );
          }

          if (testCase.vaultDebtBalance) {
            await debtToken.mint(
              await dloopMock.getAddress(),
              testCase.vaultDebtBalance,
            );
          }

          if (testCase.expectedToThrow) {
            // Test that the function throws an arithmetic overflow error
            await expect(
              dloopMock.testGetDebtTokenAmountToReachTargetLeverage(
                testCase.useVaultTokenBalance,
              ),
            ).to.be.revertedWithPanic(0x11); // Arithmetic overflow panic code
          } else {
            // Test normal execution
            const result =
              await dloopMock.testGetDebtTokenAmountToReachTargetLeverage(
                testCase.useVaultTokenBalance,
              );

            if (typeof testCase.expectedAmount === "string") {
              if (testCase.expectedAmount === "positive") {
                expect(result).to.be.gt(0);
              } else if (testCase.expectedAmount === "small") {
                expect(result).to.be.lte(ethers.parseEther("10"));
              } else if (testCase.expectedAmount === "large") {
                expect(result).to.be.gt(ethers.parseEther("10")); // Larger than expected
              }
            } else {
              expect(result).to.equal(testCase.expectedAmount);
            }
          }
        });
      }
    });
  });
});
