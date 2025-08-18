import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopDepositorMock,
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
  debtToken: TestERC20FlashMintable; // Changed to flash mintable type
  mockPool: HardhatEthersSigner;
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;
  user3: HardhatEthersSigner;
}

export interface DLoopDepositorMockFixture {
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
 * Deploy the DLoopDepositorMock contract with the mock tokens and mock pool
 *
 * @returns The fixture object containing the contract instances and addresses
 */
export async function deployDLoopDepositorMockFixture(): Promise<{
  dloopCoreMockFixture: DLoopMockFixture;
  dloopDepositorMockFixture: DLoopDepositorMockFixture;
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

  const dloopDepositorMockFixture: DLoopDepositorMockFixture = {
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
    dloopDepositorMockFixture: dloopDepositorMockFixture,
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
 * @param dloopDepositorMockFixture - The dloop depositor mock fixture
 */
export async function testSetup(
  dloopCoreMockFixture: DLoopMockFixture,
  dloopDepositorMockFixture: DLoopDepositorMockFixture,
): Promise<void> {
  const { dloopMock, collateralToken, debtToken, mockPool } =
    dloopCoreMockFixture;
  const { flashLender, simpleDEXMock, user1, user2, user3 } =
    dloopDepositorMockFixture;

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
  const depositorAddress =
    await dloopDepositorMockFixture.dLoopDepositorMock.getAddress();
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
