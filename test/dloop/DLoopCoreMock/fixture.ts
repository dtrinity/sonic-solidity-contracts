import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";

// Test constants
export const TARGET_LEVERAGE_BPS = 300 * ONE_PERCENT_BPS; // 3x leverage
export const LOWER_BOUND_BPS = 200 * ONE_PERCENT_BPS; // 2x leverage
export const UPPER_BOUND_BPS = 400 * ONE_PERCENT_BPS; // 4x leverage
export const MAX_SUBSIDY_BPS = 1 * ONE_PERCENT_BPS; // 1%
export const MIN_DEVIATION_BPS = 2 * ONE_PERCENT_BPS; // 2% deviation
export const DEFAULT_PRICE = 100000000; // 1.0 in 8 decimals
export const COLLATERAL_DECIMALS = 18;
export const DEBT_DECIMALS = 18;

export interface DLoopMockFixture {
  dloopMock: DLoopCoreMock;
  collateralToken: TestMintableERC20;
  debtToken: TestMintableERC20;
  mockPool: HardhatEthersSigner;
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
  user2: HardhatEthersSigner;
  user3: HardhatEthersSigner;
}

/**
 * Deploy the DLoopCoreMock contract with the mock tokens and mock pool
 *
 * @returns The fixture object containing the contract instances and addresses
 */
export async function deployDLoopMockFixture(): Promise<DLoopMockFixture> {
  const accounts = await ethers.getSigners();
  const deployer = accounts[0];
  const user1 = accounts[1];
  const user2 = accounts[2];
  const user3 = accounts[3];
  const mockPool = accounts[10]; // The mock pool address

  // Deploy mock tokens
  const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
  const collateralToken = await MockERC20.deploy("Mock Collateral", "mCOLL", COLLATERAL_DECIMALS);
  const debtToken = await MockERC20.deploy("Mock Debt", "mDEBT", DEBT_DECIMALS);

  // Mint tokens to mock pool (mockVault)
  await collateralToken.mint(mockPool, ethers.parseEther("1000000"));
  await debtToken.mint(mockPool, ethers.parseEther("1000000"));

  // Deploy and link DLoopCoreLogic library before deploying DLoopCoreMock
  const DLoopCoreLogicFactory = await ethers.getContractFactory("DLoopCoreLogic");
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
  await collateralToken.connect(accounts[0]).approve(contractAddress, ethers.MaxUint256);
  await debtToken.connect(accounts[0]).approve(contractAddress, ethers.MaxUint256);

  // Now deploy the contract (linking the DLoopCoreLogic library)
  const DLoopCoreMockFactory = await ethers.getContractFactory("DLoopCoreMock", {
    libraries: {
      "contracts/vaults/dloop/core/DLoopCoreLogic.sol:DLoopCoreLogic": await dloopCoreLogicLib.getAddress(),
    },
  });
  const dloopMock = await DLoopCoreMockFactory.deploy(
    "Mock dLoop Vault",
    "mdLOOP",
    await collateralToken.getAddress(),
    await debtToken.getAddress(),
    TARGET_LEVERAGE_BPS,
    LOWER_BOUND_BPS,
    UPPER_BOUND_BPS,
    MAX_SUBSIDY_BPS,
    MIN_DEVIATION_BPS,
    0, // withdrawalFeeBps
    mockPool,
  );

  return {
    dloopMock: dloopMock as unknown as DLoopCoreMock,
    collateralToken,
    debtToken,
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
 * @param fixture - The fixture object containing the contract instances and addresses
 */
export async function testSetup(fixture: DLoopMockFixture): Promise<void> {
  const { dloopMock, collateralToken, debtToken, accounts, user1, user2, mockPool } = fixture;
  // Set default prices
  await dloopMock.setMockPrice(await collateralToken.getAddress(), DEFAULT_PRICE);
  await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

  // Setup token balances for users
  await collateralToken.mint(user1, ethers.parseEther("10000"));
  await debtToken.mint(user1, ethers.parseEther("10000"));
  await collateralToken.mint(user2, ethers.parseEther("10000"));
  await debtToken.mint(user2, ethers.parseEther("10000"));
  await collateralToken.mint(fixture.user3, ethers.parseEther("10000"));
  await debtToken.mint(fixture.user3, ethers.parseEther("10000"));

  // Setup allowances for users to vault
  const vaultAddress = await dloopMock.getAddress();
  await collateralToken.connect(accounts[1]).approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(accounts[1]).approve(vaultAddress, ethers.MaxUint256);
  await collateralToken.connect(accounts[2]).approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(accounts[2]).approve(vaultAddress, ethers.MaxUint256);
  await collateralToken.connect(accounts[3]).approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(accounts[3]).approve(vaultAddress, ethers.MaxUint256);

  // Set allowance to allow vault to spend tokens from mockPool
  await collateralToken.connect(mockPool).approve(vaultAddress, ethers.MaxUint256);
  await debtToken.connect(mockPool).approve(vaultAddress, ethers.MaxUint256);
}
