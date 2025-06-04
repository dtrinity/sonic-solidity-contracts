import { ethers, deployments, getNamedAccounts } from 'hardhat';
import { expect } from 'chai';
import { ONE_HUNDRED_PERCENT_BPS, ONE_PERCENT_BPS } from '../../typescript/common/bps_constants';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

describe('DLoopCoreMock Comprehensive Tests', function () {
  // Contract instances and addresses
  let dloopMock: any;
  let collateralToken: any;
  let debtToken: any;
  let mockPool: any;
  let deployer: string;
  let user1: string;
  let user2: string;
  let user3: string;
  let accounts: any[];

  // Test constants
  const TARGET_LEVERAGE_BPS = 300 * ONE_PERCENT_BPS; // 3x leverage
  const LOWER_BOUND_BPS = 200 * ONE_PERCENT_BPS; // 2x leverage
  const UPPER_BOUND_BPS = 400 * ONE_PERCENT_BPS; // 4x leverage
  const MAX_SUBSIDY_BPS = 1 * ONE_PERCENT_BPS; // 1%
  const PRICE_DECIMALS = 8;
  const DEFAULT_PRICE = 100000000; // 1.0 in 8 decimals
  const COLLATERAL_DECIMALS = 18;
  const DEBT_DECIMALS = 18;

  async function deployDLoopMockFixture() {
    const accounts = await ethers.getSigners();
    const deployer = accounts[0].address;
    const user1 = accounts[1].address;
    const user2 = accounts[2].address;
    const user3 = accounts[3].address;

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
    const collateralToken = await MockERC20.deploy("Mock Collateral", "mCOLL", COLLATERAL_DECIMALS);
    const debtToken = await MockERC20.deploy("Mock Debt", "mDEBT", DEBT_DECIMALS);
    const mockPool = await MockERC20.deploy("Mock Pool", "mPOOL", 18); // Pool as token holder

    // Deploy DLoopCoreMock
    const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");
    const dloopMock = await DLoopCoreMock.deploy(
      "Mock dLoop Vault",
      "mdLOOP",
      await collateralToken.getAddress(),
      await debtToken.getAddress(),
      TARGET_LEVERAGE_BPS,
      LOWER_BOUND_BPS,
      UPPER_BOUND_BPS,
      MAX_SUBSIDY_BPS,
      await mockPool.getAddress()
    );

    return {
      dloopMock,
      collateralToken,
      debtToken,
      mockPool,
      accounts,
      deployer,
      user1,
      user2,
      user3
    };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    mockPool = fixture.mockPool;
    accounts = fixture.accounts;
    deployer = fixture.deployer;
    user1 = fixture.user1;
    user2 = fixture.user2;
    user3 = fixture.user3;

    // Set default prices
    await dloopMock.setMockPrice(await collateralToken.getAddress(), DEFAULT_PRICE);
    await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);
    
    // Setup mock pool balances (separate from real token balances)
    await dloopMock.setMockPoolBalance(await collateralToken.getAddress(), ethers.parseEther("1000000"));
    await dloopMock.setMockPoolBalance(await debtToken.getAddress(), ethers.parseEther("1000000"));
    
    // Setup token balances for all parties
    const vaultAddress = await dloopMock.getAddress();
    const poolAddress = await mockPool.getAddress();
    
    // Mint tokens to vault (so it can lend them out during borrows)
    await collateralToken.mint(vaultAddress, ethers.parseEther("10000000"));
    await debtToken.mint(vaultAddress, ethers.parseEther("10000000"));
    
    // Mint tokens to mock pool
    await collateralToken.mint(poolAddress, ethers.parseEther("1000000"));
    await debtToken.mint(poolAddress, ethers.parseEther("1000000"));
    
    // Mint tokens to users for testing
    await collateralToken.mint(user1, ethers.parseEther("10000"));
    await debtToken.mint(user1, ethers.parseEther("10000"));
    await collateralToken.mint(user2, ethers.parseEther("10000"));
    await debtToken.mint(user2, ethers.parseEther("10000"));
    
    // Setup allowances for users to vault
    await collateralToken.connect(accounts[1]).approve(vaultAddress, ethers.MaxUint256);
    await debtToken.connect(accounts[1]).approve(vaultAddress, ethers.MaxUint256);
    await collateralToken.connect(accounts[2]).approve(vaultAddress, ethers.MaxUint256);
    await debtToken.connect(accounts[2]).approve(vaultAddress, ethers.MaxUint256);
    
    // Setup allowances for vault to transfer tokens owned by pool address
    // The mockPool is an ERC20 contract, but it also holds collateralToken and debtToken
    // We need the deployer (who controls mockPool) to approve vault to transfer from pool
    // Get signer that can control transfers from mockPool address - this is tricky because
    // mockPool is a contract address, not controlled by any specific signer
    // For testing purposes, we'll transfer tokens from pool to deployer first, 
    // then approve vault to transfer from deployer
  });

  describe('I. Constructor and Initial State', function () {
    interface ConstructorTestCase {
      name: string;
      symbol: string;
      targetLeverageBps: number;
      lowerBoundBps: number;
      upperBoundBps: number;
      maxSubsidyBps: number;
      shouldRevert: boolean;
      expectedError?: string;
    }

    const constructorTestCases: ConstructorTestCase[] = [
      {
        name: "Valid parameters",
        symbol: "TEST",
        targetLeverageBps: 300 * ONE_PERCENT_BPS,
        lowerBoundBps: 200 * ONE_PERCENT_BPS,
        upperBoundBps: 400 * ONE_PERCENT_BPS,
        maxSubsidyBps: 1 * ONE_PERCENT_BPS,
        shouldRevert: false
      },
      {
        name: "Target leverage below 100%",
        symbol: "TEST",
        targetLeverageBps: 50 * ONE_PERCENT_BPS,
        lowerBoundBps: 25 * ONE_PERCENT_BPS,
        upperBoundBps: 75 * ONE_PERCENT_BPS,
        maxSubsidyBps: 1 * ONE_PERCENT_BPS,
        shouldRevert: true,
        expectedError: "Target leverage must be at least 100% in basis points"
      },
      {
        name: "Lower bound >= target leverage",
        symbol: "TEST",
        targetLeverageBps: 300 * ONE_PERCENT_BPS,
        lowerBoundBps: 300 * ONE_PERCENT_BPS,
        upperBoundBps: 400 * ONE_PERCENT_BPS,
        maxSubsidyBps: 1 * ONE_PERCENT_BPS,
        shouldRevert: true,
        expectedError: "InvalidLeverageBounds"
      },
      {
        name: "Target leverage >= upper bound",
        symbol: "TEST",
        targetLeverageBps: 400 * ONE_PERCENT_BPS,
        lowerBoundBps: 200 * ONE_PERCENT_BPS,
        upperBoundBps: 400 * ONE_PERCENT_BPS,
        maxSubsidyBps: 1 * ONE_PERCENT_BPS,
        shouldRevert: true,
        expectedError: "InvalidLeverageBounds"
      }
    ];

    constructorTestCases.forEach((testCase) => {
      it(`Constructor: ${testCase.name}`, async function () {
        const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
        const testCollateral = await MockERC20.deploy("Test Collateral", "tCOLL", 18);
        const testDebt = await MockERC20.deploy("Test Debt", "tDEBT", 18);
        const testPool = await MockERC20.deploy("Test Pool", "tPOOL", 18);

        const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");

        if (testCase.shouldRevert) {
          if (testCase.expectedError === "Target leverage must be at least 100% in basis points") {
            // This case uses reason string revert
            await expect(
              DLoopCoreMock.deploy(
                testCase.name,
                testCase.symbol,
                await testCollateral.getAddress(),
                await testDebt.getAddress(),
                testCase.targetLeverageBps,
                testCase.lowerBoundBps,
                testCase.upperBoundBps,
                testCase.maxSubsidyBps,
                await testPool.getAddress()
              )
            ).to.be.revertedWith(testCase.expectedError);
          } else {
            // InvalidLeverageBounds cases use custom error
            await expect(
              DLoopCoreMock.deploy(
                testCase.name,
                testCase.symbol,
                await testCollateral.getAddress(),
                await testDebt.getAddress(),
                testCase.targetLeverageBps,
                testCase.lowerBoundBps,
                testCase.upperBoundBps,
                testCase.maxSubsidyBps,
                await testPool.getAddress()
              )
            ).to.be.revertedWithCustomError(DLoopCoreMock, testCase.expectedError || "");
          }
        } else {
          const deployedContract = await DLoopCoreMock.deploy(
            testCase.name,
            testCase.symbol,
            await testCollateral.getAddress(),
            await testDebt.getAddress(),
            testCase.targetLeverageBps,
            testCase.lowerBoundBps,
            testCase.upperBoundBps,
            testCase.maxSubsidyBps,
            await testPool.getAddress()
          );

          expect(await deployedContract.name()).to.equal(testCase.name);
          expect(await deployedContract.symbol()).to.equal(testCase.symbol);
          expect(await deployedContract.targetLeverageBps()).to.equal(testCase.targetLeverageBps);
          expect(await deployedContract.lowerBoundTargetLeverageBps()).to.equal(testCase.lowerBoundBps);
          expect(await deployedContract.upperBoundTargetLeverageBps()).to.equal(testCase.upperBoundBps);
          expect(await deployedContract.maxSubsidyBps()).to.equal(testCase.maxSubsidyBps);
          expect(await deployedContract.mockPool()).to.equal(await testPool.getAddress());
        }
      });
    });

    it('Initial state verification', async function () {
      expect(await dloopMock.name()).to.equal("Mock dLoop Vault");
      expect(await dloopMock.symbol()).to.equal("mdLOOP");
      expect(await dloopMock.collateralToken()).to.equal(await collateralToken.getAddress());
      expect(await dloopMock.debtToken()).to.equal(await debtToken.getAddress());
      expect(await dloopMock.targetLeverageBps()).to.equal(TARGET_LEVERAGE_BPS);
      expect(await dloopMock.totalSupply()).to.equal(0);
      expect(await dloopMock.totalAssets()).to.equal(0);
    });
  });

  describe('II. Mock Setup Functions', function () {
    interface MockPriceTestCase {
      description: string;
      asset: string;
      price: number;
      expectedPrice?: number;
    }

    const mockPriceTestCases: MockPriceTestCase[] = [
      {
        description: "Set collateral token price",
        asset: "collateral",
        price: 200000000, // 2.0 in 8 decimals
        expectedPrice: 200000000
      },
      {
        description: "Set debt token price",
        asset: "debt", 
        price: 100000000, // 1.0 in 8 decimals
        expectedPrice: 100000000
      },
      {
        description: "Set zero price",
        asset: "collateral",
        price: 0,
        expectedPrice: 0
      },
      {
        description: "Set high price",
        asset: "debt",
        price: 1000000000000, // Very high price
        expectedPrice: 1000000000000
      }
    ];

    mockPriceTestCases.forEach((testCase) => {
      it(`setMockPrice: ${testCase.description}`, async function () {
        const assetAddress = testCase.asset === "collateral" 
          ? await collateralToken.getAddress() 
          : await debtToken.getAddress();

        await dloopMock.setMockPrice(assetAddress, testCase.price);
        expect(await dloopMock.getMockPrice(assetAddress)).to.equal(testCase.expectedPrice);
      });
    });

    interface MockCollateralTestCase {
      description: string;
      userIndex: number;
      tokenType: string;
      amount: bigint;
      shouldRevert: boolean;
      expectedError?: string;
    }

    const mockCollateralTestCases: MockCollateralTestCase[] = [
      {
        description: "Set collateral for new user",
        userIndex: 1,
        tokenType: "collateral",
        amount: 1000n,
        shouldRevert: false
      },
      {
        description: "Update existing collateral",
        userIndex: 1,
        tokenType: "collateral", 
        amount: 2000n,
        shouldRevert: false
      },
      {
        description: "Set collateral making collateral < debt",
        userIndex: 1,
        tokenType: "collateral",
        amount: 100n, // Will be less than existing debt if debt > 100
        shouldRevert: false, // No longer validates automatically
      }
    ];

    mockCollateralTestCases.forEach((testCase) => {
      it(`setMockCollateral: ${testCase.description}`, async function () {
        const user = accounts[testCase.userIndex].address;
        const tokenAddress = testCase.tokenType === "collateral" 
          ? await collateralToken.getAddress() 
          : await debtToken.getAddress();

        // Pre-setup for the "collateral < debt" test case
        if (testCase.shouldRevert && testCase.expectedError?.includes("collateral is less than debt")) {
          // Set up collateral first to avoid immediate imbalance
          await dloopMock.setMockCollateral(user, tokenAddress, 2000);
          await dloopMock.setMockDebt(user, await debtToken.getAddress(), 1000);
        }

        if (testCase.shouldRevert) {
          await expect(
            dloopMock.setMockCollateral(user, tokenAddress, testCase.amount)
          ).to.be.revertedWith(testCase.expectedError || "");
        } else {
          await dloopMock.setMockCollateral(user, tokenAddress, testCase.amount);
          expect(await dloopMock.getMockCollateral(user, tokenAddress)).to.equal(testCase.amount);
          
          // Check if token was added to user's collateral tokens list
          const collateralTokens = await dloopMock.getMockCollateralTokens(user);
          expect(collateralTokens).to.include(tokenAddress);
        }
      });
    });

    interface MockDebtTestCase {
      description: string;
      userIndex: number;
      tokenType: string;
      amount: bigint;
      shouldRevert: boolean;
      expectedError?: string;
    }

    const mockDebtTestCases: MockDebtTestCase[] = [
      {
        description: "Set debt for new user",
        userIndex: 2,
        tokenType: "debt",
        amount: 500n,
        shouldRevert: false
      },
      {
        description: "Update existing debt",
        userIndex: 2,
        tokenType: "debt",
        amount: 1000n,
        shouldRevert: false
      },
      {
        description: "Set debt making debt > collateral",
        userIndex: 2,
        tokenType: "debt",
        amount: 10000n, // Will be more than existing collateral
        shouldRevert: false, // No longer validates automatically
      }
    ];

    mockDebtTestCases.forEach((testCase) => {
      it(`setMockDebt: ${testCase.description}`, async function () {
        const user = accounts[testCase.userIndex].address;
        const tokenAddress = testCase.tokenType === "debt" 
          ? await debtToken.getAddress() 
          : await collateralToken.getAddress();

        // Pre-setup for the "debt > collateral" test case
        if (testCase.shouldRevert && testCase.expectedError?.includes("collateral is less than debt")) {
          // Set up collateral first to avoid immediate imbalance
          await dloopMock.setMockCollateral(user, await collateralToken.getAddress(), 1000);
        }

        if (testCase.shouldRevert) {
          await expect(
            dloopMock.setMockDebt(user, tokenAddress, testCase.amount)
          ).to.be.revertedWith(testCase.expectedError || "");
        } else {
          await dloopMock.setMockDebt(user, tokenAddress, testCase.amount);
          expect(await dloopMock.getMockDebt(user, tokenAddress)).to.equal(testCase.amount);
          
          // Check if token was added to user's debt tokens list
          const debtTokens = await dloopMock.getMockDebtTokens(user);
          expect(debtTokens).to.include(tokenAddress);
        }
      });
    });
  });

  describe('III. Implementation of Abstract Functions', function () {
    it('testGetAdditionalRescueTokens: returns empty array', async function () {
      const additionalTokens = await dloopMock.testGetAdditionalRescueTokens();
      expect(additionalTokens.length).to.equal(0);
    });

    interface PriceOracleTestCase {
      description: string;
      setupPrice?: number;
      shouldRevert: boolean;
      expectedError?: string;
      expectedPrice?: number;
    }

    const priceOracleTestCases: PriceOracleTestCase[] = [
      {
        description: "Get price for asset with set price",
        setupPrice: 150000000,
        shouldRevert: false,
        expectedPrice: 150000000
      },
      {
        description: "Get price for asset without set price",
        shouldRevert: true,
        expectedError: "Mock price not set"
      },
      {
        description: "Get price for asset with zero price",
        setupPrice: 0,
        shouldRevert: true,
        expectedError: "Mock price not set"
      }
    ];

    priceOracleTestCases.forEach((testCase) => {
      it(`testGetAssetPriceFromOracle: ${testCase.description}`, async function () {
        const testAsset = await collateralToken.getAddress();

        if (testCase.setupPrice !== undefined) {
          await dloopMock.setMockPrice(testAsset, testCase.setupPrice);
        } else {
          // Clear any existing price by deploying fresh asset
          const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
          const freshAsset = await MockERC20.deploy("Fresh Asset", "FRESH", 18);
          const freshAssetAddress = await freshAsset.getAddress();
          
          if (testCase.shouldRevert) {
            await expect(
              dloopMock.testGetAssetPriceFromOracle(freshAssetAddress)
            ).to.be.revertedWith(testCase.expectedError || "");
            return;
          }
        }

        if (testCase.shouldRevert) {
          await expect(
            dloopMock.testGetAssetPriceFromOracle(testAsset)
          ).to.be.revertedWith(testCase.expectedError || "");
        } else {
          const price = await dloopMock.testGetAssetPriceFromOracle(testAsset);
          expect(price).to.equal(testCase.expectedPrice);
        }
      });
    });

    describe('Pool Implementation Functions', function () {
      beforeEach(async function () {
        // All token setup is now handled in main beforeEach
      });

      interface PoolOperationTestCase {
        description: string;
        token: string;
        amount: bigint;
        onBehalfOf: string;
        shouldRevert: boolean;
        expectedError?: string;
        preSetupCollateral?: bigint;
        preSetupDebt?: bigint;
      }

      const supplyTestCases: PoolOperationTestCase[] = [
        {
          description: "Supply collateral token successfully",
          token: "collateral",
          amount: 1000n,
          onBehalfOf: "user1",
          shouldRevert: false
        },
        {
          description: "Supply debt token (should revert)",
          token: "debt",
          amount: 1000n,
          onBehalfOf: "user1",
          shouldRevert: true,
          expectedError: "Mock: debtToken is not supported as collateral"
        }
      ];

      supplyTestCases.forEach((testCase) => {
        it(`testSupplyToPoolImplementation: ${testCase.description}`, async function () {
          const tokenAddress = testCase.token === "collateral" 
            ? await collateralToken.getAddress() 
            : await debtToken.getAddress();
          const onBehalfOfAddress = testCase.onBehalfOf === "user1" ? user1 : await dloopMock.getAddress();

          if (testCase.shouldRevert) {
            await expect(
              dloopMock.testSupplyToPoolImplementation(tokenAddress, testCase.amount, onBehalfOfAddress)
            ).to.be.revertedWith(testCase.expectedError || "");
          } else {
            const tokenContract = await ethers.getContractAt("TestMintableERC20", tokenAddress);
            const poolBalanceBefore = await tokenContract.balanceOf(await mockPool.getAddress());
            const vaultBalanceBefore = await tokenContract.balanceOf(await dloopMock.getAddress());

            await dloopMock.testSupplyToPoolImplementation(tokenAddress, testCase.amount, onBehalfOfAddress);

            expect(await dloopMock.getMockCollateral(onBehalfOfAddress, tokenAddress)).to.equal(testCase.amount);
            
            const poolBalanceAfter = await tokenContract.balanceOf(await mockPool.getAddress());
            const vaultBalanceAfter = await tokenContract.balanceOf(await dloopMock.getAddress());
            
            expect(poolBalanceAfter - poolBalanceBefore).to.equal(testCase.amount);
            expect(vaultBalanceBefore - vaultBalanceAfter).to.equal(testCase.amount);
          }
        });
      });

      const borrowTestCases: PoolOperationTestCase[] = [
        {
          description: "Borrow debt token successfully",
          token: "debt",
          amount: 1000n,
          onBehalfOf: "user1",
          shouldRevert: false
        },
        {
          description: "Borrow more than pool balance",
          token: "debt", 
          amount: ethers.parseEther("2000000"), // More than minted to pool
          onBehalfOf: "user1",
          shouldRevert: true,
          expectedError: "Mock: not enough tokens in pool to borrow"
        }
      ];

      borrowTestCases.forEach((testCase) => {
        it(`testBorrowFromPoolImplementation: ${testCase.description}`, async function () {
          const tokenAddress = testCase.token === "debt" 
            ? await debtToken.getAddress() 
            : await collateralToken.getAddress();
          const onBehalfOfAddress = testCase.onBehalfOf === "user1" ? user1 : await dloopMock.getAddress();

          if (testCase.shouldRevert) {
            await expect(
              dloopMock.testBorrowFromPoolImplementation(tokenAddress, testCase.amount, onBehalfOfAddress)
            ).to.be.revertedWith(testCase.expectedError || "");
          } else {
            const tokenContract = await ethers.getContractAt("TestMintableERC20", tokenAddress);
            const userBalanceBefore = await tokenContract.balanceOf(onBehalfOfAddress);
            const poolBalanceBefore = await dloopMock.getMockPoolBalance(tokenAddress);

            await dloopMock.testBorrowFromPoolImplementation(tokenAddress, testCase.amount, onBehalfOfAddress);

            const userBalanceAfter = await tokenContract.balanceOf(onBehalfOfAddress);
            const poolBalanceAfter = await dloopMock.getMockPoolBalance(tokenAddress);
            
            // Check debt tracking first
            const finalDebt = await dloopMock.getMockDebt(onBehalfOfAddress, tokenAddress);
            expect(finalDebt).to.equal(testCase.amount);
            
            // Then check token transfers
            expect(userBalanceAfter - userBalanceBefore).to.equal(testCase.amount);
            expect(poolBalanceBefore - poolBalanceAfter).to.equal(testCase.amount);
          }
        });
      });

      const repayTestCases: PoolOperationTestCase[] = [
        {
          description: "Repay debt successfully",
          token: "debt",
          amount: 500n,
          onBehalfOf: "user1",
          preSetupDebt: 1000n,
          shouldRevert: false
        },
        {
          description: "Repay more than debt",
          token: "debt",
          amount: 2000n,
          onBehalfOf: "user1", 
          preSetupDebt: 1000n,
          shouldRevert: true,
          expectedError: "Mock: repay exceeds debt"
        }
      ];

      repayTestCases.forEach((testCase) => {
        it(`testRepayDebtToPoolImplementation: ${testCase.description}`, async function () {
          const tokenAddress = await debtToken.getAddress();
          const onBehalfOfAddress = testCase.onBehalfOf === "user1" ? user1 : await dloopMock.getAddress();

          // Setup debt if specified
          if (testCase.preSetupDebt) {
            await dloopMock.setMockDebt(onBehalfOfAddress, tokenAddress, testCase.preSetupDebt);
          }

          // Setup token allowance
          if (onBehalfOfAddress === user1) {
            await debtToken.connect(accounts[1]).approve(await dloopMock.getAddress(), testCase.amount);
          }

          if (testCase.shouldRevert) {
            await expect(
              dloopMock.testRepayDebtToPoolImplementation(tokenAddress, testCase.amount, onBehalfOfAddress)
            ).to.be.revertedWith(testCase.expectedError || "");
          } else {
            const debtBefore = await dloopMock.getMockDebt(onBehalfOfAddress, tokenAddress);
            const poolBalanceBefore = await debtToken.balanceOf(await mockPool.getAddress());

            await dloopMock.testRepayDebtToPoolImplementation(tokenAddress, testCase.amount, onBehalfOfAddress);

            const debtAfter = await dloopMock.getMockDebt(onBehalfOfAddress, tokenAddress);
            const poolBalanceAfter = await debtToken.balanceOf(await mockPool.getAddress());
            
            expect(debtBefore - debtAfter).to.equal(testCase.amount);
            expect(poolBalanceAfter - poolBalanceBefore).to.equal(testCase.amount);
          }
        });
      });
    });
  });

  describe('IV. getTotalCollateralAndDebtOfUserInBase', function () {
    interface TotalCollateralDebtTestCase {
      description: string;
      setupCollateral: Array<{token: string, amount: bigint}>;
      setupDebt: Array<{token: string, amount: bigint}>;
      setupPrices: Array<{token: string, price: number}>;
      expectedCollateralBase: bigint;
      expectedDebtBase: bigint;
      shouldRevert?: boolean;
      expectedError?: string;
    }

    const totalCollateralDebtTestCases: TotalCollateralDebtTestCase[] = [
      {
        description: "No collateral, no debt",
        setupCollateral: [],
        setupDebt: [],
        setupPrices: [],
        expectedCollateralBase: 0n,
        expectedDebtBase: 0n
      },
      {
        description: "Only collateral (single token)",
        setupCollateral: [{token: "collateral", amount: ethers.parseEther("100")}],
        setupDebt: [],
        setupPrices: [{token: "collateral", price: 200000000}], // 2.0
        expectedCollateralBase: 200n * 10n**8n, // 100 * 2.0 in base (8 decimals)
        expectedDebtBase: 0n
      },
      {
        description: "Only debt (single token)",
        setupCollateral: [],
        setupDebt: [{token: "debt", amount: ethers.parseEther("50")}],
        setupPrices: [{token: "debt", price: 100000000}], // 1.0
        expectedCollateralBase: 0n,
        expectedDebtBase: 50n * 10n**8n // 50 * 1.0 in base (8 decimals)
      },
      {
        description: "Both collateral and debt (single tokens)",
        setupCollateral: [{token: "collateral", amount: ethers.parseEther("100")}],
        setupDebt: [{token: "debt", amount: ethers.parseEther("50")}],
        setupPrices: [
          {token: "collateral", price: 200000000}, // 2.0
          {token: "debt", price: 100000000} // 1.0
        ],
        expectedCollateralBase: 200n * 10n**8n, // 100 * 2.0
        expectedDebtBase: 50n * 10n**8n // 50 * 1.0
      },
      {
        description: "Multiple collateral tokens",
        setupCollateral: [
          {token: "collateral", amount: ethers.parseEther("100")},
          {token: "debt", amount: ethers.parseEther("25")} // Using debt token as collateral
        ],
        setupDebt: [],
        setupPrices: [
          {token: "collateral", price: 200000000}, // 2.0
          {token: "debt", price: 100000000} // 1.0
        ],
        expectedCollateralBase: 225n * 10n**8n, // 100*2.0 + 25*1.0 = 225
        expectedDebtBase: 0n
      },
      {
        description: "Multiple debt tokens",
        setupCollateral: [],
        setupDebt: [
          {token: "debt", amount: ethers.parseEther("50")},
          {token: "collateral", amount: ethers.parseEther("10")} // Using collateral token as debt
        ],
        setupPrices: [
          {token: "debt", price: 100000000}, // 1.0
          {token: "collateral", price: 200000000} // 2.0
        ],
        expectedCollateralBase: 0n,
        expectedDebtBase: 70n * 10n**8n // 50*1.0 + 10*2.0 = 70
      },
      {
        description: "Complex case with multiple tokens",
        setupCollateral: [
          {token: "collateral", amount: ethers.parseEther("200")},
          {token: "debt", amount: ethers.parseEther("100")}
        ],
        setupDebt: [
          {token: "debt", amount: ethers.parseEther("150")},
          {token: "collateral", amount: ethers.parseEther("25")}
        ],
        setupPrices: [
          {token: "collateral", price: 300000000}, // 3.0
          {token: "debt", price: 100000000} // 1.0
        ],
        expectedCollateralBase: 700n * 10n**8n, // 200*3.0 + 100*1.0 = 700
        expectedDebtBase: 225n * 10n**8n // 150*1.0 + 25*3.0 = 225
      }
    ];

    totalCollateralDebtTestCases.forEach((testCase) => {
      it(`getTotalCollateralAndDebtOfUserInBase: ${testCase.description}`, async function () {
        const testUser = user1;

        // Setup prices
        for (const priceSetup of testCase.setupPrices) {
          const tokenAddress = priceSetup.token === "collateral" 
            ? await collateralToken.getAddress() 
            : await debtToken.getAddress();
          await dloopMock.setMockPrice(tokenAddress, priceSetup.price);
        }

        // Setup collateral
        for (const collateralSetup of testCase.setupCollateral) {
          const tokenAddress = collateralSetup.token === "collateral" 
            ? await collateralToken.getAddress() 
            : await debtToken.getAddress();
          await dloopMock.setMockCollateral(testUser, tokenAddress, collateralSetup.amount);
        }

        // Setup debt
        for (const debtSetup of testCase.setupDebt) {
          const tokenAddress = debtSetup.token === "debt" 
            ? await debtToken.getAddress() 
            : await collateralToken.getAddress();
          await dloopMock.setMockDebt(testUser, tokenAddress, debtSetup.amount);
        }

        if (testCase.shouldRevert) {
          await expect(
            dloopMock.getTotalCollateralAndDebtOfUserInBase(testUser)
          ).to.be.revertedWith(testCase.expectedError || "");
        } else {
          const [totalCollateralBase, totalDebtBase] = await dloopMock.getTotalCollateralAndDebtOfUserInBase(testUser);
          expect(totalCollateralBase).to.equal(testCase.expectedCollateralBase);
          expect(totalDebtBase).to.equal(testCase.expectedDebtBase);
        }
      });
    });

    it('Price not set for collateral token (should revert)', async function () {
      // Clear the default price set in beforeEach
      await dloopMock.setMockPrice(await collateralToken.getAddress(), 0);
      await dloopMock.setMockCollateral(user1, await collateralToken.getAddress(), ethers.parseEther("100"));
      // Don't set price for collateral token
      
      await expect(
        dloopMock.getTotalCollateralAndDebtOfUserInBase(user1)
      ).to.be.revertedWith("Mock price not set");
    });

    it('Price not set for debt token (should revert)', async function () {
      // Clear the default price set in beforeEach
      await dloopMock.setMockPrice(await debtToken.getAddress(), 0);
      await dloopMock.setMockDebt(user1, await debtToken.getAddress(), ethers.parseEther("50"));
      // Don't set price for debt token
      
      await expect(
        dloopMock.getTotalCollateralAndDebtOfUserInBase(user1)
      ).to.be.revertedWith("Mock price not set");
    });

    describe('Varying Decimals Tests', function () {
      let token6Decimals: any;
      let token8Decimals: any;

      beforeEach(async function () {
        const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
        token6Decimals = await MockERC20.deploy("6 Decimals Token", "6DEC", 6);
        token8Decimals = await MockERC20.deploy("8 Decimals Token", "8DEC", 8);
      });

      interface VaryingDecimalsTestCase {
        description: string;
        tokenDecimals: number;
        amount: string; // Will be parsed according to decimals
        price: number;
        expectedBase: bigint;
      }

      const varyingDecimalsTestCases: VaryingDecimalsTestCase[] = [
        {
          description: "6 decimals token",
          tokenDecimals: 6,
          amount: "100", // 100 units
          price: 200000000, // 2.0 in 8 decimals
          expectedBase: 200n * 10n**8n // 100 * 2.0 in base
        },
        {
          description: "8 decimals token", 
          tokenDecimals: 8,
          amount: "100", // 100 units
          price: 150000000, // 1.5 in 8 decimals
          expectedBase: 150n * 10n**8n // 100 * 1.5 in base
        }
      ];

      varyingDecimalsTestCases.forEach((testCase) => {
        it(`Varying decimals: ${testCase.description}`, async function () {
          const token = testCase.tokenDecimals === 6 ? token6Decimals : token8Decimals;
          const tokenAddress = await token.getAddress();
          const amount = ethers.parseUnits(testCase.amount, testCase.tokenDecimals);

          await dloopMock.setMockPrice(tokenAddress, testCase.price);
          await dloopMock.setMockCollateral(user1, tokenAddress, amount);

          const [totalCollateralBase] = await dloopMock.getTotalCollateralAndDebtOfUserInBase(user1);
          expect(totalCollateralBase).to.equal(testCase.expectedBase);
        });
      });
    });
  });
});
