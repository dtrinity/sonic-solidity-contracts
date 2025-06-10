import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, testSetup } from "./fixture";

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

  describe("I. Leverage Calculation Functions", function () {
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

          const result = await dloopMock.getRepayAmountThatKeepCurrentLeverage(
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
  });
});
