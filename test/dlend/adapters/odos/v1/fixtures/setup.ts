import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
import {
  AttackExecutor,
  MaliciousOdosRouterV2,
  MockAToken,
  MockPoolAddressesProvider,
  MockPriceOracleGetterV2,
  OdosLiquiditySwapAdapter,
  StatefulMockPool,
  TestMintableERC20
} from "../../../../../../typechain-types";

export interface OdosV1ExploitFixture {
  deployer: HardhatEthersSigner;
  victim: HardhatEthersSigner;
  attacker: HardhatEthersSigner;
  pool: StatefulMockPool;
  addressesProvider: MockPoolAddressesProvider;
  priceOracle: MockPriceOracleGetterV2;
  router: MaliciousOdosRouterV2;
  attackExecutor: AttackExecutor;
  adapter: OdosLiquiditySwapAdapter;
  wfrax: TestMintableERC20;
  dusd: TestMintableERC20;
  aWfrax: MockAToken;
  aDusd: MockAToken;
}

export async function deployOdosV1ExploitFixture(): Promise<OdosV1ExploitFixture> {
  const [deployer, victim, attacker] = await ethers.getSigners();

  const PoolFactory = await ethers.getContractFactory("StatefulMockPool");
  const pool = await PoolFactory.deploy();

  const PriceOracleFactory = await ethers.getContractFactory("MockPriceOracleGetterV2");
  const priceOracle = await PriceOracleFactory.deploy();

  const AddressesProviderFactory = await ethers.getContractFactory("MockPoolAddressesProvider");
  const addressesProvider = await AddressesProviderFactory.deploy(
    await pool.getAddress(),
    await priceOracle.getAddress()
  );

  const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
  const wfrax = await TokenFactory.deploy("Wrapped FRAX", "WFRAX", 18);
  const dusd = await TokenFactory.deploy("Degen USD", "DUSD", 18);

  const MockATokenFactory = await ethers.getContractFactory("MockAToken");
  const aWfrax = await MockATokenFactory.deploy("dLend Wrapped FRAX", "aWFRAX", 18, await pool.getAddress());
  const aDusd = await MockATokenFactory.deploy("dLend Degen USD", "aDUSD", 18, await pool.getAddress());

  await pool.setReserveData(await wfrax.getAddress(), await aWfrax.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress);
  await pool.setReserveData(await dusd.getAddress(), await aDusd.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress);

  const RouterFactory = await ethers.getContractFactory("MaliciousOdosRouterV2");
  const router = await RouterFactory.deploy();

  const AdapterFactory = await ethers.getContractFactory("OdosLiquiditySwapAdapter");
  const adapter = await AdapterFactory.deploy(
    await addressesProvider.getAddress(),
    await pool.getAddress(),
    await router.getAddress(),
    deployer.address
  );

  const AttackExecutorFactory = await ethers.getContractFactory("AttackExecutor");
  const attackExecutor = await AttackExecutorFactory.deploy(
    await dusd.getAddress(),
    await router.getAddress(),
    await adapter.getAddress()
  );

  return {
    deployer,
    victim,
    attacker,
    pool,
    addressesProvider,
    priceOracle,
    router,
    attackExecutor,
    adapter,
    wfrax,
    dusd,
    aWfrax,
    aDusd
  };
}

export function createMaliciousSwapData(router: MaliciousOdosRouterV2): string {
  return router.interface.encodeFunctionData("performSwap");
}
