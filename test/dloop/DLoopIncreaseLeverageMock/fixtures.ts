import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

import {
  DLoopCoreMock,
  DLoopIncreaseLeverageMock,
  SimpleDEXMock,
  TestERC20FlashMintable,
  TestMintableERC20,
} from "../../../typechain-types";
// Re-use the helper that deploys the DLoopCore mock and common constants
import {
  DEFAULT_PRICE,
  deployDLoopMockLogic,
} from "../DLoopDepositorMock/fixtures";

export interface DLoopIncreaseLeverageMockFixture {
  dloopMock: DLoopCoreMock;
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

  const {
    dloopMock,
    collateralToken,
    debtToken,
    mockPool,
    accounts,
    deployer,
  } = coreFixture;
  const user1 = accounts[1];

  // Deploy SimpleDEXMock – the swap venue used by the periphery helper
  const SimpleDEXMockFactory = await ethers.getContractFactory("SimpleDEXMock");
  const simpleDEXMock = (await SimpleDEXMockFactory.deploy()) as SimpleDEXMock;
  await simpleDEXMock.waitForDeployment();

  // 1-to-1 exchange rate so swaps are deterministic (not strictly needed for this test)
  await simpleDEXMock.setExchangeRate(
    await debtToken.getAddress(),
    await collateralToken.getAddress(),
    ethers.parseEther("1.0"),
  );

  // Deploy the periphery increase-leverage helper, using the debt token as flash-lender
  const IncreaseMockFactory = await ethers.getContractFactory(
    "DLoopIncreaseLeverageMock",
  );
  const increaseLeverageMock = (await IncreaseMockFactory.deploy(
    await debtToken.getAddress(),
    await simpleDEXMock.getAddress(),
  )) as DLoopIncreaseLeverageMock;
  await increaseLeverageMock.waitForDeployment();

  /* --------------------------------------------------------------
   * Basic environment setup – mint tokens & approvals
   * ------------------------------------------------------------ */

  const initialUserBalance = ethers.parseEther("10000");
  await collateralToken.mint(user1, initialUserBalance);
  await debtToken.mint(user1, initialUserBalance);

  // Approve vault (core) and periphery helper to move user tokens
  await collateralToken
    .connect(user1)
    .approve(await dloopMock.getAddress(), ethers.MaxUint256);
  await debtToken
    .connect(user1)
    .approve(await dloopMock.getAddress(), ethers.MaxUint256);
  await collateralToken
    .connect(user1)
    .approve(await increaseLeverageMock.getAddress(), ethers.MaxUint256);
  await debtToken
    .connect(user1)
    .approve(await increaseLeverageMock.getAddress(), ethers.MaxUint256);

  // Set up allowances for mock pool to spend tokens on vault's behalf
  await collateralToken
    .connect(mockPool)
    .approve(await dloopMock.getAddress(), ethers.MaxUint256);
  await debtToken
    .connect(mockPool)
    .approve(await dloopMock.getAddress(), ethers.MaxUint256);

  // Set up DEX with tokens for swapping
  const dexAddress = await simpleDEXMock.getAddress();
  await collateralToken.mint(dexAddress, ethers.parseEther("1000000"));
  await debtToken.mint(dexAddress, ethers.parseEther("1000000"));

  // Also pre-fund the periphery contract with some collateral so swaps won't need to pull from user
  await collateralToken.mint(
    await increaseLeverageMock.getAddress(),
    ethers.parseEther("1000"),
  );

  // Set up flash lender (debt token) with tokens for flash loans
  await debtToken.mint(
    await debtToken.getAddress(),
    ethers.parseEther("1000000"),
  );

  // Initialise oracle prices at 1:1 so starting leverage == target
  await dloopMock.setMockPrice(
    await collateralToken.getAddress(),
    DEFAULT_PRICE,
  );
  await dloopMock.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

  // Make an initial user deposit to establish a position in the vault
  await dloopMock
    .connect(user1)
    .deposit(ethers.parseEther("100"), user1.address);

  // Ensure the vault holds collateral for onBehalfOf == this supply path in mocks
  await collateralToken.mint(
    await dloopMock.getAddress(),
    ethers.parseEther("100"),
  );

  return {
    dloopMock,
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
