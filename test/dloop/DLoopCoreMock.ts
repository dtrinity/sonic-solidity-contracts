import { ethers, deployments, getNamedAccounts } from 'hardhat';
import { expect } from 'chai';
import { ONE_HUNDRED_PERCENT_BPS } from '../../typescript/common/bps_constants';

describe('DLoopCoreMock', function () {
  let dloop: any;
  let deployer: string;
  let user: string;
  let underlying: string;
  let dStable: string;
  let accounts: any[];

  beforeEach(async function () {
    await deployments.fixture(["mock-dloop-core"]);
    accounts = await ethers.getSigners();
    deployer = accounts[0].address;
    user = accounts[1].address;

    // Deploy mock tokens with minting
    const MockERC20 = await ethers.getContractFactory("RewardClaimableMockERC20");
    const mockUnderlying = await MockERC20.deploy("Mock USDC", "mUSDC");
    const mockDStable = await MockERC20.deploy("Mock dUSD", "mdUSD");
    underlying = await mockUnderlying.getAddress();
    dStable = await mockDStable.getAddress();

    const dloopDeployment = await deployments.get("DLoopCoreMock");
    dloop = await ethers.getContractAt("DLoopCoreMock", dloopDeployment.address);
  });

  it('deploys and has correct name/symbol', async function () {
    expect(await dloop.name()).to.equal("Mock dLOOP Vault");
    expect(await dloop.symbol()).to.equal("mdLOOP");
  });

  it('allows setting and getting mock price', async function () {
    await dloop.setMockPrice(underlying, 12345);
    expect(await dloop.getAssetPriceFromOracle(underlying)).to.equal(12345);
  });

  it('reverts if price not set', async function () {
    await expect(dloop.getAssetPriceFromOracle(ethers.ZeroAddress)).to.be.revertedWith('Mock price not set');
  });

  it('calculates leverage correctly', async function () {
    // Set up: collateral = 2000, debt = 1000
    await dloop.setMockCollateral(dloop.target, 2000);
    await dloop.setMockDebt(dloop.target, 1000);
    // Leverage = collateral / (collateral - debt) * 10000 (bps)
    const leverage = await dloop.getCurrentLeverageBps();
    expect(leverage).to.equal(2 * ONE_HUNDRED_PERCENT_BPS); // 2x leverage in bps
  });

  it('supply increases collateral', async function () {
    // Mint underlying to dloop contract
    const underlyingToken = await ethers.getContractAt("RewardClaimableMockERC20", underlying);
    await underlyingToken.mint(deployer, 1000);
    await underlyingToken.connect(accounts[0]).approve(dloop.target, 1000);
    // Supply to pool
    await dloop.connect(accounts[0]).setMockCollateral(deployer, 0);
    await dloop.connect(accounts[0]).testSupplyToPool(underlying, 1000, deployer);
    expect(await dloop.mockCollateral(deployer)).to.equal(1000);
  });

  it('borrow increases debt and transfers tokens', async function () {
    // Mint dStable to dloop contract
    const dStableToken = await ethers.getContractAt("RewardClaimableMockERC20", dStable);
    await dStableToken.mint(dloop.target, 1000);
    // Borrow from pool
    await dloop.connect(accounts[0]).setMockDebt(deployer, 0);
    const userBalanceBefore = await dStableToken.balanceOf(deployer);
    await dloop.connect(accounts[0]).testBorrowFromPool(dStable, 500, deployer);
    expect(await dloop.mockDebt(deployer)).to.equal(500);
    const userBalanceAfter = await dStableToken.balanceOf(deployer);
    expect(userBalanceAfter - userBalanceBefore).to.equal(500);
  });

  it('repay decreases debt and transfers tokens from user', async function () {
    // Mint dStable to user
    const dStableToken = await ethers.getContractAt("RewardClaimableMockERC20", dStable);
    await dStableToken.mint(deployer, 500);
    // Approve dloop contract
    await dStableToken.connect(accounts[0]).approve(dloop.target, 500);
    await dloop.connect(accounts[0]).setMockDebt(deployer, 500);
    await dloop.connect(accounts[0]).testRepayDebt(dStable, 300, deployer);
    expect(await dloop.mockDebt(deployer)).to.equal(200);
    // Check contract received tokens
    expect(await dStableToken.balanceOf(dloop.target)).to.be.at.least(300);
  });

  it('withdraw decreases collateral and transfers tokens', async function () {
    // Mint underlying to dloop contract
    const underlyingToken = await ethers.getContractAt("RewardClaimableMockERC20", underlying);
    await underlyingToken.mint(dloop.target, 1000);
    await dloop.connect(accounts[0]).setMockCollateral(deployer, 1000);
    const userBalanceBefore = await underlyingToken.balanceOf(deployer);
    await dloop.connect(accounts[0]).testWithdrawFromPool(underlying, 400, deployer);
    expect(await dloop.mockCollateral(deployer)).to.equal(600);
    const userBalanceAfter = await underlyingToken.balanceOf(deployer);
    expect(userBalanceAfter - userBalanceBefore).to.equal(400);
  });

  describe('table-driven stress tests', function () {
    let attacker: string;
    let victim: string;
    let underlyingToken: any;
    let dStableToken: any;

    beforeEach(async function () {
      attacker = accounts[2].address;
      victim = accounts[3].address;
      underlyingToken = await ethers.getContractAt("RewardClaimableMockERC20", underlying);
      dStableToken = await ethers.getContractAt("RewardClaimableMockERC20", dStable);
      // Give both attacker and victim some tokens
      await underlyingToken.mint(attacker, ethers.parseUnits("1000000000", 18));
      await underlyingToken.mint(victim, ethers.parseUnits("1000000000", 18));
      await underlyingToken.mint(dloop.target, 0); // Ensure vault starts empty
    });

    // Generalized/parameterized test functions
    async function testDepositWithdraw(user: any, amount: bigint) {
      await underlyingToken.connect(user).approve(dloop.target, amount);
      await dloop.connect(user).testSupplyToPool(underlying, amount, user.address);
      expect(await dloop.mockCollateral(user.address)).to.equal(amount);
      await dloop.connect(user).testWithdrawFromPool(underlying, amount, user.address);
      expect(await dloop.mockCollateral(user.address)).to.equal(0n);
    }

    async function testMultiUserDepositWithdraw(user1: any, user2: any, amount1: bigint, amount2: bigint) {
      await underlyingToken.connect(user1).approve(dloop.target, amount1);
      await underlyingToken.connect(user2).approve(dloop.target, amount2);
      await dloop.connect(user1).testSupplyToPool(underlying, amount1, user1.address);
      await dloop.connect(user2).testSupplyToPool(underlying, amount2, user2.address);
      expect(await dloop.mockCollateral(user1.address)).to.equal(amount1);
      expect(await dloop.mockCollateral(user2.address)).to.equal(amount2);
      await dloop.connect(user1).testWithdrawFromPool(underlying, amount1, user1.address);
      await dloop.connect(user2).testWithdrawFromPool(underlying, amount2, user2.address);
      expect(await dloop.mockCollateral(user1.address)).to.equal(0n);
      expect(await dloop.mockCollateral(user2.address)).to.equal(0n);
    }

    async function testBorrowRepay(user: any, supplyAmount: bigint, borrowAmount: bigint, repayAmount: bigint) {
      await underlyingToken.connect(user).approve(dloop.target, supplyAmount);
      await dloop.connect(user).testSupplyToPool(underlying, supplyAmount, user.address);
      await dStableToken.mint(dloop.target, borrowAmount);
      await dloop.connect(user).testBorrowFromPool(dStable, borrowAmount, user.address);
      expect(await dloop.mockDebt(user.address)).to.equal(borrowAmount);
      await dStableToken.mint(user.address, repayAmount);
      await dStableToken.connect(user).approve(dloop.target, repayAmount);
      await dloop.connect(user).testRepayDebt(dStable, repayAmount, user.address);
      const expectedDebt = borrowAmount > repayAmount ? borrowAmount - repayAmount : 0n;
      expect(await dloop.mockDebt(user.address)).to.equal(expectedDebt);
    }

    async function testInflationAttack(attacker: any, victim: any, attackerDeposit: bigint, donation: bigint, victimDeposit: bigint) {
      // Step 1: Attacker deposits a small amount as first depositor
      await underlyingToken.connect(attacker).approve(dloop.target, attackerDeposit);
      await dloop.connect(attacker).testSupplyToPool(underlying, attackerDeposit, attacker.address);
      // Step 2: Attacker donates a large amount directly to vault (not via deposit)
      await underlyingToken.connect(attacker).transfer(dloop.target, donation);
      // Step 3: Victim deposits a large amount
      await underlyingToken.connect(victim).approve(dloop.target, victimDeposit);
      await dloop.connect(victim).testSupplyToPool(underlying, victimDeposit, victim.address);
      // Step 4: Attacker withdraws their share (should be only their deposit, not all vault assets)
      const attackerBalanceBefore = await underlyingToken.balanceOf(attacker.address);
      await dloop.connect(attacker).testWithdrawFromPool(underlying, attackerDeposit, attacker.address);
      const attackerBalanceAfter = await underlyingToken.balanceOf(attacker.address);
      const stolen = attackerBalanceAfter - attackerBalanceBefore;
      // Step 5: Check if attacker stole more than their fair share
      expect(stolen).to.be.lte(attackerDeposit, 'Inflation attack succeeded: attacker stole more than their share!');
    }

    // Table-driven test cases for each scenario
    const depositWithdrawCases = [
      { userIdx: 2, amount: 1n }, // very low
      { userIdx: 2, amount: 10n ** 6n }, // normal
      { userIdx: 2, amount: 10n ** 18n }, // high
      { userIdx: 2, amount: 10n ** 24n }, // extreme
    ];
    depositWithdrawCases.forEach(({ userIdx, amount }) => {
      it(`deposit/withdraw: user${userIdx} amount=${amount}`, async function () {
        await testDepositWithdraw(accounts[userIdx], amount);
      });
    });

    const multiUserCases = [
      { user1: 2, user2: 3, amount1: 1n, amount2: 2n },
      { user1: 2, user2: 3, amount1: 10n ** 6n, amount2: 2n * 10n ** 6n },
      { user1: 2, user2: 3, amount1: 10n ** 18n, amount2: 2n * 10n ** 18n },
      { user1: 2, user2: 3, amount1: 10n ** 24n, amount2: 2n * 10n ** 24n },
    ];
    multiUserCases.forEach(({ user1, user2, amount1, amount2 }) => {
      it(`multi-user deposit/withdraw: user${user1}=${amount1}, user${user2}=${amount2}`, async function () {
        await testMultiUserDepositWithdraw(accounts[user1], accounts[user2], amount1, amount2);
      });
    });

    const borrowRepayCases = [
      { userIdx: 2, supply: 10n ** 6n, borrow: 1000n, repay: 1000n }, // normal
      { userIdx: 2, supply: 10n ** 18n, borrow: 10n ** 6n, repay: 10n ** 6n }, // high
      { userIdx: 2, supply: 10n ** 24n, borrow: 10n ** 18n, repay: 10n ** 18n }, // extreme
      { userIdx: 2, supply: 10n ** 6n, borrow: 1000n, repay: 500n }, // partial repay
      { userIdx: 2, supply: 10n ** 18n, borrow: 10n ** 6n, repay: 5n * 10n ** 5n }, // partial repay high
    ];
    borrowRepayCases.forEach(({ userIdx, supply, borrow, repay }) => {
      it(`borrow/repay: user${userIdx} supply=${supply}, borrow=${borrow}, repay=${repay}`, async function () {
        await testBorrowRepay(accounts[userIdx], supply, borrow, repay);
      });
    });

    const inflationAttackCases = [
      // attackerDeposit, donation, victimDeposit
      { attackerDeposit: 1n, donation: 10n ** 6n, victimDeposit: 10n ** 6n }, // normal
      { attackerDeposit: 1n, donation: 10n ** 18n, victimDeposit: 10n ** 18n }, // high
      { attackerDeposit: 1n, donation: 10n ** 24n, victimDeposit: 10n ** 24n }, // extreme
      { attackerDeposit: 10n ** 6n, donation: 10n ** 6n, victimDeposit: 10n ** 6n }, // attacker not minimal
      { attackerDeposit: 10n ** 18n, donation: 10n ** 18n, victimDeposit: 10n ** 18n }, // attacker not minimal, high
    ];
    inflationAttackCases.forEach(({ attackerDeposit, donation, victimDeposit }) => {
      it(`inflation attack: attackerDeposit=${attackerDeposit}, donation=${donation}, victimDeposit=${victimDeposit}`, async function () {
        await testInflationAttack(accounts[2], accounts[3], attackerDeposit, donation, victimDeposit);
      });
    });
  });
});
