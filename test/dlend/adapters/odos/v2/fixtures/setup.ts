import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  BaseOdosAdapterV2Harness,
  PendleSwapLogicHarness,
  SwapExecutorV2Harness,
  MockOdosRouterV2,
  MockPendleRouter,
  MockPTToken,
  TestMintableERC20,
  MockPoolAddressesProvider,
  MockPoolV2,
  MockPriceOracleGetterV2
} from "../../../../../../typechain-types";

/**
 * Interface for the V2 test fixture
 */
export interface OdosV2TestFixture {
  // Signers
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;

  // Mock routers
  odosRouter: MockOdosRouterV2;
  pendleRouter: MockPendleRouter;

  // Test harnesses
  baseAdapterHarness: BaseOdosAdapterV2Harness;
  pendleLogicHarness: PendleSwapLogicHarness;
  swapExecutorHarness: SwapExecutorV2Harness;

  // Mock tokens
  tokenA: TestMintableERC20; // Regular ERC20 token
  tokenB: TestMintableERC20; // Regular ERC20 token
  ptTokenA: MockPTToken;     // PT token for tokenA
  ptTokenB: MockPTToken;     // PT token for tokenB
  syTokenA: TestMintableERC20; // SY token for PT tokenA
  syTokenB: TestMintableERC20; // SY token for PT tokenB

  // Mock dLend contracts
  addressesProvider: MockPoolAddressesProvider;
  pool: MockPoolV2;
  priceOracle: MockPriceOracleGetterV2;
}

/**
 * Deploy all contracts needed for V2 Odos adapter testing
 */
export async function deployOdosV2TestFixture(): Promise<OdosV2TestFixture> {
  const [deployer, user1, user2] = await ethers.getSigners();

  // Deploy mock routers
  const MockOdosRouterV2Factory = await ethers.getContractFactory("MockOdosRouterV2");
  const odosRouter = await MockOdosRouterV2Factory.deploy();

  const MockPendleRouterFactory = await ethers.getContractFactory("MockPendleRouter");
  const pendleRouter = await MockPendleRouterFactory.deploy();

  // Deploy mock dLend contracts - pool and oracle first
  const MockPoolV2Factory = await ethers.getContractFactory("MockPoolV2");
  const pool = await MockPoolV2Factory.deploy();

  const MockPriceOracleGetterV2Factory = await ethers.getContractFactory("MockPriceOracleGetterV2");
  const priceOracle = await MockPriceOracleGetterV2Factory.deploy();

  // Deploy addresses provider with pool and oracle addresses
  const MockPoolAddressesProviderFactory = await ethers.getContractFactory("MockPoolAddressesProvider");
  const addressesProvider = await MockPoolAddressesProviderFactory.deploy(
    await pool.getAddress(),
    await priceOracle.getAddress()
  );

  // Deploy test tokens
  const TestMintableERC20Factory = await ethers.getContractFactory("TestMintableERC20");

  const tokenA = await TestMintableERC20Factory.deploy("Token A", "TKA", 18);
  const tokenB = await TestMintableERC20Factory.deploy("Token B", "TKB", 18);
  const syTokenA = await TestMintableERC20Factory.deploy("SY Token A", "SYA", 18);
  const syTokenB = await TestMintableERC20Factory.deploy("SY Token B", "SYB", 18);

  // Deploy PT tokens
  const MockPTTokenFactory = await ethers.getContractFactory("MockPTToken");
  const ptTokenA = await MockPTTokenFactory.deploy("PT Token A", "PTA", await syTokenA.getAddress());
  const ptTokenB = await MockPTTokenFactory.deploy("PT Token B", "PTB", await syTokenB.getAddress());

  // Deploy test harnesses
  const BaseOdosAdapterV2HarnessFactory = await ethers.getContractFactory("BaseOdosAdapterV2Harness");
  const baseAdapterHarness = await BaseOdosAdapterV2HarnessFactory.deploy(
    await addressesProvider.getAddress(),
    await pool.getAddress(),
    await odosRouter.getAddress(),
    await pendleRouter.getAddress()
  );

  const PendleSwapLogicHarnessFactory = await ethers.getContractFactory("PendleSwapLogicHarness");
  const pendleLogicHarness = await PendleSwapLogicHarnessFactory.deploy();

  const SwapExecutorV2HarnessFactory = await ethers.getContractFactory("SwapExecutorV2Harness");
  const swapExecutorHarness = await SwapExecutorV2HarnessFactory.deploy();

  return {
    deployer,
    user1,
    user2,
    odosRouter,
    pendleRouter,
    baseAdapterHarness,
    pendleLogicHarness,
    swapExecutorHarness,
    tokenA,
    tokenB,
    ptTokenA,
    ptTokenB,
    syTokenA,
    syTokenB,
    addressesProvider,
    pool,
    priceOracle
  };
}

/**
 * Setup test environment with token balances and approvals
 */
export async function setupTestEnvironment(fixture: OdosV2TestFixture) {
  const {
    deployer, user1, user2,
    tokenA, tokenB, ptTokenA, ptTokenB, syTokenA, syTokenB,
    odosRouter, pendleRouter, baseAdapterHarness
  } = fixture;

  const initialMintAmount = ethers.parseEther("1000000");

  // Mint tokens to users
  await tokenA.mint(user1.address, initialMintAmount);
  await tokenB.mint(user1.address, initialMintAmount);
  await ptTokenA.mint(user1.address, initialMintAmount);
  await ptTokenB.mint(user1.address, initialMintAmount);
  await syTokenA.mint(user1.address, initialMintAmount);
  await syTokenB.mint(user1.address, initialMintAmount);

  await tokenA.mint(user2.address, initialMintAmount);
  await tokenB.mint(user2.address, initialMintAmount);
  await ptTokenA.mint(user2.address, initialMintAmount);
  await ptTokenB.mint(user2.address, initialMintAmount);
  await syTokenA.mint(user2.address, initialMintAmount);
  await syTokenB.mint(user2.address, initialMintAmount);

  // Mint tokens to routers for swaps
  await tokenA.mint(await odosRouter.getAddress(), initialMintAmount);
  await tokenB.mint(await odosRouter.getAddress(), initialMintAmount);
  await ptTokenA.mint(await odosRouter.getAddress(), initialMintAmount);
  await ptTokenB.mint(await odosRouter.getAddress(), initialMintAmount);
  await syTokenA.mint(await odosRouter.getAddress(), initialMintAmount);
  await syTokenB.mint(await odosRouter.getAddress(), initialMintAmount);

  await tokenA.mint(await pendleRouter.getAddress(), initialMintAmount);
  await tokenB.mint(await pendleRouter.getAddress(), initialMintAmount);
  await ptTokenA.mint(await pendleRouter.getAddress(), initialMintAmount);
  await ptTokenB.mint(await pendleRouter.getAddress(), initialMintAmount);
  await syTokenA.mint(await pendleRouter.getAddress(), initialMintAmount);
  await syTokenB.mint(await pendleRouter.getAddress(), initialMintAmount);

  // Mint tokens to test harnesses for testing
  await tokenA.mint(await baseAdapterHarness.getAddress(), initialMintAmount);
  await tokenB.mint(await baseAdapterHarness.getAddress(), initialMintAmount);
  await ptTokenA.mint(await baseAdapterHarness.getAddress(), initialMintAmount);
  await ptTokenB.mint(await baseAdapterHarness.getAddress(), initialMintAmount);

  // Also mint to other harnesses
  const { pendleLogicHarness, swapExecutorHarness } = fixture;
  await tokenA.mint(await pendleLogicHarness.getAddress(), initialMintAmount);
  await tokenB.mint(await pendleLogicHarness.getAddress(), initialMintAmount);
  await ptTokenA.mint(await pendleLogicHarness.getAddress(), initialMintAmount);
  await ptTokenB.mint(await pendleLogicHarness.getAddress(), initialMintAmount);
  await syTokenA.mint(await pendleLogicHarness.getAddress(), initialMintAmount);
  await syTokenB.mint(await pendleLogicHarness.getAddress(), initialMintAmount);

  await tokenA.mint(await swapExecutorHarness.getAddress(), initialMintAmount);
  await tokenB.mint(await swapExecutorHarness.getAddress(), initialMintAmount);
  await ptTokenA.mint(await swapExecutorHarness.getAddress(), initialMintAmount);
  await ptTokenB.mint(await swapExecutorHarness.getAddress(), initialMintAmount);
  await syTokenA.mint(await swapExecutorHarness.getAddress(), initialMintAmount);
  await syTokenB.mint(await swapExecutorHarness.getAddress(), initialMintAmount);
}

/**
 * Create swap data for testing
 */
export function createOdosSwapData(mockRouter: MockOdosRouterV2): string {
  return mockRouter.interface.encodeFunctionData("performSwap");
}

/**
 * Create Pendle swap data for testing  
 */
export function createPendleSwapData(
  mockRouter: MockPendleRouter,
  tokenIn: string = ethers.ZeroAddress,
  tokenOut: string = ethers.ZeroAddress,
  amountIn: bigint = 0n
): string {
  return mockRouter.interface.encodeFunctionData("executeSwap", [
    tokenIn,
    tokenOut,
    amountIn
  ]);
}

/**
 * Create PTSwapDataV2 structure for testing
 */
export interface PTSwapDataV2 {
  isComposed: boolean;
  underlyingAsset: string;
  pendleCalldata: string;
  odosCalldata: string;
}

export function createPTSwapData(
  isComposed: boolean,
  underlyingAsset: string = ethers.ZeroAddress,
  pendleCalldata: string = "0x",
  odosCalldata: string = "0x"
): PTSwapDataV2 {
  return {
    isComposed,
    underlyingAsset,
    pendleCalldata,
    odosCalldata
  };
}

/**
 * Encode PTSwapDataV2 for contract calls
 */
export function encodePTSwapData(swapData: PTSwapDataV2): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bool,address,bytes,bytes)"],
    [[swapData.isComposed, swapData.underlyingAsset, swapData.pendleCalldata, swapData.odosCalldata]]
  );
}
