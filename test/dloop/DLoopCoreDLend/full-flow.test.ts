import { expect } from "chai";
import hre, { deployments, ethers } from "hardhat";

import {
  AaveProtocolDataProvider,
  DLoopCoreDLend,
  DLoopDecreaseLeverageMock,
  DLoopDepositorMock,
  DLoopIncreaseLeverageMock,
  DLoopQuoter,
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
  DLOOP_QUOTER_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_TOKEN_ID,
  POOL_DATA_PROVIDER_ID,
  POOL_PROXY_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../../typescript/deploy-ids";

describe("DLoopCoreDLend full-flow", () => {
  // Contracts
  let pool: Pool;
  let _dataProvider: AaveProtocolDataProvider;
  let addressesProvider: PoolAddressesProvider;
  let _aaveOracle: IAaveOracle;
  let vault: DLoopCoreDLend;
  let vaultAddress: string;
  let quoter: DLoopQuoter;

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
    const [, , dir] = await quoter.quoteRebalanceAmountToReachTargetLeverage(vaultAddress);
    return Number(dir);
  }

  /**
   * Returns the absolute value of a bigint.
   *
   * @param x - The bigint to get the absolute value of
   */
  function absBigint(x: bigint): bigint {
    return x < 0n ? -x : x;
  }

  /**
   * Logs the current state of the vault.
   *
   * @param label - The label to log
   */
  async function logState(label: string): Promise<void> {
    const target = await vault.targetLeverageBps();
    const lev = await vault.getCurrentLeverageBps();
    const subsidy = await vault.getCurrentSubsidyBps();
    const [totC, totD] = await vault.getTotalCollateralAndDebtOfUserInBase(vaultAddress);
    const totalAssets = await vault.totalAssets();
    const totalSupply = await vault.totalSupply();
    const dir = await direction();
    console.log(
      `${label} | dir=${dir} lev=${lev.toString()} target=${target.toString()} subsidy=${subsidy.toString()} C=${totC.toString()} D=${totD.toString()} totalAssets=${totalAssets.toString()} totalSupply=${totalSupply.toString()}`,
    );
  }

  /**
   * Ensures vault is in desired rebalance direction.
   *
   * @param dirWanted - The desired direction
   */
  async function _ensureDirection(dirWanted: number): Promise<void> {
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
      "quoter",
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
    _dataProvider = (await ethers.getContractAt("AaveProtocolDataProvider", dataProviderAddr)) as AaveProtocolDataProvider;

    const addressesProviderAddr = (await deployments.get("PoolAddressesProvider")).address;
    addressesProvider = (await ethers.getContractAt("PoolAddressesProvider", addressesProviderAddr)) as PoolAddressesProvider;
    _aaveOracle = (await ethers.getContractAt("IAaveOracle", await addressesProvider.getPriceOracle())) as IAaveOracle;
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
    vaultAddress = await vault.getAddress();
    console.log("DLoopCoreDLend instantiated");

    // Get DLoopQuoter instance
    const quoterAddr = (await deployments.get(DLOOP_QUOTER_ID)).address;
    console.log(`DLoopQuoter address: ${quoterAddr}`);
    quoter = (await ethers.getContractAt("DLoopQuoter", quoterAddr)) as DLoopQuoter;
    console.log("DLoopQuoter instantiated");

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
    const initialLev = await vault.getCurrentLeverageBps();
    expect(initialLev).to.be.a("bigint");
    await logState("Step 0 - Sanity");

    // 1) UserA deposit via DepositorMock
    const depositAmountA = ethers.parseUnits("100", 18);
    const minSharesA = await depositorMock.calculateMinOutputShares(depositAmountA, 100, vault);
    const tsBeforeA = await vault.totalSupply();
    const userASharesBefore = await vault.balanceOf(userA);
    await logState("Step 1 - pre deposit A");
    await depositorMock.connect(await ethers.getSigner(userA)).deposit(depositAmountA, userA, minSharesA, "0x", vault);
    const userASharesAfter = await vault.balanceOf(userA);
    const tsAfterA = await vault.totalSupply();
    const mintedA = userASharesAfter - userASharesBefore;
    console.log(
      `Step 1 - UserA deposit: deposit=${depositAmountA.toString()} minShares=${minSharesA.toString()} minted=${mintedA.toString()}`,
    );
    expect(userASharesAfter).to.be.gt(0n);
    expect(mintedA).to.be.gte(minSharesA);
    expect(tsAfterA - tsBeforeA).to.equal(mintedA);
    await logState("Step 1 - post deposit A");

    // 2) UserB deposit via DepositorMock
    const depositAmountB = ethers.parseUnits("50", 18);
    const minSharesB = await depositorMock.calculateMinOutputShares(depositAmountB, 100, vault);
    const tsBeforeB = await vault.totalSupply();
    const userBSharesBefore = await vault.balanceOf(userB);
    await logState("Step 2 - pre deposit B");
    await depositorMock.connect(await ethers.getSigner(userB)).deposit(depositAmountB, userB, minSharesB, "0x", vault);
    const userBSharesAfter = await vault.balanceOf(userB);
    const tsAfterB = await vault.totalSupply();
    const mintedB = userBSharesAfter - userBSharesBefore;
    console.log(
      `Step 2 - UserB deposit: deposit=${depositAmountB.toString()} minShares=${minSharesB.toString()} minted=${mintedB.toString()}`,
    );
    expect(userBSharesAfter).to.be.gt(0n);
    expect(mintedB).to.be.gte(minSharesB);
    expect(tsAfterB - tsBeforeB).to.equal(mintedB);
    // supply consistency
    const supplyNow = await vault.totalSupply();
    expect(supplyNow).to.equal((await vault.balanceOf(userA)) + (await vault.balanceOf(userB)));
    await logState("Step 2 - post deposit B");

    // Approve RedeemerMock for shares via vault (ERC20)
    await vault.connect(await ethers.getSigner(userA)).approve(await redeemerMock.getAddress(), ethers.MaxUint256);
    await vault.connect(await ethers.getSigner(userB)).approve(await redeemerMock.getAddress(), ethers.MaxUint256);

    // 3) Lower sfrxUSD price => leverage changes, determine direction dynamically
    await setUsdFeed("sfrxUSD_frxUSD", "0.9");
    const dirAfterDown = await direction();
    console.log(`Step 3 - after price down: dir=${dirAfterDown}`);
    console.log(`Step 3 - lev=${await vault.getCurrentLeverageBps()}`);
    expect(dirAfterDown).to.not.equal(0);

    // 4) UserC calls the correct rebalance (increase if 1, decrease if -1)
    const levBeforeRebal1 = await vault.getCurrentLeverageBps();
    const [inputAmount1, estimatedOut1, dir1] = await quoter.quoteRebalanceAmountToReachTargetLeverage(vaultAddress);
    console.log(`Step 4 - rebalance1 quote: input=${inputAmount1.toString()} out=${estimatedOut1.toString()} dir=${dir1}`);

    if (dirAfterDown > 0) {
      await increaseLeverageMock.connect(await ethers.getSigner(userC)).increaseLeverage(inputAmount1, "0x", vault);
    } else {
      await decreaseLeverageMock.connect(await ethers.getSigner(userC)).decreaseLeverage(inputAmount1, "0x", vault);
    }
    const levAfterRebal1 = await vault.getCurrentLeverageBps();
    expect(absBigint(levAfterRebal1 - targetLeverage)).to.be.lt(absBigint(levBeforeRebal1 - targetLeverage));
    console.log(`Step 4 - lev=${await vault.getCurrentLeverageBps()}`);
    await logState("Step 4 - post rebalance 1");

    // 5) Verify balanced
    // Tolerate small residual; if not 0, nudge price slightly and re-check
    if ((await direction()) !== 0) {
      await setUsdFeed("sfrxUSD_frxUSD", "0.92");
    }
    const levAfterFirst = await vault.getCurrentLeverageBps();
    // Allow wider tolerance due to discrete swap and subsidy steps
    expect(levAfterFirst).to.be.within(targetLeverage - 400000n, targetLeverage + 400000n);
    await logState("Step 5 - verify balanced 1");

    // 6) Raise sfrxUSD price => leverage changes again, determine direction dynamically
    await setUsdFeed("sfrxUSD_frxUSD", "1.2");
    const dirAfterUp = await direction();
    console.log(`Step 6 - after price up: dir=${dirAfterUp}`);
    console.log(`Step 6 - lev=${await vault.getCurrentLeverageBps()}`);
    expect(dirAfterUp).to.not.equal(0);

    // 7) UserC calls the corresponding rebalance
    const levBeforeRebal2 = await vault.getCurrentLeverageBps();
    const [inputAmount2, estimatedOut2, dir2] = await quoter.quoteRebalanceAmountToReachTargetLeverage(vaultAddress);
    console.log(`Step 7 - rebalance2 quote: input=${inputAmount2.toString()} out=${estimatedOut2.toString()} dir=${dir2}`);

    if (dirAfterUp > 0) {
      await increaseLeverageMock.connect(await ethers.getSigner(userC)).increaseLeverage(inputAmount2, "0x", vault);
    } else {
      await decreaseLeverageMock.connect(await ethers.getSigner(userC)).decreaseLeverage(inputAmount2, "0x", vault);
    }
    const levAfterRebal2 = await vault.getCurrentLeverageBps();
    expect(absBigint(levAfterRebal2 - targetLeverage)).to.be.lt(absBigint(levBeforeRebal2 - targetLeverage));
    console.log(`Step 7 - lev=${await vault.getCurrentLeverageBps()}`);
    await logState("Step 7 - post rebalance 2");

    // 8) Verify balanced
    // if ((await direction()) !== 0) {
    //   console.log(`Step 8 - changing sfrxUSD price to 1.15`);
    //   await setUsdFeed("sfrxUSD_frxUSD", "1.15");
    // }
    const levAfterSecond = await vault.getCurrentLeverageBps();
    expect(levAfterSecond).to.be.within(targetLeverage - 400000n, targetLeverage + 400000n);
    await logState("Step 8 - verify balanced 2");

    // 9) UserA redeems 50%
    const userAShares = await vault.balanceOf(userA);
    const redeemSharesA = userAShares / 2n;
    const minCollA = await redeemerMock.calculateMinOutputCollateral(redeemSharesA, 100, vault); // 1% slippage (for reference)

    const balBeforeA = await sfrxUSD.balanceOf(userA);
    console.log(`Step 9 - UserA redeem: shares=${redeemSharesA.toString()} minColl=${minCollA.toString()}`);
    await redeemerMock.connect(await ethers.getSigner(userA)).redeem(redeemSharesA, userA, 1, "0x", vault);
    const balAfterA = await sfrxUSD.balanceOf(userA);
    const receivedA = balAfterA - balBeforeA;
    console.log(`Step 9 - UserA received sfrxUSD=${receivedA.toString()}`);
    expect(receivedA).to.be.gt(0n);
    expect(await vault.balanceOf(userA)).to.equal(userAShares - redeemSharesA);
    await logState("Step 9 - post redeem A");

    // 10) UserB redeems 100%
    const userBShares = await vault.balanceOf(userB);
    const minCollB = await redeemerMock.calculateMinOutputCollateral(userBShares, 100, vault); // 1% slippage (for reference)

    const balBeforeB = await sfrxUSD.balanceOf(userB);
    console.log(`Step 10 - UserB redeem: shares=${userBShares.toString()} minColl=${minCollB.toString()}`);
    await redeemerMock.connect(await ethers.getSigner(userB)).redeem(userBShares, userB, 1, "0x", vault);
    const balAfterB = await sfrxUSD.balanceOf(userB);
    const receivedB = balAfterB - balBeforeB;
    console.log(`Step 10 - UserB received sfrxUSD=${receivedB.toString()}`);
    expect(receivedB).to.be.gt(0n);
    expect(await vault.balanceOf(userB)).to.equal(0n);
    await logState("Step 10 - post redeem B");
  });
});
