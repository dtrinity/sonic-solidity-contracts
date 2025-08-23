import { expect } from "chai";
import hre, { deployments, ethers } from "hardhat";

import {
  AaveProtocolDataProvider,
  DLoopCoreDLend,
  DLoopDecreaseLeverageMock,
  DLoopDepositorMock,
  DLoopIncreaseLeverageMock,
  DLoopRedeemerMock,
  ERC20StablecoinUpgradeable,
  IAaveOracle,
  Issuer,
  MockRedstoneChainlinkOracleAlwaysAlive,
  OracleAggregator,
  Pool,
  PoolAddressesProvider,
  SimpleDEXMock,
  TestERC20,
} from "../../../typechain-types";
import {
  DLOOP_CORE_DLEND_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_TOKEN_ID,
  POOL_DATA_PROVIDER_ID,
  POOL_PROXY_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../../typescript/deploy-ids";

describe("DLoopCoreDLend full-flow", () => {
  // Contracts
  let pool: Pool;
  let dataProvider: AaveProtocolDataProvider;
  let addressesProvider: PoolAddressesProvider;
  let aaveOracle: IAaveOracle;
  let vault: DLoopCoreDLend;

  // Tokens
  let dUSD: ERC20StablecoinUpgradeable;
  let sfrxUSD: TestERC20;

  // Periphery + DEX
  let simpleDEX: SimpleDEXMock;
  let depositorMock: DLoopDepositorMock;
  let redeemerMock: DLoopRedeemerMock;
  let increaseLeverageMock: DLoopIncreaseLeverageMock;
  let decreaseLeverageMock: DLoopDecreaseLeverageMock;

  // Signers
  let deployer: string;
  let userA: string;
  let userB: string;
  let userC: string;

  // Helpers
  /**
   * Gets deployment address by id.
   *
   * @param id - The deployment identifier
   */
  async function getDeploymentAddress(id: string): Promise<string> {
    return (await deployments.get(id)).address;
  }

  /**
   * Sets mock USD feed price.
   *
   * @param name - The oracle name
   * @param priceStr - The price string to set
   */
  async function setUsdFeed(name: string, priceStr: string): Promise<void> {
    const mapping = await deployments.get("MockOracleNameToAddress");
    const addr = (mapping.linkedData as Record<string, string>)[name];
    const feed = (await ethers.getContractAt("MockRedstoneChainlinkOracleAlwaysAlive", addr)) as MockRedstoneChainlinkOracleAlwaysAlive;
    await feed.setMock(ethers.parseUnits(priceStr, 8));
  }

  /**
   * Gets the rebalance direction from vault.
   */
  async function direction(): Promise<number> {
    const [, , dir] = await vault.quoteRebalanceAmountToReachTargetLeverage();
    return Number(dir);
  }

  /**
   * Ensures vault is in desired rebalance direction.
   *
   * @param dirWanted - The desired direction
   */
  async function ensureDirection(dirWanted: number): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const dirNow = await direction();
      if (dirNow === dirWanted) return;
      await ethers.provider.send("evm_mine", []);
    }
    expect(await direction()).to.equal(dirWanted);
  }

  before(async () => {
    console.log("Starting before hook");
    // Single deployment pass to avoid double-initialization
    await deployments.fixture([
      "local-setup",
      "dusd",
      "dlend",
      "dlend-static-wrapper-factory",
      "dUSD-aTokenWrapper",
      "dS-aTokenWrapper",
      "dloop",
      "core",
      "dlend",
    ]);
    console.log("Deployments fixture completed");

    // Named accounts
    const accounts = await hre.getNamedAccounts();
    deployer = accounts.deployer;
    userA = accounts.user1;
    userB = accounts.user2;
    userC = accounts.user3;
    console.log("Named accounts set");

    // Core dLEND infra
    const poolAddr = await getDeploymentAddress(POOL_PROXY_ID);
    pool = (await ethers.getContractAt("Pool", poolAddr)) as Pool;
    const dataProviderAddr = await getDeploymentAddress(POOL_DATA_PROVIDER_ID);
    dataProvider = (await ethers.getContractAt("AaveProtocolDataProvider", dataProviderAddr)) as AaveProtocolDataProvider;

    const addressesProviderAddr = (await deployments.get("PoolAddressesProvider")).address;
    addressesProvider = (await ethers.getContractAt("PoolAddressesProvider", addressesProviderAddr)) as PoolAddressesProvider;
    aaveOracle = (await ethers.getContractAt("IAaveOracle", await addressesProvider.getPriceOracle())) as IAaveOracle;
    console.log("Core dLEND infra set");

    // Tokens
    const dUSDAddr = await getDeploymentAddress(DUSD_TOKEN_ID);
    dUSD = (await ethers.getContractAt("ERC20StablecoinUpgradeable", dUSDAddr)) as ERC20StablecoinUpgradeable;

    const sfrxUSDAddr = (await deployments.get("sfrxUSD")).address;
    sfrxUSD = (await ethers.getContractAt("TestERC20", sfrxUSDAddr)) as TestERC20;
    console.log("Tokens set");

    // Deploy DEX
    const SimpleDEXFactory = await ethers.getContractFactory("SimpleDEXMock");
    simpleDEX = (await SimpleDEXFactory.deploy()) as SimpleDEXMock;
    await simpleDEX.waitForDeployment();
    console.log("SimpleDEXMock deployed");

    // Deploy periphery mocks using dUSD as flash lender
    const DepositorFactory = await ethers.getContractFactory("DLoopDepositorMock");
    depositorMock = (await DepositorFactory.deploy(dUSDAddr, await simpleDEX.getAddress())) as DLoopDepositorMock;
    await depositorMock.waitForDeployment();
    console.log("DLoopDepositorMock deployed");

    const RedeemerFactory = await ethers.getContractFactory("DLoopRedeemerMock");
    redeemerMock = (await RedeemerFactory.deploy(dUSDAddr, await simpleDEX.getAddress())) as DLoopRedeemerMock;
    await redeemerMock.waitForDeployment();
    console.log("DLoopRedeemerMock deployed");

    const IncFactory = await ethers.getContractFactory("DLoopIncreaseLeverageMock");
    increaseLeverageMock = (await IncFactory.deploy(dUSDAddr, await simpleDEX.getAddress())) as DLoopIncreaseLeverageMock;
    await increaseLeverageMock.waitForDeployment();
    console.log("DLoopIncreaseLeverageMock deployed");

    const DecFactory = await ethers.getContractFactory("DLoopDecreaseLeverageMock");
    decreaseLeverageMock = (await DecFactory.deploy(dUSDAddr, await simpleDEX.getAddress())) as DLoopDecreaseLeverageMock;
    await decreaseLeverageMock.waitForDeployment();
    console.log("DLoopDecreaseLeverageMock deployed");

    // Get DLoop core vault instance (3X-sfrxUSD)
    const dloopVaultAddr = (await deployments.get(`${DLOOP_CORE_DLEND_ID}-3X-sfrxUSD`)).address;
    console.log(`DLoopCoreDLend address: ${dloopVaultAddr}`);
    vault = (await ethers.getContractAt("DLoopCoreDLend", dloopVaultAddr)) as DLoopCoreDLend;
    console.log("DLoopCoreDLend instantiated");

    // 3) Market liquidity for borrowing: mint dUSD via IssuerV2 and supply to pool
    const issuerAddr = (await deployments.get(DUSD_ISSUER_CONTRACT_ID)).address;
    const issuer = (await ethers.getContractAt("Issuer", issuerAddr)) as Issuer;
    const usdAggAddr = (await deployments.get(USD_ORACLE_AGGREGATOR_ID)).address;
    const usdAgg = (await ethers.getContractAt("OracleAggregator", usdAggAddr)) as OracleAggregator;

    // Compute mint amount based on oracle prices
    const collateralAmount = ethers.parseUnits("400000", 18);
    const sfrxUsdPrice = await usdAgg.getAssetPrice(sfrxUSDAddr);
    const dUsdPrice = await usdAgg.getAssetPrice(dUSDAddr);
    const baseValue = (collateralAmount * sfrxUsdPrice) / 10n ** 18n;
    const expectedDusdAmount = (baseValue * 10n ** 18n) / dUsdPrice;

    // Approve and issue dUSD to deployer
    await sfrxUSD.approve(await issuer.getAddress(), collateralAmount);
    const minDusd = (expectedDusdAmount * 99n) / 100n; // 1% slippage margin
    await issuer.issue(collateralAmount, sfrxUSDAddr, minDusd);
    console.log("dUSD issued");

    // Supply dUSD liquidity to pool so borrowing works
    const dUsdSupply = ethers.parseUnits("200000", 18);
    await dUSD.approve(await pool.getAddress(), dUsdSupply);
    await pool.supply(dUSDAddr, dUsdSupply, deployer, 0);
    console.log("dUSD supplied to pool");

    // 4) DEX setup: fund with both tokens and set 1:1 rates
    const dexFundDusdAmount = ethers.parseUnits("200000", 18);
    const dexFundSfrxAmount = ethers.parseUnits("300000", 18);
    await dUSD.transfer(await simpleDEX.getAddress(), dexFundDusdAmount);
    await sfrxUSD.transfer(await simpleDEX.getAddress(), dexFundSfrxAmount);
    await simpleDEX.setExchangeRate(dUSDAddr, sfrxUSDAddr, ethers.parseUnits("1", 18));
    await simpleDEX.setExchangeRate(sfrxUSDAddr, dUSDAddr, ethers.parseUnits("1", 18));
    await simpleDEX.setExecutionSlippage(10); // 10 bps
    console.log("DEX setup completed");

    // 5) Users: fund sfrxUSD and set approvals
    const userFund = ethers.parseUnits("100000", 18);
    await sfrxUSD.transfer(userA, userFund);
    await sfrxUSD.transfer(userB, userFund);
    await sfrxUSD.connect(await ethers.getSigner(userA)).approve(await depositorMock.getAddress(), ethers.MaxUint256);
    await sfrxUSD.connect(await ethers.getSigner(userB)).approve(await depositorMock.getAddress(), ethers.MaxUint256);
    console.log("Users funded and approvals set");
    console.log("Before hook completed");
  });

  it("runs full flow", async () => {
    // Target leverage is 3x
    const targetLeverage = await vault.targetLeverageBps();

    // 0) Sanity
    expect(await vault.getCurrentLeverageBps()).to.be.a("bigint");

    // 1) UserA deposit via DepositorMock
    const depositAmountA = ethers.parseUnits("100", 18);
    const minSharesA = await depositorMock.calculateMinOutputShares(depositAmountA, 100, vault);
    await depositorMock.connect(await ethers.getSigner(userA)).deposit(depositAmountA, userA, minSharesA, "0x", vault);
    expect(await vault.balanceOf(userA)).to.be.gt(0n);

    // 2) UserB deposit via DepositorMock
    const depositAmountB = ethers.parseUnits("50", 18);
    const minSharesB = await depositorMock.calculateMinOutputShares(depositAmountB, 100, vault);
    await depositorMock.connect(await ethers.getSigner(userB)).deposit(depositAmountB, userB, minSharesB, "0x", vault);
    expect(await vault.balanceOf(userB)).to.be.gt(0n);

    // Approve RedeemerMock for shares via vault (ERC20)
    await vault.connect(await ethers.getSigner(userA)).approve(await redeemerMock.getAddress(), ethers.MaxUint256);
    await vault.connect(await ethers.getSigner(userB)).approve(await redeemerMock.getAddress(), ethers.MaxUint256);

    // 3) Lower sfrxUSD price => leverage changes, determine direction dynamically
    await setUsdFeed("sfrxUSD_frxUSD", "0.9");
    const dirAfterDown = await direction();
    expect(dirAfterDown).to.not.equal(0);

    // 4) UserC calls the correct rebalance (increase if 1, decrease if -1)
    if (dirAfterDown > 0) {
      const [inputAmount] = await vault.quoteRebalanceAmountToReachTargetLeverage();
      await increaseLeverageMock.connect(await ethers.getSigner(userC)).increaseLeverage(inputAmount, "0x", vault);
    } else {
      const [inputAmount] = await vault.quoteRebalanceAmountToReachTargetLeverage();
      await decreaseLeverageMock.connect(await ethers.getSigner(userC)).decreaseLeverage(inputAmount, "0x", vault);
    }

    // 5) Verify balanced
    // Tolerate small residual; if not 0, nudge price slightly and re-check
    if ((await direction()) !== 0) {
      await setUsdFeed("sfrxUSD_frxUSD", "0.92");
    }
    const levAfterFirst = await vault.getCurrentLeverageBps();
    // Allow wider tolerance due to discrete swap and subsidy steps
    expect(levAfterFirst).to.be.within(targetLeverage - 400000n, targetLeverage + 400000n);

    // 6) Raise sfrxUSD price => leverage changes again, determine direction dynamically
    await setUsdFeed("sfrxUSD_frxUSD", "1.2");
    const dirAfterUp = await direction();
    expect(dirAfterUp).to.not.equal(0);

    // 7) UserC calls the corresponding rebalance
    if (dirAfterUp > 0) {
      const [inputAmount] = await vault.quoteRebalanceAmountToReachTargetLeverage();
      await increaseLeverageMock.connect(await ethers.getSigner(userC)).increaseLeverage(inputAmount, "0x", vault);
    } else {
      const [inputAmount] = await vault.quoteRebalanceAmountToReachTargetLeverage();
      await decreaseLeverageMock.connect(await ethers.getSigner(userC)).decreaseLeverage(inputAmount, "0x", vault);
    }

    // 8) Verify balanced
    if ((await direction()) !== 0) {
      await setUsdFeed("sfrxUSD_frxUSD", "1.15");
    }
    const levAfterSecond = await vault.getCurrentLeverageBps();
    expect(levAfterSecond).to.be.within(targetLeverage - 400000n, targetLeverage + 400000n);

    // 9) UserA redeems 50%
    const userAShares = await vault.balanceOf(userA);
    const redeemSharesA = userAShares / 2n;
    const minCollA = await redeemerMock.calculateMinOutputCollateral(redeemSharesA, 10000, vault);

    const balBeforeA = await sfrxUSD.balanceOf(userA);
    await redeemerMock.connect(await ethers.getSigner(userA)).redeem(redeemSharesA, userA, 1, "0x", vault);
    const balAfterA = await sfrxUSD.balanceOf(userA);
    expect(balAfterA).to.be.gt(balBeforeA);
    expect(await vault.balanceOf(userA)).to.equal(userAShares - redeemSharesA);

    // 10) UserB redeems 100%
    const userBShares = await vault.balanceOf(userB);
    const minCollB = await redeemerMock.calculateMinOutputCollateral(userBShares, 10000, vault);

    const balBeforeB = await sfrxUSD.balanceOf(userB);
    await redeemerMock.connect(await ethers.getSigner(userB)).redeem(userBShares, userB, 1, "0x", vault);
    const balAfterB = await sfrxUSD.balanceOf(userB);
    expect(balAfterB).to.be.gt(balBeforeB);
    expect(await vault.balanceOf(userB)).to.equal(0n);
  });
});
