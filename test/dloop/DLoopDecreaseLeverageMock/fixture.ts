import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopDecreaseLeverageMock,
  SimpleDEXMock,
  TestERC20FlashMintable,
  TestMintableERC20,
} from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";

// Test constants
export const TARGET_LEVERAGE_BPS = 300 * ONE_PERCENT_BPS; // 3x leverage
export const LOWER_BOUND_BPS = 200 * ONE_PERCENT_BPS; // 2x leverage
export const UPPER_BOUND_BPS = 400 * ONE_PERCENT_BPS; // 4x leverage
export const MAX_SUBSIDY_BPS = 1 * ONE_PERCENT_BPS; // 1%
export const DEFAULT_PRICE = 100000000; // 1.0 in 8 decimals
export const COLLATERAL_DECIMALS = 18;
export const DEBT_DECIMALS = 18;

export interface DLoopDecreaseLeverageFixture {
  dloopCoreMock: DLoopCoreMock;
  decreaseLeverageMock: DLoopDecreaseLeverageMock;
  collateralToken: TestMintableERC20;
  debtToken: TestERC20FlashMintable;
  flashLender: TestERC20FlashMintable;
  simpleDEXMock: SimpleDEXMock;
  mockPool: HardhatEthersSigner;
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;
  user3: HardhatEthersSigner;
}

/**
 * Deploy the DLoopDecreaseLeverageMock test environment
 */
export async function deployDLoopDecreaseLeverageFixture(): Promise<DLoopDecreaseLeverageFixture> {
  const accounts = await ethers.getSigners();
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];
  const mockPool = accounts[10]; // The mock pool address

  // Deploy mock tokens
  const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
  const collateralToken = await MockERC20.deploy("Mock Collateral", "mCOLL", COLLATERAL_DECIMALS);

  // Deploy flashmintable debt token (serves as both debt token and flash lender)
  const FlashMintableToken = await ethers.getContractFactory("TestERC20FlashMintable");
  const debtToken = await FlashMintableToken.deploy("Mock Debt", "mDEBT", DEBT_DECIMALS);
  const flashLender = debtToken; // Same contract serves both roles

  // Deploy SimpleDEXMock for swapping
  const SimpleDEXMockFactory = await ethers.getContractFactory("SimpleDEXMock");
  const simpleDEXMock = await SimpleDEXMockFactory.deploy();

  // Mint tokens to mock pool
  await collateralToken.mint(mockPool, ethers.parseEther("1000000"));
  await debtToken.mint(mockPool, ethers.parseEther("1000000"));

  // Deploy and link DLoopCoreLogic library before deploying DLoopCoreMock
  const DLoopCoreLogicFactory = await ethers.getContractFactory("DLoopCoreLogic");
  const dloopCoreLogicLib = await DLoopCoreLogicFactory.deploy();
  await dloopCoreLogicLib.waitForDeployment();

  // Get exact nonce for DLoopCoreMock deployment and set up allowances
  const currentNonce = await ethers.provider.getTransactionCount(deployer);
  const dloopCoreAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: currentNonce + 2, // Account for 2 approve transactions
  });

  // Set up allowances to the predicted DLoopCoreMock address
  await collateralToken.connect(deployer).approve(dloopCoreAddress, ethers.MaxUint256);
  await debtToken.connect(deployer).approve(dloopCoreAddress, ethers.MaxUint256);

  // Deploy DLoopCoreMock (linking the DLoopCoreLogic library)
  const DLoopCoreMockFactory = await ethers.getContractFactory("DLoopCoreMock", {
    libraries: {
      "contracts/vaults/dloop/core/DLoopCoreLogic.sol:DLoopCoreLogic": await dloopCoreLogicLib.getAddress(),
    },
  });
  const dloopCoreMock = await DLoopCoreMockFactory.deploy(
    "Mock dLoop Vault",
    "mdLOOP",
    await collateralToken.getAddress(),
    await debtToken.getAddress(),
    TARGET_LEVERAGE_BPS,
    LOWER_BOUND_BPS,
    UPPER_BOUND_BPS,
    MAX_SUBSIDY_BPS,
    0, // minDeviationBps
    0, // withdrawalFeeBps
    mockPool,
  );

  // Deploy DLoopDecreaseLeverageMock
  const DLoopDecreaseLeverageMockFactory = await ethers.getContractFactory("DLoopDecreaseLeverageMock");
  const decreaseLeverageMock = await DLoopDecreaseLeverageMockFactory.deploy(
    await flashLender.getAddress(),
    await simpleDEXMock.getAddress(),
  );

  return {
    dloopCoreMock: dloopCoreMock as unknown as DLoopCoreMock,
    decreaseLeverageMock,
    collateralToken,
    debtToken,
    flashLender,
    simpleDEXMock,
    mockPool,
    accounts,
    deployer,
    user1,
    user2,
    user3,
  };
}

/**
 * Setup the test environment with prices, balances, and allowances
 *
 * @param fixture Test fixture containing contracts, signers, and helpers
 */
export async function testSetup(fixture: DLoopDecreaseLeverageFixture): Promise<void> {
  const { dloopCoreMock, decreaseLeverageMock, collateralToken, debtToken, simpleDEXMock, user1, user2, user3, mockPool } = fixture;

  // Set default prices in DLoopCoreMock
  await dloopCoreMock.setMockPrice(await collateralToken.getAddress(), DEFAULT_PRICE);
  await dloopCoreMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

  // Set exchange rates in SimpleDEXMock (1:1 for simplicity)
  await simpleDEXMock.setExchangeRate(
    await collateralToken.getAddress(),
    await debtToken.getAddress(),
    ethers.parseEther("1"), // 1 COLL = 1 DEBT
  );
  await simpleDEXMock.setExchangeRate(
    await debtToken.getAddress(),
    await collateralToken.getAddress(),
    ethers.parseEther("1"), // 1 DEBT = 1 COLL
  );

  // Setup token balances for users
  const userBalance = ethers.parseEther("10000");
  await collateralToken.mint(user1, userBalance);
  await debtToken.mint(user1, userBalance);
  await collateralToken.mint(user2, userBalance);
  await debtToken.mint(user2, userBalance);
  await collateralToken.mint(user3, userBalance);
  await debtToken.mint(user3, userBalance);

  // Setup allowances for users to contracts
  const dloopCoreAddress = await dloopCoreMock.getAddress();
  const decreaseLeverageAddress = await decreaseLeverageMock.getAddress();
  const simpleDEXAddress = await simpleDEXMock.getAddress();

  for (const user of [user1, user2, user3]) {
    await collateralToken.connect(user).approve(dloopCoreAddress, ethers.MaxUint256);
    await debtToken.connect(user).approve(dloopCoreAddress, ethers.MaxUint256);
    await collateralToken.connect(user).approve(decreaseLeverageAddress, ethers.MaxUint256);
    await debtToken.connect(user).approve(decreaseLeverageAddress, ethers.MaxUint256);
    await collateralToken.connect(user).approve(simpleDEXAddress, ethers.MaxUint256);
    await debtToken.connect(user).approve(simpleDEXAddress, ethers.MaxUint256);
  }

  // Set allowances for mockPool to spend tokens from contracts
  await collateralToken.connect(mockPool).approve(dloopCoreAddress, ethers.MaxUint256);
  await debtToken.connect(mockPool).approve(dloopCoreAddress, ethers.MaxUint256);
  await collateralToken.connect(mockPool).approve(simpleDEXAddress, ethers.MaxUint256);
  await debtToken.connect(mockPool).approve(simpleDEXAddress, ethers.MaxUint256);

  // Mint tokens to SimpleDEXMock for swapping
  const dexBalance = ethers.parseEther("100000");
  await collateralToken.mint(simpleDEXAddress, dexBalance);
  await debtToken.mint(simpleDEXAddress, dexBalance);
}

/**
 * Create a leveraged position for testing decrease leverage functionality
 *
 * @param fixture Test fixture with deployed contracts and signers
 * @param user User who will create the leveraged position
 * @param depositAmount Amount of collateral to deposit
 */
export async function createLeveragePosition(
  fixture: DLoopDecreaseLeverageFixture,
  user: HardhatEthersSigner,
  depositAmount: bigint,
): Promise<{ shares: bigint; borrowedDebt: bigint }> {
  const { dloopCoreMock } = fixture;

  const sharesBefore = await dloopCoreMock.balanceOf(user.address);
  const debtBefore = await fixture.debtToken.balanceOf(user.address);

  // Deposit collateral to create leveraged position
  await dloopCoreMock.connect(user).deposit(depositAmount, user.address);

  const sharesAfter = await dloopCoreMock.balanceOf(user.address);
  const debtAfter = await fixture.debtToken.balanceOf(user.address);

  const shares = sharesAfter - sharesBefore;
  const borrowedDebt = debtAfter - debtBefore;

  return { shares, borrowedDebt };
}

/**
 * Create an imbalanced leveraged position that requires decrease leverage
 *
 * @param fixture Test fixture with deployed contracts and signers
 * @param user User who will create the leveraged position
 * @param depositAmount Amount of collateral to deposit
 */
export async function createImbalancedLeveragePosition(
  fixture: DLoopDecreaseLeverageFixture,
  user: HardhatEthersSigner,
  depositAmount: bigint,
): Promise<{
  shares: bigint;
  borrowedDebt: bigint;
  leverageBefore: bigint;
  leverageAfter: bigint;
}> {
  const { dloopCoreMock, collateralToken, debtToken } = fixture;

  // 1. Set initial balanced prices (1:1)
  await dloopCoreMock.setMockPrice(await collateralToken.getAddress(), DEFAULT_PRICE);
  await dloopCoreMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

  // 2. Create initial leveraged position at target leverage
  const { shares, borrowedDebt } = await createLeveragePosition(fixture, user, depositAmount);

  // 3. Verify initial leverage is at target
  const leverageBefore = await dloopCoreMock.getCurrentLeverageBps();

  // 4. Create imbalance by reducing collateral price (simulating market drop)
  // This increases leverage above target, requiring decrease leverage
  const newCollateralPrice = Math.floor(DEFAULT_PRICE * 0.85); // 15% price drop
  await dloopCoreMock.setMockPrice(await collateralToken.getAddress(), newCollateralPrice);

  // 5. Verify leverage is now above target
  const leverageAfter = await dloopCoreMock.getCurrentLeverageBps();

  return { shares, borrowedDebt, leverageBefore, leverageAfter };
}
