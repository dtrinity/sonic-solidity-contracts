import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopDepositorMock,
  DLoopRedeemerMock,
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

export interface DLoopMockFixture {
  dloopMock: DLoopCoreMock;
  collateralToken: TestMintableERC20;
  debtToken: TestERC20FlashMintable;
  mockPool: HardhatEthersSigner;
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;
  user3: HardhatEthersSigner;
}

export interface DLoopRedeemerMockFixture {
  dLoopRedeemerMock: DLoopRedeemerMock;
  dLoopDepositorMock: DLoopDepositorMock;
  flashLender: TestERC20FlashMintable;
  simpleDEXMock: SimpleDEXMock;
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;
  user3: HardhatEthersSigner;
}

/**
 * Deploy the DLoopRedeemerMock contract with the mock tokens and mock pool
 *
 * @returns The fixture object containing the contract instances and addresses
 */
export async function deployDLoopRedeemerMockFixture(): Promise<{
  dloopCoreMockFixture: DLoopMockFixture;
  dloopRedeemerMockFixture: DLoopRedeemerMockFixture;
}> {
  // Deploy the dLoopCore mock
  const dloopCoreMockFixture = await deployDLoopMockLogic();

  const accounts = await ethers.getSigners();
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];

  // Use the debt token from dLoopCore as the flash lender
  // The debt token is already a TestERC20FlashMintable, so we can use it directly
  const flashLender = dloopCoreMockFixture.debtToken as TestERC20FlashMintable;

  // Deploy SimpleDEXMock
  const SimpleDEXMockFactory = await ethers.getContractFactory("SimpleDEXMock");
  const simpleDEXMock = await SimpleDEXMockFactory.deploy();
  await simpleDEXMock.waitForDeployment();

  // Deploy DLoopDepositorMock
  const DLoopDepositorMockFactory =
    await ethers.getContractFactory("DLoopDepositorMock");
  const dLoopDepositorMock = await DLoopDepositorMockFactory.deploy(
    await flashLender.getAddress(),
    await simpleDEXMock.getAddress(),
  );
  await dLoopDepositorMock.waitForDeployment();

  // Deploy DLoopRedeemerMock
  const DLoopRedeemerMockFactory =
    await ethers.getContractFactory("DLoopRedeemerMock");
  const dLoopRedeemerMock = await DLoopRedeemerMockFactory.deploy(
    await flashLender.getAddress(),
    await simpleDEXMock.getAddress(),
  );
  await dLoopRedeemerMock.waitForDeployment();

  const dloopRedeemerMockFixture: DLoopRedeemerMockFixture = {
    dLoopRedeemerMock,
    dLoopDepositorMock,
    flashLender,
    simpleDEXMock,
    accounts,
    deployer,
    user1,
    user2,
    user3,
  };

  return {
    dloopCoreMockFixture: dloopCoreMockFixture,
    dloopRedeemerMockFixture: dloopRedeemerMockFixture,
  };
}

/**
 * Deploy the DLoopCoreMock contract with the mock tokens and mock pool
 *
 * @returns The fixture object containing the contract instances and addresses
 */
export async function deployDLoopMockLogic(): Promise<DLoopMockFixture> {
  const accounts = await ethers.getSigners();
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];
  const mockPool = accounts[10]; // The mock pool address

  // Deploy mock tokens
  const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
  const collateralToken = await MockERC20.deploy(
    "Mock Collateral",
    "mCOLL",
    COLLATERAL_DECIMALS,
  );

  // Deploy debt token using TestERC20FlashMintable so it can act as flash lender
  const FlashMintableERC20 = await ethers.getContractFactory(
    "TestERC20FlashMintable",
  );
  const debtToken = await FlashMintableERC20.deploy(
    "Mock Debt",
    "mDEBT",
    DEBT_DECIMALS,
  );

  // Mint tokens to mock pool (mockVault)
  await collateralToken.mint(mockPool, ethers.parseEther("1000000"));
  await debtToken.mint(mockPool, ethers.parseEther("1000000"));

  // Deploy and link DLoopCoreLogic library before deploying DLoopCoreMock
  const DLoopCoreLogicFactory =
    await ethers.getContractFactory("DLoopCoreLogic");
  const dloopCoreLogicLib = await DLoopCoreLogicFactory.deploy();
  await dloopCoreLogicLib.waitForDeployment();

  // Get the exact nonce for deployment and set up allowances correctly
  const currentNonce = await ethers.provider.getTransactionCount(deployer);

  // We'll have 2 approve transactions, so deployment will be at currentNonce + 2
  const contractAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: currentNonce + 2,
  });

  // Set up allowances to the predicted contract address
  await collateralToken
    .connect(accounts[0])
    .approve(contractAddress, ethers.MaxUint256);
  await debtToken
    .connect(accounts[0])
    .approve(contractAddress, ethers.MaxUint256);

  // Now deploy the contract (linking the DLoopCoreLogic library)
  const DLoopCoreMockFactory = await ethers.getContractFactory(
    "DLoopCoreMock",
    {
      libraries: {
        "contracts/vaults/dloop/core/DLoopCoreLogic.sol:DLoopCoreLogic":
          await dloopCoreLogicLib.getAddress(),
      },
    },
  );
  const dloopMock = await DLoopCoreMockFactory.deploy(
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

  return {
    dloopMock: dloopMock as unknown as DLoopCoreMock,
    collateralToken,
    debtToken: debtToken as unknown as TestERC20FlashMintable,
    mockPool,
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
 * @param dloopCoreMockFixture - The dloop core mock fixture
 * @param dloopRedeemerMockFixture - The dloop redeemer mock fixture
 */
export async function testSetup(
  dloopCoreMockFixture: DLoopMockFixture,
  dloopRedeemerMockFixture: DLoopRedeemerMockFixture,
): Promise<void> {
  const { dloopMock, collateralToken, debtToken, mockPool } =
    dloopCoreMockFixture;
  const {
    flashLender,
    simpleDEXMock,
    dLoopDepositorMock,
    user1,
    user2,
    user3,
  } = dloopRedeemerMockFixture;

  // Set default prices
  await dloopMock.setMockPrice(
    await collateralToken.getAddress(),
    DEFAULT_PRICE,
  );
  await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

  // Setup token balances for users
  const initialUserBalance = ethers.parseEther("10000");
  await collateralToken.mint(user1, initialUserBalance);
  await debtToken.mint(user1, initialUserBalance);
  await collateralToken.mint(user2, initialUserBalance);
  await debtToken.mint(user2, initialUserBalance);
  await collateralToken.mint(user3, initialUserBalance);
  await debtToken.mint(user3, initialUserBalance);

  // Setup allowances for users to vault
  const vaultAddress = await dloopMock.getAddress();
  await collateralToken.connect(user1).approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(user1).approve(vaultAddress, ethers.MaxUint256);
  await collateralToken.connect(user2).approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(user2).approve(vaultAddress, ethers.MaxUint256);
  await collateralToken.connect(user3).approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(user3).approve(vaultAddress, ethers.MaxUint256);

  // Set allowance to allow vault to spend tokens from mockPool
  await collateralToken
    .connect(mockPool)
    .approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(mockPool).approve(vaultAddress, ethers.MaxUint256);

  // Setup allowances for depositor mock
  const depositorAddress = await dLoopDepositorMock.getAddress();
  await collateralToken
    .connect(user1)
    .approve(depositorAddress, ethers.MaxUint256);
  await debtToken.connect(user1).approve(depositorAddress, ethers.MaxUint256);
  await collateralToken
    .connect(user2)
    .approve(depositorAddress, ethers.MaxUint256);
  await debtToken.connect(user2).approve(depositorAddress, ethers.MaxUint256);
  await collateralToken
    .connect(user3)
    .approve(depositorAddress, ethers.MaxUint256);
  await debtToken.connect(user3).approve(depositorAddress, ethers.MaxUint256);

  // Setup allowances for redeemer mock
  const redeemerAddress =
    await dloopRedeemerMockFixture.dLoopRedeemerMock.getAddress();
  await collateralToken
    .connect(user1)
    .approve(redeemerAddress, ethers.MaxUint256);
  await debtToken.connect(user1).approve(redeemerAddress, ethers.MaxUint256);
  await collateralToken
    .connect(user2)
    .approve(redeemerAddress, ethers.MaxUint256);
  await debtToken.connect(user2).approve(redeemerAddress, ethers.MaxUint256);
  await collateralToken
    .connect(user3)
    .approve(redeemerAddress, ethers.MaxUint256);
  await debtToken.connect(user3).approve(redeemerAddress, ethers.MaxUint256);

  // Users need to approve dLoopMock to spend their shares for redeeming
  await dloopMock.connect(user1).approve(redeemerAddress, ethers.MaxUint256);
  await dloopMock.connect(user2).approve(redeemerAddress, ethers.MaxUint256);
  await dloopMock.connect(user3).approve(redeemerAddress, ethers.MaxUint256);

  // Setup SimpleDEXMock
  // Set up token balances in DEX for swapping
  const dexAddress = await simpleDEXMock.getAddress();
  await collateralToken.mint(dexAddress, ethers.parseEther("1000000"));
  await debtToken.mint(dexAddress, ethers.parseEther("1000000"));

  // Set exchange rates: 1 debt token = 1 collateral token (1:1 rate)
  const exchangeRate = ethers.parseEther("1.0");
  await simpleDEXMock.setExchangeRate(
    await debtToken.getAddress(),
    await collateralToken.getAddress(),
    exchangeRate,
  );
  await simpleDEXMock.setExchangeRate(
    await collateralToken.getAddress(),
    await debtToken.getAddress(),
    exchangeRate,
  );

  // Set minimal execution slippage (0.1%)
  await simpleDEXMock.setExecutionSlippage(10); // 10 basis points = 0.1%

  // Setup flash lender (mint tokens for flash loans)
  // The flash lender is the debt token, so mint tokens to itself for flash loans
  await flashLender.mint(
    await flashLender.getAddress(),
    ethers.parseEther("1000000"),
  );
}

/**
 * Helper function to create a leveraged position using the depositor
 * This is needed for testing redeem functionality
 *
 * @param dloopMock - The DLoopCoreMock instance
 * @param collateralToken - The collateral token instance
 * @param debtToken - The debt token instance
 * @param dLoopDepositorMock - The depositor mock for creating leveraged positions
 * @param user - The user to create position for
 * @param depositAmount - The amount to deposit
 * @returns Object containing shares and leveraged amount
 */
export async function createPosition(
  dloopMock: DLoopCoreMock,
  collateralToken: TestMintableERC20,
  debtToken: TestERC20FlashMintable,
  dLoopDepositorMock: DLoopDepositorMock,
  user: HardhatEthersSigner,
  depositAmount: bigint,
): Promise<{ shares: bigint; leveragedAmount: bigint }> {
  // Get initial balances
  const initialShareBalance = await dloopMock.balanceOf(user.address);

  // Calculate expected leveraged amount
  const leveragedAmount = await dLoopDepositorMock.getLeveragedAssets(
    depositAmount,
    dloopMock,
  );

  // Calculate minOutputShares based on leveraged amount (with 5% slippage tolerance)
  const expectedShares = await dloopMock.previewDeposit(leveragedAmount);
  const minOutputShares = (expectedShares * 95n) / 100n; // 5% slippage tolerance

  // Perform leveraged deposit using the depositor mock
  await dLoopDepositorMock
    .connect(user)
    .deposit(depositAmount, user.address, minOutputShares, "0x", dloopMock);

  // Get final share balance
  const finalShareBalance = await dloopMock.balanceOf(user.address);
  const actualShares = finalShareBalance - initialShareBalance;

  // Verify the deposit was successful
  expect(actualShares).to.be.gt(0);
  expect(actualShares).to.be.gte(minOutputShares);

  return {
    shares: actualShares,
    leveragedAmount: leveragedAmount,
  };
}
