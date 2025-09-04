import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopIncreaseLeverageMock,
  DLoopQuoter,
  SimpleDEXMock,
  TestERC20FlashMintable,
  TestMintableERC20,
} from "../../../typechain-types";
// Re-use the helper that deploys the DLoopCore mock and common constants
import { DEFAULT_PRICE, deployDLoopMockLogic, TARGET_LEVERAGE_BPS } from "../DLoopDepositorMock/fixtures";

export interface DLoopIncreaseLeverageMockFixture {
  dloopMock: DLoopCoreMock;
  quoter: DLoopQuoter;
  increaseLeverageMock: DLoopIncreaseLeverageMock;
  collateralToken: TestMintableERC20;
  debtToken: TestERC20FlashMintable;
  simpleDEXMock: SimpleDEXMock;
  mockPool: HardhatEthersSigner;
  accounts: HardhatEthersSigner[];
  deployer: HardhatEthersSigner;
  user1: HardhatEthersSigner;
}

/**
 * Deploys a DLoopCoreMock together with the periphery contract (DLoopIncreaseLeverageMock)
 * and all supporting mocks needed for tests that reproduce the double-counting bug.
 */
export async function deployDLoopIncreaseLeverageMockFixture(): Promise<DLoopIncreaseLeverageMockFixture> {
  // Base core deployment (collateral/debt tokens, mock pool, etc.)
  const coreFixture = await deployDLoopMockLogic();

  const { dloopMock, collateralToken, debtToken, mockPool, accounts, deployer } = coreFixture;
  const user1 = accounts[1];

  // Deploy SimpleDEXMock – the swap venue used by the periphery helper
  const SimpleDEXMockFactory = await ethers.getContractFactory("SimpleDEXMock");
  const simpleDEXMock = (await SimpleDEXMockFactory.deploy()) as SimpleDEXMock;
  await simpleDEXMock.waitForDeployment();

  // 1-to-1 exchange rate so swaps are deterministic (not strictly needed for this test)
  await simpleDEXMock.setExchangeRate(await debtToken.getAddress(), await collateralToken.getAddress(), ethers.parseEther("1.0"));

  // Deploy the periphery increase-leverage helper, using the debt token as flash-lender
  const IncreaseMockFactory = await ethers.getContractFactory("DLoopIncreaseLeverageMock");
  const increaseLeverageMock = (await IncreaseMockFactory.deploy(
    await debtToken.getAddress(),
    await simpleDEXMock.getAddress(),
  )) as DLoopIncreaseLeverageMock;
  await increaseLeverageMock.waitForDeployment();

  // Deploy DLoopQuoter
  const dloopCoreLogicFactory = await ethers.getContractFactory("DLoopCoreLogic");
  const dloopCoreLogic = await dloopCoreLogicFactory.deploy();

  const DLoopQuoterFactory = await ethers.getContractFactory("DLoopQuoter", {
    libraries: {
      DLoopCoreLogic: await dloopCoreLogic.getAddress(),
    },
  });
  const quoter = await DLoopQuoterFactory.deploy();

  /* --------------------------------------------------------------
   * Basic environment setup – mint tokens & approvals
   * ------------------------------------------------------------ */

  const initialUserBalance = ethers.parseEther("10000");
  await collateralToken.mint(user1, initialUserBalance);
  await debtToken.mint(user1, initialUserBalance);

  // Approve vault (core) and periphery helper to move user tokens
  await collateralToken.connect(user1).approve(await dloopMock.getAddress(), ethers.MaxUint256);
  await debtToken.connect(user1).approve(await dloopMock.getAddress(), ethers.MaxUint256);
  await collateralToken.connect(user1).approve(await increaseLeverageMock.getAddress(), ethers.MaxUint256);
  await debtToken.connect(user1).approve(await increaseLeverageMock.getAddress(), ethers.MaxUint256);

  // Set up allowances for mock pool to spend tokens on vault's behalf
  await collateralToken.connect(mockPool).approve(await dloopMock.getAddress(), ethers.MaxUint256);
  await debtToken.connect(mockPool).approve(await dloopMock.getAddress(), ethers.MaxUint256);

  // Set up DEX with tokens for swapping
  const dexAddress = await simpleDEXMock.getAddress();
  await collateralToken.mint(dexAddress, ethers.parseEther("1000000"));
  await debtToken.mint(dexAddress, ethers.parseEther("1000000"));

  // Initialise oracle prices at 1:1 so starting leverage == target
  await dloopMock.setMockPrice(await collateralToken.getAddress(), DEFAULT_PRICE);
  await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

  // Make an initial user deposit to establish a position in the vault
  await dloopMock.connect(user1).deposit(ethers.parseEther("100"), user1.address);

  return {
    dloopMock,
    quoter,
    increaseLeverageMock,
    collateralToken,
    debtToken,
    simpleDEXMock,
    mockPool,
    accounts,
    deployer,
    user1,
  };
}

/**
 * Create a leverage position that requires increase leverage
 *
 * @param fixture Test fixture with deployed contracts and signers
 * @param user User who will create the leveraged position
 * @param depositAmount Amount of collateral to deposit
 */
export async function createLeverageIncreaseScenario(
  fixture: DLoopIncreaseLeverageMockFixture,
  user: HardhatEthersSigner,
  depositAmount: bigint,
): Promise<{
  shares: bigint;
  borrowedDebt: bigint;
  leverageBefore: bigint;
  leverageAfter: bigint;
}> {
  const { dloopMock, collateralToken, debtToken } = fixture;

  // 1. Set initial balanced prices (1:1)
  await dloopMock.setMockPrice(await collateralToken.getAddress(), DEFAULT_PRICE);
  await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

  // 2. Create initial leveraged position at target leverage
  const sharesBefore = await dloopMock.balanceOf(user.address);
  const debtBefore = await debtToken.balanceOf(user.address);

  await dloopMock.connect(user).deposit(depositAmount, user.address);

  const sharesAfter = await dloopMock.balanceOf(user.address);
  const debtAfter = await debtToken.balanceOf(user.address);

  const shares = sharesAfter - sharesBefore;
  const borrowedDebt = debtAfter - debtBefore;

  // 3. Verify initial leverage is at target
  const leverageBefore = await dloopMock.getCurrentLeverageBps();

  // 4. Create imbalance by significantly increasing collateral price (simulating market rise)
  // This decreases leverage significantly below target, requiring increase leverage
  const newCollateralPrice = Math.floor(DEFAULT_PRICE * 1.5); // 50% price increase
  await dloopMock.setMockPrice(await collateralToken.getAddress(), newCollateralPrice);

  // 5. Verify leverage is now below target
  const leverageAfter = await dloopMock.getCurrentLeverageBps();

  // Ensure we actually created a scenario requiring leverage increase
  if (leverageAfter >= BigInt(TARGET_LEVERAGE_BPS)) {
    throw new Error(
      `Expected leverage to be below target after price increase. Leverage: ${leverageAfter.toString()}, Target: ${TARGET_LEVERAGE_BPS.toString()}`,
    );
  }

  // Ensure leverage is significantly below target to allow large increases
  const targetThreshold = (BigInt(TARGET_LEVERAGE_BPS) * 8n) / 10n;

  if (leverageAfter > targetThreshold) {
    throw new Error(
      `Leverage should be significantly below target. Leverage: ${leverageAfter.toString()}, Target: ${TARGET_LEVERAGE_BPS.toString()}, Threshold: ${targetThreshold.toString()}`,
    );
  }

  return { shares, borrowedDebt, leverageBefore, leverageAfter };
}
