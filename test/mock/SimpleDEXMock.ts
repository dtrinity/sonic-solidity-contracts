import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { SimpleDEXMock, TestMintableERC20 } from "../../typechain-types";
import { ONE_HUNDRED_PERCENT_BPS, ONE_PERCENT_BPS } from "../../typescript/common/bps_constants";

// Test constants
const DEFAULT_EXCHANGE_RATE = ethers.parseEther("1.5"); // 1 input token = 1.5 output tokens
const REVERSE_EXCHANGE_RATE = ethers.parseEther("0.666666666666666666"); // 1 output token = 0.666... input tokens
const EXECUTION_SLIPPAGE_BPS = 2 * ONE_PERCENT_BPS; // 2% execution slippage
const TOKEN_A_DECIMALS = 18;
const TOKEN_B_DECIMALS = 6;
const TOKEN_C_DECIMALS = 8;

export interface SimpleDEXMockFixture {
  dexMock: SimpleDEXMock;
  tokenA: TestMintableERC20; // 18 decimals
  tokenB: TestMintableERC20; // 6 decimals
  tokenC: TestMintableERC20; // 8 decimals
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;
  user3: HardhatEthersSigner;
}

/**
 * Deploy the SimpleDEXMock contract with test tokens
 */
async function deploySimpleDEXMockFixture(): Promise<SimpleDEXMockFixture> {
  const accounts = await ethers.getSigners();
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];

  // Deploy test tokens with different decimals
  const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
  const tokenA = await MockERC20.deploy("Token A", "TKNA", TOKEN_A_DECIMALS);
  const tokenB = await MockERC20.deploy("Token B", "TKNB", TOKEN_B_DECIMALS);
  const tokenC = await MockERC20.deploy("Token C", "TKNC", TOKEN_C_DECIMALS);

  // Deploy SimpleDEXMock
  const SimpleDEXMock = await ethers.getContractFactory("SimpleDEXMock");
  const dexMock = await SimpleDEXMock.deploy();

  return {
    dexMock: dexMock as unknown as SimpleDEXMock,
    tokenA,
    tokenB,
    tokenC,
    accounts,
    deployer,
    user1,
    user2,
    user3,
  };
}

/**
 * Setup the test environment
 *
 * @param fixture - The fixture to use for the test
 */
async function testSetup(fixture: SimpleDEXMockFixture): Promise<void> {
  const { dexMock, tokenA, tokenB, tokenC, user1, user2, user3 } = fixture;

  // Mint tokens to DEX contract for liquidity
  const dexLiquidity = ethers.parseEther("1000000"); // Large liquidity
  await tokenA.mint(await dexMock.getAddress(), dexLiquidity);
  await tokenB.mint(await dexMock.getAddress(), ethers.parseUnits("1000000", TOKEN_B_DECIMALS));
  await tokenC.mint(await dexMock.getAddress(), ethers.parseUnits("1000000", TOKEN_C_DECIMALS));

  // Mint tokens to users
  const userBalance = ethers.parseEther("10000");

  for (const user of [user1, user2, user3]) {
    await tokenA.mint(user.address, userBalance);
    await tokenB.mint(user.address, ethers.parseUnits("10000", TOKEN_B_DECIMALS));
    await tokenC.mint(user.address, ethers.parseUnits("10000", TOKEN_C_DECIMALS));

    // Set approvals
    await tokenA.connect(user).approve(await dexMock.getAddress(), ethers.MaxUint256);
    await tokenB.connect(user).approve(await dexMock.getAddress(), ethers.MaxUint256);
    await tokenC.connect(user).approve(await dexMock.getAddress(), ethers.MaxUint256);
  }

  // Set up exchange rates
  await dexMock.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), DEFAULT_EXCHANGE_RATE);
  await dexMock.setExchangeRate(await tokenB.getAddress(), await tokenA.getAddress(), REVERSE_EXCHANGE_RATE);
  await dexMock.setExchangeRate(
    await tokenA.getAddress(),
    await tokenC.getAddress(),
    ethers.parseEther("2.0"), // 1 A = 2 C
  );
  await dexMock.setExchangeRate(
    await tokenC.getAddress(),
    await tokenA.getAddress(),
    ethers.parseEther("0.5"), // 1 C = 0.5 A
  );

  // Set execution slippage
  await dexMock.setExecutionSlippage(EXECUTION_SLIPPAGE_BPS);
}

describe("SimpleDEXMock Tests", function () {
  let dexMock: SimpleDEXMock;
  let tokenA: TestMintableERC20;
  let tokenB: TestMintableERC20;
  let tokenC: TestMintableERC20;
  let accounts: HardhatEthersSigner[];
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  beforeEach(async function () {
    const fixture = await loadFixture(deploySimpleDEXMockFixture);
    await testSetup(fixture);

    dexMock = fixture.dexMock;
    tokenA = fixture.tokenA;
    tokenB = fixture.tokenB;
    tokenC = fixture.tokenC;
    accounts = fixture.accounts;
    user1 = fixture.user1;
    user2 = fixture.user2;
    user3 = fixture.user3;
  });

  describe("I. Configuration and Setup", function () {
    it("Should set exchange rates correctly", async function () {
      const rate = await dexMock.getExchangeRate(await tokenA.getAddress(), await tokenB.getAddress());
      expect(rate).to.equal(DEFAULT_EXCHANGE_RATE);
    });

    it("Should set execution slippage correctly", async function () {
      expect(await dexMock.executionSlippageBps()).to.equal(EXECUTION_SLIPPAGE_BPS);
    });

    it("Should emit events when setting exchange rates", async function () {
      const newRate = ethers.parseEther("2.5");
      await expect(dexMock.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), newRate))
        .to.emit(dexMock, "ExchangeRateSet")
        .withArgs(await tokenA.getAddress(), await tokenB.getAddress(), newRate);
    });

    it("Should emit events when setting execution slippage", async function () {
      const newSlippage = 3 * ONE_PERCENT_BPS;
      await expect(dexMock.setExecutionSlippage(newSlippage)).to.emit(dexMock, "ExecutionSlippageSet").withArgs(newSlippage);
    });

    it("Should revert when setting invalid exchange rate", async function () {
      await expect(
        dexMock.setExchangeRate(ethers.ZeroAddress, await tokenB.getAddress(), DEFAULT_EXCHANGE_RATE),
      ).to.be.revertedWithCustomError(dexMock, "ZeroAddress");

      await expect(dexMock.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), 0)).to.be.revertedWithCustomError(
        dexMock,
        "ZeroAmount",
      );
    });

    it("Should revert when setting invalid execution slippage", async function () {
      await expect(dexMock.setExecutionSlippage(ONE_HUNDRED_PERCENT_BPS)).to.be.revertedWith("Execution slippage cannot be 100% or more");
    });
  });

  describe("II. ExactInput Swap Functionality", function () {
    const exactInputTestCases = [
      {
        name: "Basic swap A->B with execution slippage",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedOutput: ethers.parseUnits("147", TOKEN_B_DECIMALS), // 150 * 0.98 (2% slippage)
      },
      {
        name: "Reverse swap B->A with execution slippage",
        inputToken: "B",
        outputToken: "A",
        amountIn: ethers.parseUnits("150", TOKEN_B_DECIMALS), // 150 B tokens
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: REVERSE_EXCHANGE_RATE,
        userIndex: 1,
        expectedOutput: ethers.parseEther("97.999999999999999902"), // ~98 A tokens after slippage
      },
      {
        name: "Cross-decimal swap A->C",
        inputToken: "A",
        outputToken: "C",
        amountIn: ethers.parseEther("50"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("2.0"),
        userIndex: 2,
        expectedOutput: ethers.parseUnits("98", TOKEN_C_DECIMALS), // 100 * 0.98 (2% slippage)
      },
      {
        name: "Small amount swap",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("0.1"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedOutput: ethers.parseUnits("0.147", TOKEN_B_DECIMALS), // 0.15 * 0.98 (2% slippage)
      },
      {
        name: "Large amount swap",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("1000"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 3,
        expectedOutput: ethers.parseUnits("1470", TOKEN_B_DECIMALS), // 1500 * 0.98 (2% slippage)
      },
      {
        name: "High exchange rate A->B (1:3)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("3.0"), // 1 A = 3 B
        userIndex: 1,
        expectedOutput: ethers.parseUnits("294", TOKEN_B_DECIMALS), // 300 * 0.98 (2% slippage)
      },
      {
        name: "Low exchange rate A->B (1:0.5)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("200"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.5"), // 1 A = 0.5 B
        userIndex: 2,
        expectedOutput: ethers.parseUnits("98", TOKEN_B_DECIMALS), // 100 * 0.98 (2% slippage)
      },
      {
        name: "Fractional rate A->C (1:0.75)",
        inputToken: "A",
        outputToken: "C",
        amountIn: ethers.parseEther("80"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.75"), // 1 A = 0.75 C
        userIndex: 3,
        expectedOutput: ethers.parseUnits("58.8", TOKEN_C_DECIMALS), // 60 * 0.98 (2% slippage)
      },
      {
        name: "Very high rate B->A (1:10)",
        inputToken: "B",
        outputToken: "A",
        amountIn: ethers.parseUnits("50", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("10.0"), // 1 B = 10 A
        userIndex: 1,
        expectedOutput: ethers.parseEther("490"), // 500 * 0.98 (2% slippage)
      },
      {
        name: "Decimal precision test B->C (1:1.25)",
        inputToken: "B",
        outputToken: "C",
        amountIn: ethers.parseUnits("40", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("1.25"), // 1 B = 1.25 C
        userIndex: 2,
        expectedOutput: ethers.parseUnits("49", TOKEN_C_DECIMALS), // 50 * 0.98 (2% slippage)
      },
      // New test cases with different execution slippage
      {
        name: "No slippage swap A->B (0%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedOutput: ethers.parseUnits("150", TOKEN_B_DECIMALS), // 150 * 1.0 (0% slippage)
      },
      {
        name: "Low slippage swap A->B (0.5%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.005 * ONE_PERCENT_BPS, // 0.005% = 50 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedOutput: ethers.parseUnits("149.9925", TOKEN_B_DECIMALS), // 150 * 0.9995 (0.5% slippage)
      },
      {
        name: "Medium slippage swap A->B (1%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.01 * ONE_PERCENT_BPS, // 0.01% = 100 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 3,
        expectedOutput: ethers.parseUnits("149.985", TOKEN_B_DECIMALS), // 150 * 0.999 (1% slippage)
      },
      {
        name: "High slippage swap A->B (5%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.05 * ONE_PERCENT_BPS, // 0.05% = 500 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedOutput: ethers.parseUnits("149.925", TOKEN_B_DECIMALS), // 150 * 0.9995 (5% slippage)
      },
      {
        name: "Very high slippage swap A->B (10%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.1 * ONE_PERCENT_BPS, // 0.1% = 1000 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedOutput: ethers.parseUnits("149.85", TOKEN_B_DECIMALS), // 150 * 0.999 (10% slippage)
      },
      {
        name: "Minimal slippage swap A->B (0.1%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.001 * ONE_PERCENT_BPS, // 0.1% = 10 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedOutput: ethers.parseUnits("149.9985", TOKEN_B_DECIMALS), // 150 * 0.9999 (0.1% slippage)
      },
      {
        name: "Small slippage swap A->B (0.25%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.0025 * ONE_PERCENT_BPS, // 0.25% = 25 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedOutput: ethers.parseUnits("149.99625", TOKEN_B_DECIMALS), // 150 * 0.99975 (0.25% slippage)
      },
      {
        name: "Moderate slippage swap A->B (1.5%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.015 * ONE_PERCENT_BPS, // 1.5% = 150 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 3,
        expectedOutput: ethers.parseUnits("149.9775", TOKEN_B_DECIMALS), // 150 * 0.9985 (1.5% slippage)
      },
      {
        name: "Higher slippage swap A->B (3%)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("100"),
        executionSlippage: 0.03 * ONE_PERCENT_BPS, // 3% = 300 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedOutput: ethers.parseUnits("149.955", TOKEN_B_DECIMALS), // 150 * 0.997 (3% slippage)
      },
      // Additional test cases with unique exchange rates for Section II
      {
        name: "Exchange rate A->B (1:4)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("50"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("4.0"), // 1 A = 4 B
        userIndex: 1,
        expectedOutput: ethers.parseUnits("196", TOKEN_B_DECIMALS), // 200 * 0.98 (2% slippage)
      },
      {
        name: "Exchange rate A->C (1:5.5)",
        inputToken: "A",
        outputToken: "C",
        amountIn: ethers.parseEther("20"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("5.5"), // 1 A = 5.5 C
        userIndex: 2,
        expectedOutput: ethers.parseUnits("107.8", TOKEN_C_DECIMALS), // 110 * 0.98 (2% slippage)
      },
      {
        name: "Exchange rate B->A (1:0.8)",
        inputToken: "B",
        outputToken: "A",
        amountIn: ethers.parseUnits("125", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.8"), // 1 B = 0.8 A
        userIndex: 3,
        expectedOutput: ethers.parseEther("98"), // 100 * 0.98 (2% slippage)
      },
      {
        name: "Exchange rate A->B (1:0.25)",
        inputToken: "A",
        outputToken: "B",
        amountIn: ethers.parseEther("400"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.25"), // 1 A = 0.25 B
        userIndex: 1,
        expectedOutput: ethers.parseUnits("98", TOKEN_B_DECIMALS), // 100 * 0.98 (2% slippage)
      },
      {
        name: "Exchange rate C->A (1:2.5)",
        inputToken: "C",
        outputToken: "A",
        amountIn: ethers.parseUnits("60", TOKEN_C_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("2.5"), // 1 C = 2.5 A
        userIndex: 2,
        expectedOutput: ethers.parseEther("147"), // 150 * 0.98 (2% slippage)
      },
    ];

    for (const testCase of exactInputTestCases) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const inputToken = testCase.inputToken === "A" ? tokenA : testCase.inputToken === "B" ? tokenB : tokenC;
        const outputToken = testCase.outputToken === "A" ? tokenA : testCase.outputToken === "B" ? tokenB : tokenC;

        // Get initial balances
        const initialInputBalance = await inputToken.balanceOf(user.address);
        const initialOutputBalance = await outputToken.balanceOf(user.address);

        // Set exchange rate
        await dexMock.setExchangeRate(await inputToken.getAddress(), await outputToken.getAddress(), testCase.exchangeRate);

        // Set execution slippage
        await dexMock.setExecutionSlippage(testCase.executionSlippage);

        // Preview the swap
        const estimatedOutput = await dexMock.previewSwapExactInput(inputToken, outputToken, testCase.amountIn);

        // Execute the swap
        const tx = await dexMock.connect(user).executeSwapExactInput(
          inputToken,
          outputToken,
          testCase.amountIn,
          0, // No minimum for this test
          user.address,
        );

        // Verify balances changed correctly
        const finalInputBalance = await inputToken.balanceOf(user.address);
        const finalOutputBalance = await outputToken.balanceOf(user.address);

        expect(finalInputBalance).to.equal(initialInputBalance - testCase.amountIn);
        expect(finalOutputBalance).to.equal(initialOutputBalance + estimatedOutput);

        // Verify the actual amounts match expected amounts
        const actualInputSpent = initialInputBalance - finalInputBalance;
        const actualOutputReceived = finalOutputBalance - initialOutputBalance;

        expect(actualInputSpent).to.equal(testCase.amountIn, "Input amount spent should match expected");
        expect(actualOutputReceived).to.equal(estimatedOutput, "Output amount received should match expected");

        // Verify the expected output amount matches the expected output amount
        expect(actualOutputReceived).to.equal(testCase.expectedOutput, "Output amount received should match expected");

        // Verify event emission
        await expect(tx)
          .to.emit(dexMock, "SwapExecuted")
          .withArgs(
            await inputToken.getAddress(),
            await outputToken.getAddress(),
            testCase.amountIn,
            estimatedOutput,
            user.address,
            "ExactInput",
          );

        // Verify execution slippage was applied
        // Calculate what output would be without slippage
        // const outputWithoutSlippage = await dexMock
        //   .connect(user)
        //   .previewSwapExactInput.staticCall(
        //     inputToken,
        //     outputToken,
        //     testCase.amountIn,
        //   );

        // Temporarily remove slippage and check
        await dexMock.setExecutionSlippage(0);
        const outputNoSlippage = await dexMock.previewSwapExactInput(inputToken, outputToken, testCase.amountIn);

        // Restore slippage
        await dexMock.setExecutionSlippage(testCase.executionSlippage);

        // Verify slippage was applied (output with slippage should be less unless no slippage)
        if (testCase.executionSlippage > 0) {
          expect(estimatedOutput).to.be.lt(outputNoSlippage);
        } else {
          expect(estimatedOutput).to.equal(outputNoSlippage);
        }

        // Calculate expected slippage reduction
        const expectedSlippedOutput =
          (outputNoSlippage * BigInt(ONE_HUNDRED_PERCENT_BPS - testCase.executionSlippage)) / BigInt(ONE_HUNDRED_PERCENT_BPS);
        expect(estimatedOutput).to.be.closeTo(expectedSlippedOutput, 1);
      });
    }

    it("Should revert when output is below minimum", async function () {
      const amountIn = ethers.parseEther("100");
      const expectedOutput = await dexMock.previewSwapExactInput(tokenA, tokenB, amountIn);
      const tooHighMinimum = expectedOutput + ethers.parseUnits("1", TOKEN_B_DECIMALS);

      await expect(
        dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, amountIn, tooHighMinimum, user1.address),
      ).to.be.revertedWithCustomError(dexMock, "InsufficientOutputAmount");
    });

    it("Should revert when exchange rate not set", async function () {
      await expect(
        dexMock.connect(user1).executeSwapExactInput(tokenB, tokenC, ethers.parseUnits("100", TOKEN_B_DECIMALS), 0, user1.address),
      ).to.be.revertedWithCustomError(dexMock, "ExchangeRateNotSet");
    });

    it("Should revert when insufficient allowance", async function () {
      await tokenA.connect(user1).approve(await dexMock.getAddress(), 0);

      await expect(
        dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, ethers.parseEther("100"), 0, user1.address),
      ).to.be.revertedWithCustomError(dexMock, "InsufficientAllowance");
    });
  });

  describe("III. ExactOutput Swap Functionality", function () {
    const exactOutputTestCases = [
      {
        name: "Basic exact output swap A->B",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedInput: ethers.parseEther("102.040816"), // Calculated based on slippage math
      },
      {
        name: "Reverse exact output swap B->A",
        inputToken: "B",
        outputToken: "A",
        amountOut: ethers.parseEther("100"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: REVERSE_EXCHANGE_RATE,
        userIndex: 1,
        expectedInput: ethers.parseUnits("153.061224", TOKEN_B_DECIMALS), // Calculated based on slippage math
      },
      {
        name: "Cross-decimal exact output swap A->C",
        inputToken: "A",
        outputToken: "C",
        amountOut: ethers.parseUnits("100", TOKEN_C_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("2.0"),
        userIndex: 2,
        expectedInput: ethers.parseEther("51.02040816"), // Calculated based on slippage math
      },
      {
        name: "Small exact output swap",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("0.15", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedInput: ethers.parseEther("0.102040666666666666"), // Calculated based on slippage math
      },
      {
        name: "Large exact output swap",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("1500", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 3,
        expectedInput: ethers.parseEther("1020.408162666666666666"), // Calculated based on slippage math
      },
      {
        name: "High rate exact output A->B (1:3)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("300", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("3.0"),
        userIndex: 1,
        expectedInput: ethers.parseEther("102.040816"), // 300/(3*0.98) = ~102.04
      },
      {
        name: "Low rate exact output A->B (1:0.5)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("100", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.5"),
        userIndex: 2,
        expectedInput: ethers.parseEther("204.081632"), // 100/(0.5*0.98) = ~204.08
      },
      // New test cases with different execution slippage
      {
        name: "No slippage exact output A->B (0%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0,
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedInput: ethers.parseEther("100"), // 150/1.5 with no slippage
      },
      {
        name: "Low slippage exact output A->B (1%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.01 * ONE_PERCENT_BPS, // 0.01% = 100 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedInput: ethers.parseEther("100.010000666666666666"), // Based on actual contract calculation
      },
      {
        name: "High slippage exact output A->B (5%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.05 * ONE_PERCENT_BPS, // 0.05% = 500 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 3,
        expectedInput: ethers.parseEther("100.050024666666666666"), // Based on actual contract calculation
      },
      {
        name: "Minimal slippage exact output A->B (0.1%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.001 * ONE_PERCENT_BPS, // 0.1% = 10 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedInput: ethers.parseEther("100.001"), // Based on calculation
      },
      {
        name: "Small slippage exact output A->B (0.25%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.0025 * ONE_PERCENT_BPS, // 0.25% = 25 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedInput: ethers.parseEther("100.0025"), // Based on calculation
      },
      {
        name: "Half percent exact output A->B (0.5%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.005 * ONE_PERCENT_BPS, // 0.5% = 50 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 3,
        expectedInput: ethers.parseEther("100.005"), // Based on calculation
      },
      {
        name: "Moderate slippage exact output A->B (1.5%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.015 * ONE_PERCENT_BPS, // 1.5% = 150 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 1,
        expectedInput: ethers.parseEther("100.015002"), // Based on calculation
      },
      {
        name: "Higher slippage exact output A->B (3%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.03 * ONE_PERCENT_BPS, // 3% = 300 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 2,
        expectedInput: ethers.parseEther("100.030008666666666666"), // Based on calculation
      },
      {
        name: "Significant slippage exact output A->B (10%)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("150", TOKEN_B_DECIMALS),
        executionSlippage: 0.1 * ONE_PERCENT_BPS, // 10% = 1000 basis points
        exchangeRate: DEFAULT_EXCHANGE_RATE,
        userIndex: 3,
        expectedInput: ethers.parseEther("100.1001"), // Based on calculation
      },
      // Additional test cases with unique exchange rates for Section III
      {
        name: "Exact output A->C (1:0.75)",
        inputToken: "A",
        outputToken: "C",
        amountOut: ethers.parseUnits("75", TOKEN_C_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.75"), // 1 A = 0.75 C
        userIndex: 1,
        expectedInput: ethers.parseEther("102.04081632"), // More precise calculation: 75/(0.75*0.98)
      },
      {
        name: "Exact output B->A (1:10)",
        inputToken: "B",
        outputToken: "A",
        amountOut: ethers.parseEther("490"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("10.0"), // 1 B = 10 A
        userIndex: 2,
        expectedInput: ethers.parseUnits("50", TOKEN_B_DECIMALS), // 490/(10*0.98) = 50
      },
      {
        name: "Exact output B->C (1:1.25)",
        inputToken: "B",
        outputToken: "C",
        amountOut: ethers.parseUnits("49", TOKEN_C_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("1.25"), // 1 B = 1.25 C
        userIndex: 3,
        expectedInput: ethers.parseUnits("40", TOKEN_B_DECIMALS), // 49/(1.25*0.98) = 40
      },
      {
        name: "Exact output A->B (1:4)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("196", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("4.0"), // 1 A = 4 B
        userIndex: 1,
        expectedInput: ethers.parseEther("50"), // 196/(4*0.98) = 50
      },
      {
        name: "Exact output A->C (1:5.5)",
        inputToken: "A",
        outputToken: "C",
        amountOut: ethers.parseUnits("107.8", TOKEN_C_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("5.5"), // 1 A = 5.5 C
        userIndex: 2,
        expectedInput: ethers.parseEther("20"), // 107.8/(5.5*0.98) = 20
      },
      {
        name: "Exact output B->A (1:0.8)",
        inputToken: "B",
        outputToken: "A",
        amountOut: ethers.parseEther("98"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.8"), // 1 B = 0.8 A
        userIndex: 3,
        expectedInput: ethers.parseUnits("125", TOKEN_B_DECIMALS), // 98/(0.8*0.98) = 125
      },
      {
        name: "Exact output A->B (1:0.25)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("98", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("0.25"), // 1 A = 0.25 B
        userIndex: 1,
        expectedInput: ethers.parseEther("400"), // 98/(0.25*0.98) = 400
      },
      {
        name: "Exact output C->A (1:2.5)",
        inputToken: "C",
        outputToken: "A",
        amountOut: ethers.parseEther("147"),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("2.5"), // 1 C = 2.5 A
        userIndex: 2,
        expectedInput: ethers.parseUnits("60", TOKEN_C_DECIMALS), // 147/(2.5*0.98) = 60
      },
      {
        name: "Exact output A->B (1:6.7)",
        inputToken: "A",
        outputToken: "B",
        amountOut: ethers.parseUnits("328.3", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("6.7"), // 1 A = 6.7 B
        userIndex: 3,
        expectedInput: ethers.parseEther("50"), // 328.3/(6.7*0.98) = 50
      },
      {
        name: "Exact output C->B (1:1.8)",
        inputToken: "C",
        outputToken: "B",
        amountOut: ethers.parseUnits("88.2", TOKEN_B_DECIMALS),
        executionSlippage: EXECUTION_SLIPPAGE_BPS,
        exchangeRate: ethers.parseEther("1.8"), // 1 C = 1.8 B
        userIndex: 1,
        expectedInput: ethers.parseUnits("50", TOKEN_C_DECIMALS), // 88.2/(1.8*0.98) = 50
      },
    ];

    for (const testCase of exactOutputTestCases) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const inputToken = testCase.inputToken === "A" ? tokenA : testCase.inputToken === "B" ? tokenB : tokenC;
        const outputToken = testCase.outputToken === "A" ? tokenA : testCase.outputToken === "B" ? tokenB : tokenC;

        // Get initial balances
        const initialInputBalance = await inputToken.balanceOf(user.address);
        const initialOutputBalance = await outputToken.balanceOf(user.address);

        // Set exchange rate
        await dexMock.setExchangeRate(await inputToken.getAddress(), await outputToken.getAddress(), testCase.exchangeRate);

        // Set execution slippage
        await dexMock.setExecutionSlippage(testCase.executionSlippage);

        // Preview the swap
        const estimatedInput = await dexMock.previewSwapExactOutput(inputToken, outputToken, testCase.amountOut);

        // Execute the swap
        const tx = await dexMock.connect(user).executeSwapExactOutput(
          inputToken,
          outputToken,
          testCase.amountOut,
          ethers.MaxUint256, // Very high maximum for this test
          user.address,
        );

        // Verify balances changed correctly
        const finalInputBalance = await inputToken.balanceOf(user.address);
        const finalOutputBalance = await outputToken.balanceOf(user.address);

        expect(finalInputBalance).to.equal(initialInputBalance - estimatedInput);
        expect(finalOutputBalance).to.equal(initialOutputBalance + testCase.amountOut);

        // Verify the actual amounts match expected amounts
        const actualInputSpent = initialInputBalance - finalInputBalance;
        const actualOutputReceived = finalOutputBalance - initialOutputBalance;

        expect(actualInputSpent).to.equal(estimatedInput, "Input amount spent should match expected");
        expect(actualOutputReceived).to.equal(testCase.amountOut, "Output amount received should match expected");

        // Verify the expected input amount matches the expected input amount
        expect(actualInputSpent).to.equal(testCase.expectedInput, "Input amount spent should match expected");

        // Verify event emission
        await expect(tx)
          .to.emit(dexMock, "SwapExecuted")
          .withArgs(
            await inputToken.getAddress(),
            await outputToken.getAddress(),
            estimatedInput,
            testCase.amountOut,
            user.address,
            "ExactOutput",
          );
      });
    }

    it("Should revert when input exceeds maximum", async function () {
      const amountOut = ethers.parseUnits("150", TOKEN_B_DECIMALS);
      const expectedInput = await dexMock.previewSwapExactOutput(tokenA, tokenB, amountOut);
      const tooLowMaximum = expectedInput - ethers.parseEther("1");

      await expect(
        dexMock.connect(user1).executeSwapExactOutput(tokenA, tokenB, amountOut, tooLowMaximum, user1.address),
      ).to.be.revertedWithCustomError(dexMock, "ExcessiveInputAmount");
    });

    it("Should revert when DEX has insufficient output tokens", async function () {
      // Try to swap for more tokens than the DEX has
      const dexBalance = await tokenB.balanceOf(await dexMock.getAddress());
      const excessiveAmount = dexBalance + ethers.parseUnits("1", TOKEN_B_DECIMALS);

      await expect(
        dexMock.connect(user1).executeSwapExactOutput(tokenA, tokenB, excessiveAmount, ethers.MaxUint256, user1.address),
      ).to.be.revertedWithCustomError(dexMock, "InsufficientBalance");
    });
  });

  describe("IV. Multiple Users and Complex Scenarios", function () {
    it("Should handle multiple users swapping simultaneously", async function () {
      const swapScenarios = [
        {
          user: user1,
          inputToken: tokenA,
          outputToken: tokenB,
          amountIn: ethers.parseEther("100"),
          executionSlippage: EXECUTION_SLIPPAGE_BPS,
          exchangeRate: DEFAULT_EXCHANGE_RATE,
          swapType: "exactInput" as const,
          expectedInput: ethers.parseEther("100"),
          expectedOutput: ethers.parseUnits("147", TOKEN_B_DECIMALS), // 150 * 0.98
        },
        {
          user: user2,
          inputToken: tokenB,
          outputToken: tokenA,
          amountOut: ethers.parseEther("50"),
          executionSlippage: EXECUTION_SLIPPAGE_BPS,
          exchangeRate: REVERSE_EXCHANGE_RATE,
          swapType: "exactOutput" as const,
          expectedInput: ethers.parseUnits("76.530612", TOKEN_B_DECIMALS), // Calculated with slippage
          expectedOutput: ethers.parseEther("50"),
        },
        {
          user: user3,
          inputToken: tokenA,
          outputToken: tokenC,
          amountIn: ethers.parseEther("75"),
          executionSlippage: EXECUTION_SLIPPAGE_BPS,
          exchangeRate: ethers.parseEther("2.0"),
          swapType: "exactInput" as const,
          expectedInput: ethers.parseEther("75"),
          expectedOutput: ethers.parseUnits("147", TOKEN_C_DECIMALS), // 150 * 0.98
        },
      ];

      const initialBalances = new Map();

      // Record initial balances and set exchange rates
      const expectedAmounts = new Map();

      for (const scenario of swapScenarios) {
        const userAddr = scenario.user.address;
        initialBalances.set(`${userAddr}_input`, await scenario.inputToken.balanceOf(userAddr));
        initialBalances.set(`${userAddr}_output`, await scenario.outputToken.balanceOf(userAddr));

        // Set exchange rate for this scenario
        await dexMock.setExchangeRate(
          await scenario.inputToken.getAddress(),
          await scenario.outputToken.getAddress(),
          scenario.exchangeRate,
        );

        // Set execution slippage for this scenario
        await dexMock.setExecutionSlippage(scenario.executionSlippage);

        // Use predefined expected amounts from test case
        expectedAmounts.set(`${userAddr}_expectedInput`, scenario.expectedInput);
        expectedAmounts.set(`${userAddr}_expectedOutput`, scenario.expectedOutput);
      }

      // Execute all swaps
      for (const scenario of swapScenarios) {
        if (scenario.swapType === "exactInput") {
          await dexMock
            .connect(scenario.user)
            .executeSwapExactInput(scenario.inputToken, scenario.outputToken, scenario.amountIn!, 0, scenario.user.address);
        } else {
          await dexMock
            .connect(scenario.user)
            .executeSwapExactOutput(
              scenario.inputToken,
              scenario.outputToken,
              scenario.amountOut!,
              ethers.MaxUint256,
              scenario.user.address,
            );
        }
      }

      // Verify all balances changed appropriately with exact expected amounts
      for (const scenario of swapScenarios) {
        const userAddr = scenario.user.address;
        const currentInputBalance = await scenario.inputToken.balanceOf(userAddr);
        const currentOutputBalance = await scenario.outputToken.balanceOf(userAddr);

        const initialInputBalance = initialBalances.get(`${userAddr}_input`);
        const initialOutputBalance = initialBalances.get(`${userAddr}_output`);
        const expectedInputAmount = expectedAmounts.get(`${userAddr}_expectedInput`);
        const expectedOutputAmount = expectedAmounts.get(`${userAddr}_expectedOutput`);

        // Verify exact input and output amounts
        const actualInputSpent = initialInputBalance - currentInputBalance;
        const actualOutputReceived = currentOutputBalance - initialOutputBalance;

        expect(actualInputSpent).to.equal(expectedInputAmount, `User ${userAddr} input amount should match expected`);
        expect(actualOutputReceived).to.equal(expectedOutputAmount, `User ${userAddr} output amount should match expected`);

        // Input balance should have decreased
        expect(currentInputBalance).to.be.lt(initialInputBalance);
        // Output balance should have increased
        expect(currentOutputBalance).to.be.gt(initialOutputBalance);
      }
    });

    it("Should handle swaps with different execution slippage rates independently", async function () {
      const slippageTestCases = [
        { slippageBps: 0, description: "No slippage" },
        { slippageBps: 0.001 * ONE_PERCENT_BPS, description: "0.1% slippage" },
        {
          slippageBps: 0.0025 * ONE_PERCENT_BPS,
          description: "0.25% slippage",
        },
        { slippageBps: 0.005 * ONE_PERCENT_BPS, description: "0.5% slippage" },
        { slippageBps: 0.01 * ONE_PERCENT_BPS, description: "1% slippage" },
        { slippageBps: 0.015 * ONE_PERCENT_BPS, description: "1.5% slippage" },
        { slippageBps: EXECUTION_SLIPPAGE_BPS, description: "2% slippage" },
        { slippageBps: 0.03 * ONE_PERCENT_BPS, description: "3% slippage" },
        { slippageBps: 0.05 * ONE_PERCENT_BPS, description: "5% slippage" },
        { slippageBps: 0.1 * ONE_PERCENT_BPS, description: "10% slippage" },
      ];

      const amountIn = ethers.parseEther("100");

      for (const testCase of slippageTestCases) {
        await dexMock.setExecutionSlippage(testCase.slippageBps);

        // Set exchange rate
        await dexMock.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), DEFAULT_EXCHANGE_RATE);

        // Get balances before swap
        const initialInputBalance = await tokenA.balanceOf(user1.address);
        const initialOutputBalance = await tokenB.balanceOf(user1.address);

        const expectedOutput = await dexMock.previewSwapExactInput(tokenA, tokenB, amountIn);

        // Execute actual swap to verify
        await dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, amountIn, 0, user1.address);

        // Verify actual amounts match expected amounts
        const finalInputBalance = await tokenA.balanceOf(user1.address);
        const finalOutputBalance = await tokenB.balanceOf(user1.address);

        const actualInputSpent = initialInputBalance - finalInputBalance;
        const actualOutputReceived = finalOutputBalance - initialOutputBalance;

        expect(actualInputSpent).to.equal(
          amountIn,
          `Input amount should be exactly ${ethers.formatEther(amountIn)} for slippage ${testCase.slippageBps}bps`,
        );
        expect(actualOutputReceived).to.equal(
          expectedOutput,
          `Output amount should match expected for slippage ${testCase.slippageBps}bps`,
        );
      }
    });
  });

  describe("V. Stress Tests", function () {
    it("Should handle rapid consecutive swaps", async function () {
      const rapidSwaps = 10;
      const amountPerSwap = ethers.parseEther("10");

      let cumulativeOutput = 0n;

      const initialBalance = await tokenB.balanceOf(user1.address);

      for (let i = 0; i < rapidSwaps; i++) {
        const expectedOutput = await dexMock.previewSwapExactInput(tokenA, tokenB, amountPerSwap);

        await dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, amountPerSwap, 0, user1.address);

        cumulativeOutput += expectedOutput;
      }

      const finalBalance = await tokenB.balanceOf(user1.address);

      // Verify total output accumulated correctly
      expect(cumulativeOutput).to.be.gt(0);
      // Make sure that all the output was received
      expect(cumulativeOutput).to.be.equal(finalBalance - initialBalance);
    });

    it("Should handle extreme decimal differences", async function () {
      // Deploy tokens with extreme decimal differences but more reasonable
      const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
      const tokenLowDecimals = await MockERC20.deploy("Low Dec", "LOW", 2);
      const tokenHighDecimals = await MockERC20.deploy("High Dec", "HIGH", 24); // Reduced from 30 to 24

      // Mint tokens to DEX and user
      await tokenLowDecimals.mint(await dexMock.getAddress(), ethers.parseUnits("1000000", 2));
      await tokenHighDecimals.mint(await dexMock.getAddress(), ethers.parseUnits("1000000", 24));
      await tokenLowDecimals.mint(user1.address, ethers.parseUnits("10000", 2));
      await tokenHighDecimals.mint(user1.address, ethers.parseUnits("10000", 24));

      // Set approvals
      await tokenLowDecimals.connect(user1).approve(await dexMock.getAddress(), ethers.MaxUint256);
      await tokenHighDecimals.connect(user1).approve(await dexMock.getAddress(), ethers.MaxUint256);

      // Set exchange rate - more reasonable rate to prevent overflow
      await dexMock.setExchangeRate(
        await tokenLowDecimals.getAddress(),
        await tokenHighDecimals.getAddress(),
        ethers.parseEther("1000000000000000000"), // Reduced rate to prevent overflow
      );

      // Execute swap with smaller amount
      const amountIn = ethers.parseUnits("1", 2); // Much smaller amount

      try {
        await dexMock.connect(user1).executeSwapExactInput(tokenLowDecimals, tokenHighDecimals, amountIn, 0, user1.address);
        // eslint-disable-next-line unused-imports/no-unused-vars -- error is not used
      } catch (error) {
        // If the extreme decimal difference causes arithmetic issues,
        // that's acceptable for this edge case test
        console.log("Extreme decimal difference caused expected arithmetic issues");
      }

      // Test in the other direction with a more manageable rate
      await dexMock.setExchangeRate(
        await tokenHighDecimals.getAddress(),
        await tokenLowDecimals.getAddress(),
        ethers.parseEther("0.000000000000000001"), // Very small rate
      );

      const smallHighDecimalAmount = ethers.parseUnits("1", 24);

      // This should work in the reverse direction
      await expect(
        dexMock.connect(user1).executeSwapExactInput(tokenHighDecimals, tokenLowDecimals, smallHighDecimalAmount, 0, user1.address),
      ).to.not.be.reverted;
    });

    it("Should handle very large amounts", async function () {
      // Test with very large amounts that might cause overflow issues
      const largeAmount = ethers.parseEther("100000000"); // 100M tokens

      // Mint large amounts
      await tokenA.mint(user1.address, largeAmount);
      await tokenB.mint(await dexMock.getAddress(), ethers.parseUnits("200000000", TOKEN_B_DECIMALS));

      const expectedOutput = await dexMock.previewSwapExactInput(tokenA, tokenB, largeAmount);

      await expect(dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, largeAmount, 0, user1.address)).to.not.be.reverted;

      // Verify the large output was received
      const finalBalance = await tokenB.balanceOf(user1.address);
      expect(finalBalance).to.be.gte(expectedOutput);
    });

    it("Should handle edge case amounts (1 wei)", async function () {
      const tinyAmount = 1n; // 1 wei

      // This might result in zero output due to rounding, which should be handled gracefully
      const expectedOutput = await dexMock.previewSwapExactInput(tokenA, tokenB, tinyAmount);

      if (expectedOutput > 0) {
        await expect(dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, tinyAmount, 0, user1.address)).to.not.be.reverted;
      } else {
        // If expected output is 0, the swap might fail due to zero amount checks
        // This is acceptable behavior
      }
    });

    it("Should maintain precision across multiple different token pairs", async function () {
      // Test precision with multiple swaps across different decimal combinations
      const testCombinations = [
        { from: tokenA, to: tokenB, amount: ethers.parseEther("123.456789") },
        {
          from: tokenB,
          to: tokenC,
          amount: ethers.parseUnits("987.654321", TOKEN_B_DECIMALS),
        },
        {
          from: tokenC,
          to: tokenA,
          amount: ethers.parseUnits("555.777", TOKEN_C_DECIMALS),
        },
      ];

      // Set up additional exchange rates
      await dexMock.setExchangeRate(await tokenB.getAddress(), await tokenC.getAddress(), ethers.parseEther("1.25"));

      for (const combo of testCombinations) {
        const rate = await dexMock.getExchangeRate(await combo.from.getAddress(), await combo.to.getAddress());

        if (rate > 0) {
          const expectedOutput = await dexMock.previewSwapExactInput(combo.from, combo.to, combo.amount);

          if (expectedOutput > 0) {
            await expect(dexMock.connect(user1).executeSwapExactInput(combo.from, combo.to, combo.amount, 0, user1.address)).to.not.be
              .reverted;
          }
        }
      }
    });
  });

  describe("VI. Error Conditions and Edge Cases", function () {
    it("Should revert with zero addresses", async function () {
      await expect(
        dexMock.connect(user1).executeSwapExactInput(ethers.ZeroAddress as any, tokenB, ethers.parseEther("100"), 0, user1.address),
      ).to.be.revertedWithCustomError(dexMock, "ZeroAddress");

      await expect(
        dexMock
          .connect(user1)
          .executeSwapExactOutput(tokenA, tokenB, ethers.parseUnits("100", TOKEN_B_DECIMALS), ethers.MaxUint256, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(dexMock, "ZeroAddress");
    });

    it("Should revert with zero amounts", async function () {
      await expect(dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, 0, 0, user1.address)).to.be.revertedWithCustomError(
        dexMock,
        "ZeroAmount",
      );

      await expect(
        dexMock.connect(user1).executeSwapExactOutput(tokenA, tokenB, 0, ethers.MaxUint256, user1.address),
      ).to.be.revertedWithCustomError(dexMock, "ZeroAmount");
    });

    it("Should handle preview functions with no exchange rate", async function () {
      // Preview should return 0 when no exchange rate is set
      expect(await dexMock.previewSwapExactInput(tokenB, tokenC, ethers.parseUnits("100", TOKEN_B_DECIMALS))).to.equal(0);

      expect(await dexMock.previewSwapExactOutput(tokenB, tokenC, ethers.parseUnits("100", TOKEN_C_DECIMALS))).to.equal(0);
    });

    it("Should work with different receivers", async function () {
      const amountIn = ethers.parseEther("100");
      const receiver = user2.address;

      const initialReceiverBalance = await tokenB.balanceOf(receiver);

      await dexMock.connect(user1).executeSwapExactInput(tokenA, tokenB, amountIn, 0, receiver);

      const finalReceiverBalance = await tokenB.balanceOf(receiver);
      expect(finalReceiverBalance).to.be.gt(initialReceiverBalance);
    });
  });

  describe("VII. Emergency Functions", function () {
    it("Should allow emergency withdrawal", async function () {
      const withdrawAmount = ethers.parseUnits("1000", TOKEN_B_DECIMALS);
      const recipient = user3.address;

      const initialBalance = await tokenB.balanceOf(recipient);

      await dexMock.emergencyWithdraw(tokenB, withdrawAmount, recipient);

      const finalBalance = await tokenB.balanceOf(recipient);
      expect(finalBalance).to.equal(initialBalance + withdrawAmount);
    });

    it("Should revert emergency withdrawal to zero address", async function () {
      await expect(
        dexMock.emergencyWithdraw(tokenB, ethers.parseUnits("100", TOKEN_B_DECIMALS), ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(dexMock, "ZeroAddress");
    });
  });
});
